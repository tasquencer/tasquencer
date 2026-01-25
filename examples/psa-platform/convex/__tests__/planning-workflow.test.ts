/// <reference types="vite/client" />
/**
 * Planning Phase Workflow Integration Tests
 *
 * These tests verify the deal-to-delivery workflow execution through the planning phase.
 * Tests follow the contract defined in specs/04-workflow-planning-phase.md.
 *
 * The planning phase:
 * 1. Starts when a deal is won (sales phase completes with deal.stage = "Won")
 * 2. Creates a project from the won deal
 * 3. Sets up the budget with services
 * 4. Routes to resource planning phase
 *
 * Reference: .review/recipes/psa-platform/specs/04-workflow-planning-phase.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  getTaskWorkItems,
  assertTaskState,
  getDealByWorkflowId,
  getProjectByWorkflowId,
  type TestContext,
} from './helpers.test'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// All scopes needed for sales + planning workflow tests
const PLANNING_SCOPES = [
  'dealToDelivery:deals:create',
  'dealToDelivery:deals:qualify',
  'dealToDelivery:deals:estimate',
  'dealToDelivery:deals:disqualify',
  'dealToDelivery:proposals:create',
  'dealToDelivery:proposals:send',
  'dealToDelivery:deals:negotiate',
  'dealToDelivery:deals:edit:own',
  'dealToDelivery:proposals:sign',
  'dealToDelivery:projects:create',
  'dealToDelivery:budgets:create',
  'dealToDelivery:deals:close',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'project-manager', PLANNING_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Wait for async workflow operations to complete.
 * Composite tasks (sub-workflows) need multiple rounds of scheduler processing.
 */
async function flushWorkflow(t: TestContext, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    await t.finishInProgressScheduledFunctions()
  }
}

/**
 * Helper to create test entities required for deal creation
 */
async function createTestEntities(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company Inc',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'John Doe',
      email: 'john@test.com',
      phone: '+1-555-0123',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Helper to get the salesPhase workflow ID from the root workflow
 */
async function getSalesPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const salesWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'sales' }
  )
  if (salesWorkflows.length === 0) {
    throw new Error('Sales phase workflow not found')
  }
  return salesWorkflows[0]._id
}

/**
 * Helper to get the planningPhase workflow ID from the root workflow
 */
async function getPlanningPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const planningWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'planning' }
  )
  if (planningWorkflows.length === 0) {
    throw new Error('Planning phase workflow not found')
  }
  return planningWorkflows[0]._id
}

/**
 * Helper to initialize and start the root workflow
 */
async function initializeRootWorkflow(t: TestContext) {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName: 'Planning Test Deal',
        clientName: 'Test Company',
        estimatedValue: 100000,
      },
    }
  )
  await flushWorkflow(t, 10)
  return workflowId
}

/**
 * Complete a work item lifecycle: initialize -> start -> complete
 */
async function completeWorkItem(
  t: TestContext,
  workflowId: Id<'tasquencerWorkflows'>,
  taskName: string,
  path: string[],
  completePayload: object
) {
  // Get the auto-initialized work item (from onEnabled)
  let workItems = await getTaskWorkItems(t, workflowId, taskName)
  let workItemId: Id<'tasquencerWorkItems'>

  if (workItems.length === 0) {
    // Work item not auto-initialized, initialize manually
    workItemId = await t.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          path,
          parentWorkflowId: workflowId,
          parentTaskName: taskName,
        },
        args: { name: taskName as any, payload: {} },
      }
    )
    await flushWorkflow(t, 5)
  } else {
    workItemId = workItems[0]._id
  }

  // Start the work item
  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workItemId,
    args: { name: taskName as any },
  })
  await flushWorkflow(t, 5)

  // Complete the work item
  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workItemId,
    args: {
      name: taskName,
      payload: completePayload,
    } as any,
  })
  await flushWorkflow(t, 10)

  return workItemId
}

/**
 * Complete the entire sales phase to get a Won deal
 */
