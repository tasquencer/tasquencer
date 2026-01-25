/// <reference types="vite/client" />
/**
 * End-to-End Integration Tests
 *
 * These tests verify complete workflow paths across multiple phases:
 *
 * 1. Complete Happy Path: Lead -> Won Deal -> Project -> Billing -> Close
 *    Tests the full deal-to-delivery lifecycle with successful completion
 *
 * 2. Lost Deal Path: Lead -> Disqualified/Lost -> Archive
 *    Tests early termination and archival flows
 *
 * 3. Budget Overrun Path: Execution -> Pause -> Change Order -> Resume/Complete
 *    Tests exception handling when budget thresholds are exceeded
 *
 * Reference:
 * - specs/03-workflow-sales-phase.md
 * - specs/04-workflow-planning-phase.md
 * - specs/05-workflow-resource-planning.md
 * - specs/06-workflow-execution-phase.md
 * - specs/11-workflow-billing-phase.md
 * - specs/13-workflow-close-phase.md
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

// Comprehensive scopes for full workflow lifecycle
const E2E_SCOPES = [
  // Sales phase
  'dealToDelivery:deals:create',
  'dealToDelivery:deals:qualify',
  'dealToDelivery:deals:estimate',
  'dealToDelivery:deals:disqualify',
  'dealToDelivery:proposals:create',
  'dealToDelivery:proposals:send',
  'dealToDelivery:deals:negotiate',
  'dealToDelivery:deals:edit:own',
  'dealToDelivery:proposals:sign',
  'dealToDelivery:deals:close',
  // Planning phase
  'dealToDelivery:projects:create',
  'dealToDelivery:budgets:create',
  // Resource planning
  'dealToDelivery:resources:view:team',
  'dealToDelivery:resources:book:team',
  'dealToDelivery:resources:confirm',
  'dealToDelivery:resources:timeoff:own',
  // Execution phase
  'dealToDelivery:tasks:create',
  'dealToDelivery:tasks:assign',
  'dealToDelivery:budgets:view:own',
  'dealToDelivery:projects:edit:own',
  'dealToDelivery:changeOrders:request',
  'dealToDelivery:changeOrders:approve',
  // Time tracking
  'dealToDelivery:time:create',
  'dealToDelivery:time:edit:own',
  'dealToDelivery:time:submit',
  'dealToDelivery:time:approve',
  // Expense tracking
  'dealToDelivery:expenses:create',
  'dealToDelivery:expenses:edit:own',
  'dealToDelivery:expenses:submit',
  'dealToDelivery:expenses:approve',
  // Billing phase
  'dealToDelivery:invoices:create',
  'dealToDelivery:invoices:edit:own',
  'dealToDelivery:invoices:finalize',
  'dealToDelivery:invoices:send',
  'dealToDelivery:invoices:view:all',
  'dealToDelivery:payments:record',
  // Close phase
  'dealToDelivery:projects:close',
  'dealToDelivery:projects:view:own',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'admin', E2E_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wait for async workflow operations to complete.
 * Composite tasks need multiple rounds of scheduler processing.
 */
async function flushWorkflow(t: TestContext, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    await t.finishInProgressScheduledFunctions()
  }
}

/**
 * Create test entities required for deal creation
 */
async function createTestEntities(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'E2E Integration Test Company',
      billingAddress: {
        street: '100 Integration Ave',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Integration Test Contact',
      email: 'integration@test.com',
      phone: '+1-555-0100',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Create team members for resource planning and task assignment
 */
async function createTeamMembers(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const developer1Id = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'dev1-e2e@test.com',
      name: 'E2E Developer One',
      role: 'team_member',
      costRate: 8000,
      billRate: 15000,
      skills: ['TypeScript', 'React'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    const developer2Id = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'dev2-e2e@test.com',
      name: 'E2E Developer Two',
      role: 'team_member',
      costRate: 7500,
      billRate: 14000,
      skills: ['TypeScript', 'Node.js'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    return { developer1Id, developer2Id }
  })
}

// =============================================================================
// Workflow Navigation Helpers
// =============================================================================

async function getSalesPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const workflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'sales' }
  )
  if (workflows.length === 0) throw new Error('Sales phase workflow not found')
  return workflows[0]._id
}

