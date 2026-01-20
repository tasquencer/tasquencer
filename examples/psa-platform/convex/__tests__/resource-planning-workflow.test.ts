/// <reference types="vite/client" />
/**
 * Resource Planning Workflow Integration Tests
 *
 * These tests verify the deal-to-delivery workflow execution through the resource planning phase.
 * Tests follow the contract defined in specs/05-workflow-resource-planning.md.
 *
 * The resource planning phase:
 * 1. Starts after setBudget completes in the planning phase
 * 2. Views team availability for the project date range
 * 3. Filters users by skills, roles, departments
 * 4. Creates bookings (Tentative or Confirmed)
 * 5. Reviews bookings and confirms tentative ones
 * 6. Routes based on booking types: Tentative → confirmBookings, Confirmed → end
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
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

// All scopes needed for sales + planning + resource planning workflow tests
const RESOURCE_PLANNING_SCOPES = [
  // Sales phase scopes
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
  // Planning phase scopes
  'dealToDelivery:projects:create',
  'dealToDelivery:budgets:create',
  // Resource planning phase scopes
  'dealToDelivery:resources:view:team',
  'dealToDelivery:resources:book:team',
  'dealToDelivery:resources:confirm',
  'dealToDelivery:resources:timeoff:own',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'resource-manager', RESOURCE_PLANNING_SCOPES)
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
      name: 'Resource Planning Test Company',
      billingAddress: {
        street: '456 Tech Ave',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94103',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Jane Smith',
      email: 'jane@test.com',
      phone: '+1-555-0456',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Helper to create additional team members for resource planning tests
 */
async function createTeamMembers(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const developer1Id = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'dev1@test.com',
      name: 'Developer One',
      role: 'team_member',
      costRate: 8000,
      billRate: 12000,
      skills: ['TypeScript', 'React', 'Node.js'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    const developer2Id = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'dev2@test.com',
      name: 'Developer Two',
      role: 'team_member',
      costRate: 7500,
      billRate: 11000,
      skills: ['TypeScript', 'Vue', 'Python'],
      department: 'Engineering',
      location: 'Office',
      isActive: true,
    })

    const designerId = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'designer@test.com',
      name: 'Designer One',
      role: 'team_member',
      costRate: 9000,
      billRate: 14000,
      skills: ['Figma', 'UX', 'CSS'],
      department: 'Design',
      location: 'Remote',
      isActive: true,
    })

    return { developer1Id, developer2Id, designerId }
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
 * Helper to get the resourcePlanning workflow ID from the planning workflow
 */
async function getResourcePlanningWorkflowId(
  t: TestContext,
  planningWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const resourceWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: planningWorkflowId, taskName: 'allocateResources' }
  )
  if (resourceWorkflows.length === 0) {
    throw new Error('Resource planning workflow not found')
  }
  return resourceWorkflows[0]._id
}

/**
 * Helper to initialize and start the root workflow
 */
async function initializeRootWorkflow(t: TestContext) {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName: 'Resource Planning Test Deal',
        clientName: 'Test Company',
        estimatedValue: 150000,
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
      name: 'Resource Planning Test Deal',
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
      qualificationNotes: 'Qualified for resource planning test',
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
        { name: 'Design', hours: 40, rate: 14000 },
        { name: 'Development', hours: 120, rate: 12000 },
        { name: 'QA', hours: 40, rate: 10000 },
      ],
      notes: 'Estimate for resource planning test',
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
      documentUrl: 'https://example.com/proposal-resource.pdf',
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
      negotiationNotes: 'Terms accepted',
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
 * Complete the planning phase (createProject + setBudget) to enable resource planning
 */
async function completePlanningPhaseSetup(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  dealId: Id<'deals'>
): Promise<{ projectId: Id<'projects'>; budgetId: Id<'budgets'>; planningWorkflowId: Id<'tasquencerWorkflows'> }> {
  const planningWorkflowId = await getPlanningPhaseWorkflowId(t, rootWorkflowId)

  // Complete createProject
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

  // Complete setBudget
  await completeWorkItem(
    t,
    planningWorkflowId,
    'setBudget',
    ['dealToDelivery', 'planning', 'planningPhase', 'setBudget', 'setBudget'],
    {
      budgetId,
      type: 'TimeAndMaterials',
      services: [
        { name: 'Design', rate: 14000, estimatedHours: 40 },
        { name: 'Development', rate: 12000, estimatedHours: 120 },
        { name: 'QA', rate: 10000, estimatedHours: 40 },
      ],
    }
  )
  await flushWorkflow(t, 20)

  return { projectId, budgetId, planningWorkflowId }
}