async function completeSalesPhaseWithWonDeal(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  options?: { adjustedValue?: number }
): Promise<{ dealId: Id<'deals'>; salesWorkflowId: Id<'tasquencerWorkflows'> }> {
  const salesWorkflowId = await getSalesPhaseWorkflowId(t, rootWorkflowId)

  // 1. createDeal
  await completeWorkItem(
    t,
    salesWorkflowId,
    'createDeal',
    ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
    {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Planning Test Deal',
      value: 100000,
      ownerId: userId,
    }
  )
  await flushWorkflow(t, 15)

  const deal = await getDealByWorkflowId(t, rootWorkflowId)
  if (!deal) throw new Error('Deal not created')
  const dealId = deal._id

  // 2. qualifyLead (qualified=true)
  await completeWorkItem(
    t,
    salesWorkflowId,
    'qualifyLead',
    ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
    {
      dealId,
      qualified: true,
      qualificationNotes: 'Qualified for planning test',
      budget: true,
      authority: true,
      need: true,
      timeline: true,
    }
  )
  await flushWorkflow(t, 20)

  // 3. createEstimate
  await completeWorkItem(
    t,
    salesWorkflowId,
    'createEstimate',
    ['dealToDelivery', 'sales', 'salesPhase', 'createEstimate', 'createEstimate'],
    {
      dealId,
      services: [
        { name: 'Consulting', hours: 40, rate: 15000 },
        { name: 'Development', hours: 80, rate: 12000 },
      ],
      notes: 'Initial estimate for project',
    }
  )
  await flushWorkflow(t, 15)

  // 4. createProposal
  await completeWorkItem(
    t,
    salesWorkflowId,
    'createProposal',
    ['dealToDelivery', 'sales', 'salesPhase', 'createProposal', 'createProposal'],
    {
      dealId,
      documentUrl: 'https://example.com/proposal.pdf',
    }
  )
  await flushWorkflow(t, 15)

  // 5. sendProposal
  await completeWorkItem(
    t,
    salesWorkflowId,
    'sendProposal',
    ['dealToDelivery', 'sales', 'salesPhase', 'sendProposal', 'sendProposal'],
    {
      dealId,
    }
  )
  await flushWorkflow(t, 15)

  // 6. negotiateTerms
  await completeWorkItem(
    t,
    salesWorkflowId,
    'negotiateTerms',
    ['dealToDelivery', 'sales', 'salesPhase', 'negotiateTerms', 'negotiateTerms'],
    (() => {
      const payload: {
        dealId: Id<'deals'>
        outcome: 'proceed'
        negotiationNotes?: string
        adjustedValue?: number
      } = {
        dealId,
        outcome: 'proceed',
        negotiationNotes: 'Client accepted terms',
      }
      if (options?.adjustedValue !== undefined) {
        payload.adjustedValue = options.adjustedValue
      }
      return payload
    })()
  )
  await flushWorkflow(t, 15)

  // 7. getProposalSigned (deal won)
  await completeWorkItem(
    t,
    salesWorkflowId,
    'getProposalSigned',
    ['dealToDelivery', 'sales', 'salesPhase', 'getProposalSigned', 'getProposalSigned'],
    {
      dealId,
      signedAt: Date.now(),
    }
  )
  await flushWorkflow(t, 20)

  // Verify deal is now Won
  const wonDeal = await getDealByWorkflowId(t, rootWorkflowId)
  if (!wonDeal || wonDeal.stage !== 'Won') {
    throw new Error(`Expected deal stage Won, got ${wonDeal?.stage}`)
  }

  return { dealId, salesWorkflowId }
}

async function completeSalesPhaseToNegotiation(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  options: { outcome: 'proceed' | 'revise' | 'lost'; adjustedValue?: number }
): Promise<{ dealId: Id<'deals'>; salesWorkflowId: Id<'tasquencerWorkflows'> }> {
  const salesWorkflowId = await getSalesPhaseWorkflowId(t, rootWorkflowId)

  await completeWorkItem(
    t,
    salesWorkflowId,
    'createDeal',
    ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
    {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Negotiation Test Deal',
      value: 50000,
      ownerId: userId,
    }
  )
  await flushWorkflow(t, 10)

  const deal = await getDealByWorkflowId(t, rootWorkflowId)
  if (!deal) throw new Error('Deal not created')
  const dealId = deal._id

  await completeWorkItem(
    t,
    salesWorkflowId,
    'qualifyLead',
    ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
    {
      dealId,
      qualified: true,
      qualificationNotes: 'Good fit',
      budget: true,
      authority: true,
      need: true,
      timeline: true,
    }
  )
  await flushWorkflow(t, 20)

  await completeWorkItem(
    t,
    salesWorkflowId,
    'createEstimate',
    ['dealToDelivery', 'sales', 'salesPhase', 'createEstimate', 'createEstimate'],
    {
      dealId,
      services: [
        { name: 'Consulting', hours: 40, rate: 15000 },
        { name: 'Development', hours: 80, rate: 12000 },
      ],
      notes: 'Estimate for negotiation test',
    }
  )
  await flushWorkflow(t, 15)

  await completeWorkItem(
    t,
    salesWorkflowId,
    'createProposal',
    ['dealToDelivery', 'sales', 'salesPhase', 'createProposal', 'createProposal'],
    {
      dealId,
      documentUrl: 'https://example.com/proposal-negotiation.pdf',
    }
  )
  await flushWorkflow(t, 15)

  await completeWorkItem(
    t,
    salesWorkflowId,
    'sendProposal',
    ['dealToDelivery', 'sales', 'salesPhase', 'sendProposal', 'sendProposal'],
    { dealId }
  )
  await flushWorkflow(t, 15)

  await completeWorkItem(
    t,
    salesWorkflowId,
    'negotiateTerms',
    ['dealToDelivery', 'sales', 'salesPhase', 'negotiateTerms', 'negotiateTerms'],
    (() => {
      const payload: {
        dealId: Id<'deals'>
        outcome: 'proceed' | 'revise' | 'lost'
        negotiationNotes?: string
        adjustedValue?: number
      } = {
        dealId,
        outcome: options.outcome,
        negotiationNotes: 'Client responded',
      }
      if (options.adjustedValue !== undefined) {
        payload.adjustedValue = options.adjustedValue
      }
      return payload
    })()
  )
  await flushWorkflow(t, 15)

  return { dealId, salesWorkflowId }
}