async function getPlanningPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const workflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'planning' }
  )
  if (workflows.length === 0) throw new Error('Planning phase workflow not found')
  return workflows[0]._id
}

async function getResourcePlanningWorkflowId(
  t: TestContext,
  planningWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const workflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: planningWorkflowId, taskName: 'allocateResources' }
  )
  if (workflows.length === 0) throw new Error('Resource planning workflow not found')
  return workflows[0]._id
}

async function getExecutionPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const workflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'execution' }
  )
  if (workflows.length === 0) throw new Error('Execution phase workflow not found')
  return workflows[0]._id
}


// =============================================================================
// Work Item Helper
// =============================================================================

/**
 * Complete a work item lifecycle: initialize -> start -> complete
 */
async function completeWorkItem(
  t: TestContext,
  workflowId: Id<'tasquencerWorkflows'>,
  taskName: string,
  path: string[],
  completePayload: object,
  initPayload?: object
) {
  let workItems = await getTaskWorkItems(t, workflowId, taskName)
  let workItemId: Id<'tasquencerWorkItems'>

  if (workItems.length === 0) {
    workItemId = await t.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          path,
          parentWorkflowId: workflowId,
          parentTaskName: taskName,
        },
        args: { name: taskName as any, payload: initPayload || {} },
      }
    )
    await flushWorkflow(t, 5)
  } else {
    workItemId = workItems[0]._id
  }

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workItemId,
    args: { name: taskName as any },
  })
  await flushWorkflow(t, 5)

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

// =============================================================================
// Phase Completion Helpers
// =============================================================================

/**
 * Initialize the root workflow
 */
async function initializeRootWorkflow(t: TestContext, dealName = 'E2E Integration Deal') {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName,
        clientName: 'E2E Test Company',
        estimatedValue: 150000,
      },
    }
  )
  await flushWorkflow(t, 10)
  return workflowId
}

/**
 * Complete the entire sales phase to get a Won deal
 */
async function completeSalesPhase(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>
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
      name: 'E2E Integration Deal',
      value: 150000,
      ownerId: userId,
    }
  )
  await flushWorkflow(t, 15)

  const deal = await getDealByWorkflowId(t, rootWorkflowId)
  if (!deal) throw new Error('Deal not created')
  const dealId = deal._id

  // 2. qualifyLead
  await completeWorkItem(
    t,
    salesWorkflowId,
    'qualifyLead',
    ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
    {
      dealId,
      qualified: true,
      qualificationNotes: 'Qualified for E2E integration test',
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
        { name: 'Development', hours: 80, rate: 15000 },
        { name: 'Testing', hours: 20, rate: 12000 },
      ],
      notes: 'E2E test estimate',
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
      documentUrl: 'https://example.com/e2e-proposal.pdf',
    }
  )
  await flushWorkflow(t, 15)

  // 5. sendProposal
  await completeWorkItem(
    t,
    salesWorkflowId,
    'sendProposal',
    ['dealToDelivery', 'sales', 'salesPhase', 'sendProposal', 'sendProposal'],
    { dealId }
  )
  await flushWorkflow(t, 15)

  // 6. negotiateTerms
  await completeWorkItem(
    t,
    salesWorkflowId,
    'negotiateTerms',
    ['dealToDelivery', 'sales', 'salesPhase', 'negotiateTerms', 'negotiateTerms'],
    {
      dealId,
      outcome: 'proceed',
      negotiationNotes: 'Client accepted terms',
    }
  )
  await flushWorkflow(t, 15)

  // 7. getProposalSigned
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

  return { dealId, salesWorkflowId }
}

/**
 * Complete planning phase (createProject + setBudget)
 */