describe('Resource Planning Workflow Entry', () => {
  it('resource planning is enabled after setBudget completes', async () => {
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

    const { planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    // Wait for routing to complete
    await flushWorkflow(testContext, 30)

    // Verify allocateResources (resource planning composite task) is enabled
    await assertTaskState(testContext, planningWorkflowId, 'allocateResources', 'enabled')
  })

  it('resource planning workflow creates viewTeamAvailability task', async () => {
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

    const { planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    // Get resource planning workflow
    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    // Verify viewTeamAvailability task is enabled
    await assertTaskState(testContext, resourceWorkflowId, 'viewTeamAvailability', 'enabled')
  })
})

describe('ViewTeamAvailability Work Item Lifecycle', () => {
  it('completes viewTeamAvailability and enables filterBySkillsRole', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    await createTeamMembers(testContext, authResult.organizationId as Id<'organizations'>)

    const { dealId } = await completeSalesPhaseWithWonDeal(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId
    )

    await flushWorkflow(testContext, 30)

    const { projectId, planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    // Get project date range (use 30 days from now)
    const startDate = Date.now()
    const endDate = startDate + 30 * 24 * 60 * 60 * 1000

    // Complete viewTeamAvailability
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'viewTeamAvailability',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
      {
        projectId,
        startDate,
        endDate,
      }
    )

    // Verify task completed
    await assertTaskState(testContext, resourceWorkflowId, 'viewTeamAvailability', 'completed')

    // Verify filterBySkillsRole is enabled
    await assertTaskState(testContext, resourceWorkflowId, 'filterBySkillsRole', 'enabled')
  })
})

describe('CreateBookings with Tentative Type', () => {
  it('creates tentative bookings and routes to confirmBookings', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id, developer2Id } = await createTeamMembers(
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

    const { projectId, planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    const startDate = Date.now()
    const endDate = startDate + 30 * 24 * 60 * 60 * 1000

    // Complete viewTeamAvailability
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'viewTeamAvailability',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
      { projectId, startDate, endDate }
    )

    // Complete filterBySkillsRole
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'filterBySkillsRole',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
      {
        projectId,
        filters: {
          skills: ['TypeScript', 'React'],
          departments: ['Engineering'],
        },
        startDate,
        endDate,
      }
    )

    // Both recordPlannedTimeOff AND createBookings must complete before reviewBookings
    // (AND-join semantics). Complete recordPlannedTimeOff with a "no time off" skip.
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'recordPlannedTimeOff',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'recordPlannedTimeOff', 'recordPlannedTimeOff'],
      {
        // Complete without recording time off (user has none to record)
        userId: authResult.userId,
        startDate,
        endDate,
        type: 'Personal',
        hoursPerDay: 0, // No hours = no time off
      }
    )

    // Complete createBookings with TENTATIVE bookings
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'createBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'createBookings', 'createBookings'],
      {
        projectId,
        bookings: [
          {
            userId: developer1Id,
            startDate,
            endDate,
            hoursPerDay: 6,
            notes: 'Development work',
          },
          {
            userId: developer2Id,
            startDate,
            endDate,
            hoursPerDay: 4,
            notes: 'Backend support',
          },
        ],
        isConfirmed: false, // TENTATIVE
      }
    )

    await flushWorkflow(testContext, 15)

    // Verify bookings were created as Tentative
    const bookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(bookings.length).toBe(2)
    expect(bookings.every((b) => b.type === 'Tentative')).toBe(true)

    // Complete reviewBookings
    const bookingIds = bookings.map((b) => b._id)
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'reviewBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
      { projectId, bookingIds }
    )

    await flushWorkflow(testContext, 15)

    // Complete checkConfirmationNeeded
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'checkConfirmationNeeded',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
      { bookingIds }
    )

    await flushWorkflow(testContext, 20)

    // Verify routing to confirmBookings (because bookings are Tentative)
    await assertTaskState(testContext, resourceWorkflowId, 'confirmBookings', 'enabled')
  })
})

describe('CreateBookings with Confirmed Type', () => {
  it('creates confirmed bookings and routes directly to end', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
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

    const { projectId, planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    const startDate = Date.now()
    const endDate = startDate + 14 * 24 * 60 * 60 * 1000 // 2 weeks

    // Complete viewTeamAvailability
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'viewTeamAvailability',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
      { projectId, startDate, endDate }
    )

    // Complete filterBySkillsRole
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'filterBySkillsRole',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
      {
        projectId,
        filters: {},
        startDate,
        endDate,
      }
    )

    // Both recordPlannedTimeOff AND createBookings must complete before reviewBookings
    // (AND-join semantics). Complete recordPlannedTimeOff first.
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'recordPlannedTimeOff',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'recordPlannedTimeOff', 'recordPlannedTimeOff'],
      {
        userId: authResult.userId,
        startDate,
        endDate,
        type: 'Personal',
        hoursPerDay: 0,
      }
    )

    // Complete createBookings with CONFIRMED bookings
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'createBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'createBookings', 'createBookings'],
      {
        projectId,
        bookings: [
          {
            userId: developer1Id,
            startDate,
            endDate,
            hoursPerDay: 8,
            notes: 'Full-time development',
          },
        ],
        isConfirmed: true, // CONFIRMED
      }
    )

    await flushWorkflow(testContext, 15)

    // Verify bookings were created as Confirmed
    const bookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(bookings.length).toBe(1)
    expect(bookings[0].type).toBe('Confirmed')

    // Complete reviewBookings
    const bookingIds = bookings.map((b) => b._id)
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'reviewBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
      { projectId, bookingIds }
    )

    await flushWorkflow(testContext, 15)

    // Complete checkConfirmationNeeded
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'checkConfirmationNeeded',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
      { bookingIds }
    )

    await flushWorkflow(testContext, 25)

    // Verify routing to completeAllocation (skip confirmBookings because bookings are already Confirmed)
    await assertTaskState(testContext, resourceWorkflowId, 'completeAllocation', 'completed')

    // Verify confirmBookings was NOT enabled (skipped)
    await assertTaskState(testContext, resourceWorkflowId, 'confirmBookings', 'disabled')
  })
})