describe('Planning Phase Workflow Entry', () => {
  it('planning phase is enabled after deal is won', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    // Wait for routing to complete
    await flushWorkflow(testContext, 30)

    // Verify sales composite task is completed
    await assertTaskState(testContext, rootWorkflowId, 'sales', 'completed')

    // Verify planning composite task is enabled
    await assertTaskState(testContext, rootWorkflowId, 'planning', 'enabled')
  })

  it('planning phase workflow creates createProject task', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    // Get planning phase workflow
    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    // Verify createProject task is enabled
    await assertTaskState(testContext, planningWorkflowId, 'createProject', 'enabled')

    // Verify work item was auto-initialized
    const workItems = await getTaskWorkItems(testContext, planningWorkflowId, 'createProject')
    expect(workItems.length).toBe(1)
    expect(workItems[0].state).toBe('initialized')
  })
})

describe('CreateProject Work Item Lifecycle', () => {
  it('creates project from won deal with budget', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    // Complete createProject work item
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'createProject',
      ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
      { dealId }
    )

    // Verify project was created
    const project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project).not.toBeNull()
    expect(project?.name).toBe('Planning Test Deal')
    expect(project?.status).toBe('Planning')
    expect(project?.dealId).toBe(dealId)
    expect(project?.budgetId).toBeDefined()

    // Verify task completed
    await assertTaskState(testContext, planningWorkflowId, 'createProject', 'completed')
  })

  it('adds negotiation adjustment when deal value differs from estimate', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const estimateTotal = 40 * 15000 + 80 * 12000
    const adjustedValue = estimateTotal - 60000

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      { adjustedValue }
    )

    await flushWorkflow(testContext, 30)

    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'createProject',
      ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
      { dealId }
    )

    const project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project).not.toBeNull()
    const budgetId = project!.budgetId

    const services = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('services')
        .withIndex('by_budget', (q) => q.eq('budgetId', budgetId!))
        .collect()
    })
    const adjustment = services.find(
      (service) => service.name === 'Negotiation Adjustment'
    )
    expect(adjustment).toBeDefined()

    const estimatedServicesTotal = services
      .filter((service) => service.name !== 'Negotiation Adjustment')
      .reduce((sum, service) => sum + service.totalAmount, 0)
    expect(adjustment?.totalAmount).toBe(adjustedValue - estimatedServicesTotal)

    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId!)
    })
    expect(budget?.totalAmount).toBe(adjustedValue)
  })

  it('enables setBudget task after createProject completes', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    // Complete createProject
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'createProject',
      ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
      { dealId }
    )

    await flushWorkflow(testContext, 15)

    // Verify setBudget task is enabled
    await assertTaskState(testContext, planningWorkflowId, 'setBudget', 'enabled')

    // Verify work item was auto-initialized
    const workItems = await getTaskWorkItems(testContext, planningWorkflowId, 'setBudget')
    expect(workItems.length).toBe(1)
    expect(workItems[0].state).toBe('initialized')
  })
})