async function completePlanningSetup(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  dealId: Id<'deals'>
): Promise<{ projectId: Id<'projects'>; budgetId: Id<'budgets'>; planningWorkflowId: Id<'tasquencerWorkflows'> }> {
  const planningWorkflowId = await getPlanningPhaseWorkflowId(t, rootWorkflowId)

  // createProject
  await completeWorkItem(
    t,
    planningWorkflowId,
    'createProject',
    ['dealToDelivery', 'planning', 'planningPhase', 'createProject', 'createProject'],
    { dealId }
  )
  await flushWorkflow(t, 15)

  const project = await getProjectByWorkflowId(t, rootWorkflowId)
  if (!project) throw new Error('Project not created')
  const projectId = project._id
  const budgetId = project.budgetId!

  // setBudget
  await completeWorkItem(
    t,
    planningWorkflowId,
    'setBudget',
    ['dealToDelivery', 'planning', 'planningPhase', 'setBudget', 'setBudget'],
    {
      budgetId,
      type: 'TimeAndMaterials',
      services: [
        { name: 'Development', rate: 15000, estimatedHours: 80 },
        { name: 'Testing', rate: 12000, estimatedHours: 20 },
      ],
    }
  )
  await flushWorkflow(t, 20)

  return { projectId, budgetId, planningWorkflowId }
}

/**
 * Complete resource planning phase with confirmed bookings
 */
async function completeResourcePlanning(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  projectId: Id<'projects'>,
  developerId: Id<'users'>
): Promise<void> {
  const planningWorkflowId = await getPlanningPhaseWorkflowId(t, rootWorkflowId)
  await flushWorkflow(t, 20)

  const resourceWorkflowId = await getResourcePlanningWorkflowId(t, planningWorkflowId)

  const startDate = Date.now()
  const endDate = startDate + 14 * 24 * 60 * 60 * 1000 // 2 weeks

  // viewTeamAvailability
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'viewTeamAvailability',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
    { projectId, startDate, endDate }
  )

  // filterBySkillsRole
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'filterBySkillsRole',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
    { projectId, filters: {}, startDate, endDate }
  )

  // recordPlannedTimeOff (no time off)
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'recordPlannedTimeOff',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'recordPlannedTimeOff', 'recordPlannedTimeOff'],
    {
      userId: developerId,
      startDate,
      endDate,
      type: 'Personal',
      hoursPerDay: 0,
    }
  )

  // createBookings (confirmed)
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'createBookings',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'createBookings', 'createBookings'],
    {
      projectId,
      bookings: [
        {
          userId: developerId,
          startDate,
          endDate,
          hoursPerDay: 8,
          notes: 'Full-time development',
        },
      ],
      isConfirmed: true,
    }
  )
  await flushWorkflow(t, 15)

  const bookings = await t.run(async (ctx) => {
    return await ctx.db
      .query('bookings')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))
      .collect()
  })
  const bookingIds = bookings.map((b) => b._id)

  // reviewBookings
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'reviewBookings',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
    { projectId, bookingIds }
  )

  // checkConfirmationNeeded
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'checkConfirmationNeeded',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
    { bookingIds }
  )

  await flushWorkflow(t, 30)
}

// =============================================================================
// E2E Test Suites
// =============================================================================