describe('ConfirmBookings Work Item Lifecycle', () => {
  it('confirms tentative bookings and updates project status to Active', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
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

    const { projectId, planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    // Verify project starts in Planning status
    let project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project?.status).toBe('Planning')

    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    const startDate = Date.now()
    const endDate = startDate + 21 * 24 * 60 * 60 * 1000 // 3 weeks

    // Complete viewTeamAvailability
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'viewTeamAvailability',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
      { projectId, startDate, endDate }
    )

    // Complete filterBySkillsRole
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'filterBySkillsRole',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
      {
        projectId,
        filters: {},
        startDate,
        endDate,
      }
    )

    // Both recordPlannedTimeOff AND createBookings must complete (AND-join)
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'recordPlannedTimeOff',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'recordPlannedTimeOff', 'recordPlannedTimeOff'],
      {
        userId: authResult.userId,
        startDate,
        endDate,
        type: 'Personal',
        hoursPerDay: 0,
      }
    )

    // Create TENTATIVE bookings
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'createBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'createBookings', 'createBookings'],
      {
        projectId,
        bookings: [
          {
            userId: developer1Id,
            startDate,
            endDate,
            hoursPerDay: 6,
            notes: 'Tentative booking',
          },
        ],
        isConfirmed: false,
      }
    )

    await flushWorkflow(testContext, 15)

    const bookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const bookingIds = bookings.map((b) => b._id)

    // Complete reviewBookings
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'reviewBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
      { projectId, bookingIds }
    )

    // Complete checkConfirmationNeeded
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'checkConfirmationNeeded',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
      { bookingIds }
    )

    await flushWorkflow(testContext, 20)

    // Verify confirmBookings is enabled
    await assertTaskState(testContext, resourceWorkflowId, 'confirmBookings', 'enabled')

    // Complete confirmBookings
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'confirmBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'confirmBookings', 'confirmBookings'],
      {
        bookingIds,
        confirmAll: true,
      }
    )

    await flushWorkflow(testContext, 20)

    // Verify bookings are now Confirmed
    const updatedBookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(updatedBookings.every((b) => b.type === 'Confirmed')).toBe(true)

    // Verify project status changed to Active
    project = await getProjectByWorkflowId(testContext, rootWorkflowId)
    expect(project?.status).toBe('Active')

    // Verify workflow completed
    await assertTaskState(testContext, resourceWorkflowId, 'confirmBookings', 'completed')
    await assertTaskState(testContext, resourceWorkflowId, 'completeAllocation', 'completed')
  })
})

describe('Resource Planning Workflow Completion', () => {
  it('completes resource planning and enables execution phase', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developer1Id } = await createTeamMembers(
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

    const { projectId, planningWorkflowId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await flushWorkflow(testContext, 30)

    const resourceWorkflowId = await getResourcePlanningWorkflowId(testContext, planningWorkflowId)

    const startDate = Date.now()
    const endDate = startDate + 14 * 24 * 60 * 60 * 1000

    // Complete all resource planning steps with Confirmed bookings (shortcut path)
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'viewTeamAvailability',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
      { projectId, startDate, endDate }
    )

    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'filterBySkillsRole',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
      {
        projectId,
        filters: {},
        startDate,
        endDate,
      }
    )

    // Both recordPlannedTimeOff AND createBookings must complete (AND-join)
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'recordPlannedTimeOff',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'recordPlannedTimeOff', 'recordPlannedTimeOff'],
      {
        userId: authResult.userId,
        startDate,
        endDate,
        type: 'Personal',
        hoursPerDay: 0,
      }
    )

    // Create Confirmed bookings to skip confirmBookings step
    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'createBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'createBookings', 'createBookings'],
      {
        projectId,
        bookings: [
          {
            userId: developer1Id,
            startDate,
            endDate,
            hoursPerDay: 8,
          },
        ],
        isConfirmed: true,
      }
    )

    await flushWorkflow(testContext, 15)

    const bookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const bookingIds = bookings.map((b) => b._id)

    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'reviewBookings',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
      { projectId, bookingIds }
    )

    await completeWorkItem(
      testContext,
      resourceWorkflowId,
      'checkConfirmationNeeded',
      ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
      { bookingIds }
    )

    await flushWorkflow(testContext, 30)

    // Verify allocateResources composite task completed
    await assertTaskState(testContext, planningWorkflowId, 'allocateResources', 'completed')

    // Verify planning phase completed
    await assertTaskState(testContext, rootWorkflowId, 'planning', 'completed')

    // Verify execution phase is enabled
    await assertTaskState(testContext, rootWorkflowId, 'execution', 'enabled')
  })
})