describe('Sales Phase Negotiation Routing', () => {
  it('routes negotiation outcome to reviseProposal when revision is requested', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { dealId, salesWorkflowId } = await completeSalesPhaseToNegotiation(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      { outcome: 'revise' }
    )

    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, salesWorkflowId, 'reviseProposal', 'enabled')

    const latestProposal = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('proposals')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .order('desc')
        .first()
    })
    expect(latestProposal).not.toBeNull()
    expect(latestProposal?.status).toBe('Rejected')
  })
})

describe('SetBudget Work Item Lifecycle', () => {
  it('updates budget type and services', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    // Complete createProject
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'createProject',
      ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
      { dealId }
    )

    await flushWorkflow(testContext, 15)

    // Get the project and budget
    const project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project).not.toBeNull()
    const budgetId = project!.budgetId

    // Complete setBudget with custom services
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'setBudget',
      ['dealToDelivery', 'planning', 'planningPhase', 'setBudget', 'setBudget'],
      {
        budgetId,
        type: 'FixedFee',
        services: [
          { name: 'Project Management', rate: 18000, estimatedHours: 20 },
          { name: 'Development', rate: 15000, estimatedHours: 100 },
          { name: 'Testing', rate: 12000, estimatedHours: 40 },
        ],
      }
    )

    // Verify budget was updated
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId!)
    })
    expect(budget?.type).toBe('FixedFee')

    // Verify services were created
    const services = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('services')
        .withIndex('by_budget', (q) => q.eq('budgetId', budgetId!))
        .collect()
    })
    expect(services.length).toBe(3)

    // Verify budget total was calculated
    // (18000 * 20) + (15000 * 100) + (12000 * 40) = 360000 + 1500000 + 480000 = 2340000
    expect(budget?.totalAmount).toBe(2340000)

    // Verify task completed
    await assertTaskState(testContext, planningWorkflowId, 'setBudget', 'completed')
  })

  it('enables allocateResources (resource planning) after setBudget', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    const planningWorkflowId = await getPlanningPhaseWorkflowId(testContext, rootWorkflowId)

    // Complete createProject
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'createProject',
      ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
      { dealId }
    )

    await flushWorkflow(testContext, 15)

    const project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    const budgetId = project!.budgetId

    // Complete setBudget
    await completeWorkItem(
      testContext,
      planningWorkflowId,
      'setBudget',
      ['dealToDelivery', 'planning', 'planningPhase', 'setBudget', 'setBudget'],
      {
        budgetId,
        type: 'TimeAndMaterials',
        services: [
          { name: 'Consulting', rate: 15000, estimatedHours: 50 },
        ],
      }
    )

    await flushWorkflow(testContext, 20)

    // Verify allocateResources (resource planning composite task) is enabled
    await assertTaskState(testContext, planningWorkflowId, 'allocateResources', 'enabled')
  })
})

describe('Planning Phase Routing', () => {
  it('routes to handleDealLost when deal is lost in sales', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const salesWorkflowId = await getSalesPhaseWorkflowId(testContext, rootWorkflowId)

    // 1. createDeal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
      {
        organizationId: authResult.organizationId as Id<'organizations'>,
        companyId,
        contactId,
        name: 'Lost Deal Test',
        value: 50000,
        ownerId: authResult.userId as Id<'users'>,
      }
    )
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    const dealId = deal!._id

    // 2. qualifyLead with qualified=false (disqualify)
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'qualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
      {
        dealId,
        qualified: false,
        qualificationNotes: 'Budget not available',
      }
    )
    await flushWorkflow(testContext, 20)

    // Complete disqualifyLead
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'disqualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'disqualifyLead', 'disqualifyLead'],
      {
        dealId,
        disqualificationReason: 'Budget not available',
        notes: 'Client indicated no budget for this fiscal year',
      }
    )
    await flushWorkflow(testContext, 15)

    // Complete archiveDeal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'archiveDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'archiveDeal', 'archiveDeal'],
      {
        dealId,
        lostReason: 'Disqualified - no budget available',
      }
    )
    await flushWorkflow(testContext, 30)

    // Verify sales phase completed
    await assertTaskState(testContext, rootWorkflowId, 'sales', 'completed')

    // Verify routing went to handleDealLost (not planning)
    await assertTaskState(testContext, rootWorkflowId, 'handleDealLost', 'completed')

    // Verify planning was NOT enabled
    const tasks = await testContext.query(
      internal.testing.tasquencer.getWorkflowTasks,
      { workflowId: rootWorkflowId }
    )
    const planningTask = tasks.find((t) => t.name === 'planning')
    expect(planningTask?.state).toBe('disabled')
  })
})