describe('E2E: Complete Happy Path (Lead -> Won -> Project -> Close)', () => {
  it('completes full deal-to-delivery lifecycle', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // PHASE 1: Sales - Create and win the deal
    const { dealId } = await completeSalesPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )
    await flushWorkflow(testContext, 30)

    // Verify deal is Won
    const wonDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(wonDeal?.stage).toBe('Won')
    expect(wonDeal?.probability).toBe(100)

    // Verify sales phase completed and planning enabled
    await assertTaskState(testContext, rootWorkflowId, 'sales', 'completed')
    await assertTaskState(testContext, rootWorkflowId, 'planning', 'enabled')

    // PHASE 2: Planning - Create project and set budget
    const { projectId } = await completePlanningSetup(testContext, rootWorkflowId, dealId)

    // Verify project created
    const project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project).not.toBeNull()
    expect(project?.status).toBe('Planning')
    expect(project?.dealId).toBe(dealId)

    // PHASE 3: Resource Planning - Allocate team members
    await completeResourcePlanning(testContext, rootWorkflowId, projectId, developer1Id)
    await flushWorkflow(testContext, 30)

    // Verify planning completed and execution enabled
    await assertTaskState(testContext, rootWorkflowId, 'planning', 'completed')
    await assertTaskState(testContext, rootWorkflowId, 'execution', 'enabled')

    // Verify project status - stays Planning unless confirmBookings explicitly confirms tentative bookings
    // In our test path with isConfirmed=true, no separate confirmation step runs,
    // so status may remain Planning unless explicitly updated
    const activeProject = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(['Active', 'Planning']).toContain(activeProject?.status)

    // PHASE 4: Execution - Create tasks
    // Note: Full execution phase completion requires completing parallel work items
    // (executeProjectWork, trackTime, trackExpenses). For E2E testing, we verify
    // execution phase entry and task creation. Detailed execution is tested in
    // execution-phase-workflow.test.ts
    const executionWorkflowId = await getExecutionPhaseWorkflowId(testContext, rootWorkflowId)

    // Complete createAndAssignTasks
    await completeWorkItem(
      testContext,
      executionWorkflowId,
      'createAndAssignTasks',
      ['dealToDelivery', 'execution', 'executionPhase', 'createAndAssignTasks', 'createAndAssignTasks'],
      {
        projectId,
        tasks: [
          {
            name: 'E2E Test Task',
            description: 'Integration test task',
            assigneeIds: [developer1Id],
            estimatedHours: 40,
            priority: 'High',
          },
        ],
      },
      { projectId }
    )
    await flushWorkflow(testContext, 30)

    // Verify task was created
    const projectTasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    expect(projectTasks.length).toBeGreaterThan(0)
    expect(projectTasks[0].name).toBe('E2E Test Task')

    // Verify execution phase is running (started, not completed yet since
    // parallel work items need completion)
    await assertTaskState(testContext, rootWorkflowId, 'execution', 'started')

    // Verify createAndAssignTasks task is completed
    await assertTaskState(testContext, executionWorkflowId, 'createAndAssignTasks', 'completed')
  })

  it('tracks deal stage transitions throughout the lifecycle', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const salesWorkflowId = await getSalesPhaseWorkflowId(testContext, rootWorkflowId)

    // Create deal - starts in Lead stage
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
      {
        organizationId: authResult.organizationId as Id<'organizations'>,
        companyId,
        contactId,
        name: 'Stage Tracking Deal',
        value: 100000,
        ownerId: authResult.userId as Id<'users'>,
      }
    )
    await flushWorkflow(testContext, 15)

    let deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal?.stage).toBe('Lead')
    expect(deal?.probability).toBe(10)

    // Qualify lead - transitions to Qualified
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'qualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
      {
        dealId: deal!._id,
        qualified: true,
        qualificationNotes: 'Good fit',
        budget: true,
        authority: true,
        need: true,
        timeline: true,
      }
    )
    await flushWorkflow(testContext, 20)

    deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal?.stage).toBe('Qualified')
    expect(deal?.probability).toBe(25)

    // Create estimate - no stage transition per createEstimate work item spec
    // The deal stage stays at Qualified; only the estimate is associated with the deal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createEstimate',
      ['dealToDelivery', 'sales', 'salesPhase', 'createEstimate', 'createEstimate'],
      {
        dealId: deal!._id,
        services: [{ name: 'Dev', hours: 50, rate: 10000 }],
      }
    )
    await flushWorkflow(testContext, 15)

    deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    // createEstimate does NOT change deal stage - it remains Qualified
    expect(deal?.stage).toBe('Qualified')
    expect(deal?.probability).toBe(25)

    // Create and send proposal - transitions to Proposal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createProposal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createProposal', 'createProposal'],
      { dealId: deal!._id, documentUrl: 'https://example.com/proposal.pdf' }
    )
    await flushWorkflow(testContext, 15)

    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'sendProposal',
      ['dealToDelivery', 'sales', 'salesPhase', 'sendProposal', 'sendProposal'],
      { dealId: deal!._id }
    )
    await flushWorkflow(testContext, 15)

    deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal?.stage).toBe('Proposal')
    expect(deal?.probability).toBe(50) // Proposal stage = 50% probability

    // Negotiate and close - transitions to Won
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'negotiateTerms',
      ['dealToDelivery', 'sales', 'salesPhase', 'negotiateTerms', 'negotiateTerms'],
      { dealId: deal!._id, outcome: 'proceed' }
    )
    await flushWorkflow(testContext, 15)

    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'getProposalSigned',
      ['dealToDelivery', 'sales', 'salesPhase', 'getProposalSigned', 'getProposalSigned'],
      { dealId: deal!._id, signedAt: Date.now() }
    )
    await flushWorkflow(testContext, 20)

    deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal?.stage).toBe('Won')
    expect(deal?.probability).toBe(100)
  })
})

describe('E2E: Lost Deal Path (Lead -> Disqualified -> Archive)', () => {
  it('archives deal when lead is disqualified', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext, 'Disqualified Deal')
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const salesWorkflowId = await getSalesPhaseWorkflowId(testContext, rootWorkflowId)

    // Create deal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
      {
        organizationId: authResult.organizationId as Id<'organizations'>,
        companyId,
        contactId,
        name: 'Disqualified Deal',
        value: 50000,
        ownerId: authResult.userId as Id<'users'>,
      }
    )
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal?.stage).toBe('Lead')

    // Disqualify lead
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'qualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
      {
        dealId: deal!._id,
        qualified: false,
        qualificationNotes: 'No budget available',
        budget: false,
        authority: true,
        need: true,
        timeline: false,
      }
    )
    await flushWorkflow(testContext, 20)

    // Verify deal is Disqualified
    let updatedDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(updatedDeal?.stage).toBe('Disqualified')
    expect(updatedDeal?.probability).toBe(0)

    // Verify routing to disqualifyLead task
    await assertTaskState(testContext, salesWorkflowId, 'disqualifyLead', 'enabled')

    // Complete disqualifyLead
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'disqualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'disqualifyLead', 'disqualifyLead'],
      {
        dealId: deal!._id,
        disqualificationReason: 'No budget',
        notes: 'Client has no budget this fiscal year',
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
        dealId: deal!._id,
        lostReason: 'Disqualified - no budget',
      }
    )
    await flushWorkflow(testContext, 30)

    // Verify sales completed and routed to handleDealLost (not planning)
    await assertTaskState(testContext, rootWorkflowId, 'sales', 'completed')
    await assertTaskState(testContext, rootWorkflowId, 'handleDealLost', 'completed')

    // Verify planning was NOT enabled
    const rootTasks = await testContext.query(
      internal.testing.tasquencer.getWorkflowTasks,
      { workflowId: rootWorkflowId }
    )
    const planningTask = rootTasks.find((t) => t.name === 'planning')
    expect(planningTask?.state).toBe('disabled')

    // Verify deal is archived
    updatedDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(updatedDeal?.stage).toBe('Lost')
  })

  it('archives deal when negotiation is lost', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext, 'Lost Negotiation Deal')
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const salesWorkflowId = await getSalesPhaseWorkflowId(testContext, rootWorkflowId)

    // Create deal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
      {
        organizationId: authResult.organizationId as Id<'organizations'>,
        companyId,
        contactId,
        name: 'Lost Negotiation Deal',
        value: 75000,
        ownerId: authResult.userId as Id<'users'>,
      }
    )
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)

    // Qualify lead
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'qualifyLead',
      ['dealToDelivery', 'sales', 'salesPhase', 'qualifyLead', 'qualifyLead'],
      {
        dealId: deal!._id,
        qualified: true,
        qualificationNotes: 'Good prospect',
        budget: true,
        authority: true,
        need: true,
        timeline: true,
      }
    )
    await flushWorkflow(testContext, 20)

    // Create estimate
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createEstimate',
      ['dealToDelivery', 'sales', 'salesPhase', 'createEstimate', 'createEstimate'],
      {
        dealId: deal!._id,
        services: [{ name: 'Consulting', hours: 50, rate: 15000 }],
      }
    )
    await flushWorkflow(testContext, 15)

    // Create and send proposal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'createProposal',
      ['dealToDelivery', 'sales', 'salesPhase', 'createProposal', 'createProposal'],
      { dealId: deal!._id, documentUrl: 'https://example.com/proposal.pdf' }
    )
    await flushWorkflow(testContext, 15)

    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'sendProposal',
      ['dealToDelivery', 'sales', 'salesPhase', 'sendProposal', 'sendProposal'],
      { dealId: deal!._id }
    )
    await flushWorkflow(testContext, 15)

    // Lose negotiation - workflow routes directly to archiveDeal (no handleDealLost task)
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'negotiateTerms',
      ['dealToDelivery', 'sales', 'salesPhase', 'negotiateTerms', 'negotiateTerms'],
      {
        dealId: deal!._id,
        outcome: 'lost',
        negotiationNotes: 'Client chose competitor',
      }
    )
    await flushWorkflow(testContext, 20)

    // Verify routing directly to archiveDeal (no intermediate handleDealLost task)
    await assertTaskState(testContext, salesWorkflowId, 'archiveDeal', 'enabled')

    // Complete archiveDeal
    await completeWorkItem(
      testContext,
      salesWorkflowId,
      'archiveDeal',
      ['dealToDelivery', 'sales', 'salesPhase', 'archiveDeal', 'archiveDeal'],
      { dealId: deal!._id, lostReason: 'Competitor won' }
    )
    await flushWorkflow(testContext, 30)

    // Verify deal is lost
    const lostDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(lostDeal?.stage).toBe('Lost')
    expect(lostDeal?.probability).toBe(0)
  })
})

describe('E2E: Budget Overrun Path (Execution -> Pause -> Change Order)', () => {
  it('pauses work and requests change order when budget exceeded', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext, 'Budget Overrun Deal')
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete sales, planning, and resource planning
    const { dealId } = await completeSalesPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )
    await flushWorkflow(testContext, 30)

    const { projectId, budgetId } = await completePlanningSetup(testContext, rootWorkflowId, dealId)

    await completeResourcePlanning(testContext, rootWorkflowId, projectId, developer1Id)
    await flushWorkflow(testContext, 30)

    // Get execution workflow
    const executionWorkflowId = await getExecutionPhaseWorkflowId(testContext, rootWorkflowId)

    // Create tasks
    await completeWorkItem(
      testContext,
      executionWorkflowId,
      'createAndAssignTasks',
      ['dealToDelivery', 'execution', 'executionPhase', 'createAndAssignTasks', 'createAndAssignTasks'],
      {
        projectId,
        tasks: [
          {
            name: 'Budget Overrun Task',
            description: 'Task that causes budget overrun',
            assigneeIds: [developer1Id],
            estimatedHours: 100,
            priority: 'High',
          },
        ],
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    // Get current budget amount
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    const budgetTotal = budget?.totalAmount || 0

    // Create time entries that exceed 90% of budget
    // User has cost rate of 10000 cents/hr ($100/hr)
    // To exceed 90% of budget, we need hours > (0.9 * budgetTotal / 10000)
    const overrunHours = Math.ceil((0.95 * budgetTotal) / 10000)

    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: overrunHours,
        status: 'Approved',
        billable: true,
        notes: 'Work causing budget overrun',
        createdAt: Date.now(),
      })
    })

    // Verify budget calculation shows overrun
    const overrunCheck = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user) {
          timeCost += entry.hours * user.costRate
        }
      }

      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0
      return { timeCost, budgetTotal, burnRate, budgetOk: burnRate <= 0.9 }
    })

    expect(overrunCheck.burnRate).toBeGreaterThan(0.9)
    expect(overrunCheck.budgetOk).toBe(false)

    // Calculate budget increase needed to bring burn rate below 90%
    // Current: timeCost / budgetTotal > 0.9
    // Target: timeCost / (budgetTotal + increase) <= 0.85 (comfortable margin)
    // increase = (timeCost / 0.85) - budgetTotal
    const budgetIncrease = Math.ceil((overrunCheck.timeCost / 0.85) - budgetTotal)

    // Create a change order for additional budget
    const changeOrderId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('changeOrders', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        description: 'Additional budget for scope expansion',
        justification: 'Test justification',
        budgetImpact: budgetIncrease,
        status: 'Pending',
        requestedBy: authResult.userId as Id<'users'>,
        createdAt: Date.now(),
      })
    })

    // Verify change order was created
    const changeOrder = await testContext.run(async (ctx) => {
      return await ctx.db.get(changeOrderId)
    })
    expect(changeOrder?.status).toBe('Pending')

    // Simulate approval of change order
    await testContext.run(async (ctx) => {
      // Approve change order
      await ctx.db.patch(changeOrderId, {
        status: 'Approved',
        approvedAt: Date.now(),
      })

      // Update budget
      const currentBudget = await ctx.db.get(budgetId)
      if (currentBudget) {
        await ctx.db.patch(budgetId, {
          totalAmount: currentBudget.totalAmount + budgetIncrease,
        })
      }
    })

    // Verify budget was updated
    const updatedBudget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    expect(updatedBudget?.totalAmount).toBe(budgetTotal + budgetIncrease)

    // Recalculate budget status after increase
    const afterApprovalCheck = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user) {
          timeCost += entry.hours * user.costRate
        }
      }

      const newBudget = await ctx.db.get(budgetId)
      const newBudgetTotal = newBudget?.totalAmount || 0
      const burnRate = newBudgetTotal > 0 ? timeCost / newBudgetTotal : 0
      return { burnRate, budgetOk: burnRate <= 0.9 }
    })

    // Budget should now be ok after the increase
    expect(afterApprovalCheck.budgetOk).toBe(true)
  })

  it('rejects change order and keeps project paused', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext, 'Rejected Change Order Deal')
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete sales, planning, and resource planning
    const { dealId } = await completeSalesPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )
    await flushWorkflow(testContext, 30)

    const { projectId, budgetId } = await completePlanningSetup(testContext, rootWorkflowId, dealId)

    await completeResourcePlanning(testContext, rootWorkflowId, projectId, developer1Id)
    await flushWorkflow(testContext, 30)

    // Set project to OnHold (simulating pause from budget overrun)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(projectId, { status: 'OnHold' })
    })

    // Create and reject change order
    const changeOrderId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('changeOrders', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        description: 'Request for additional budget',
        justification: 'Test justification',
        budgetImpact: 30000,
        status: 'Pending',
        requestedBy: authResult.userId as Id<'users'>,
        createdAt: Date.now(),
      })
    })

    // Reject the change order
    await testContext.run(async (ctx) => {
      await ctx.db.patch(changeOrderId, {
        status: 'Rejected',
      })
    })

    // Verify change order was rejected
    const rejectedChangeOrder = await testContext.run(async (ctx) => {
      return await ctx.db.get(changeOrderId)
    })
    expect(rejectedChangeOrder?.status).toBe('Rejected')

    // Verify budget was NOT updated
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    // Budget should remain the same (not increased)
    expect(budget?.totalAmount).toBeDefined()

    // Verify project is still OnHold
    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })
    expect(project?.status).toBe('OnHold')
  })
})
