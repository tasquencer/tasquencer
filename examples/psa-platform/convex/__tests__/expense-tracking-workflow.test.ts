/// <reference types="vite/client" />
/**
 * Expense Tracking Workflow Integration Tests
 *
 * These tests verify the expense tracking workflow embedded in the execution phase.
 * Tests follow the contract defined in specs/08-workflow-expense-tracking.md.
 *
 * The expense tracking workflow:
 * 1. Starts when trackExpenses composite task is enabled after createAndAssignTasks
 * 2. selectExpenseType routes to one of the expense logging tasks (defaults to logOtherExpense)
 * 3. All expense types flow to attachReceipt
 * 4. attachReceipt -> markBillable
 * 5. markBillable routes to setBillableRate (if billable) or submitExpense (defaults to submitExpense)
 * 6. submitExpense changes expense status from "Draft" to "Submitted"
 *
 * Reference: .review/recipes/psa-platform/specs/08-workflow-expense-tracking.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  getTaskWorkItems,
  assertTaskState,
  getDealByWorkflowId,
  getProjectByWorkflowId,
  getWorkflowTasks,
  type TestContext,
} from './helpers.test'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// All scopes needed for expense tracking workflow tests
const EXPENSE_TRACKING_SCOPES = [
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
  // Execution phase scopes
  'dealToDelivery:tasks:create',
  'dealToDelivery:tasks:assign',
  'dealToDelivery:budgets:view:own',
  'dealToDelivery:projects:edit:own',
  // Expense tracking scopes
  'dealToDelivery:expenses:create',
  'dealToDelivery:expenses:edit:own',
  'dealToDelivery:expenses:submit',
  'dealToDelivery:expenses:approve', // Needed for manager override on high markup rates
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'team-member', EXPENSE_TRACKING_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Wait for async workflow operations to complete.
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
      name: 'Expense Tracking Test Company',
      billingAddress: {
        street: '456 Expense Blvd',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Dan Expense',
      email: 'dan@test.com',
      phone: '+1-555-0456',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Helper to create additional team members
 */
async function createTeamMembers(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const developerId = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'expense-dev@test.com',
      name: 'Expense Developer',
      role: 'team_member',
      costRate: 8000,
      billRate: 12000,
      skills: ['TypeScript', 'React'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    return { developerId }
  })
}

// Phase workflow helpers
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

async function getExecutionPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const executionWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'execution' }
  )
  if (executionWorkflows.length === 0) {
    throw new Error('Execution phase workflow not found')
  }
  return executionWorkflows[0]._id
}

async function getExpenseTrackingWorkflowId(
  t: TestContext,
  executionWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const expenseTrackingWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: executionWorkflowId, taskName: 'trackExpenses' }
  )
  if (expenseTrackingWorkflows.length === 0) {
    throw new Error('Expense tracking workflow not found')
  }
  return expenseTrackingWorkflows[0]._id
}

async function initializeRootWorkflow(t: TestContext) {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName: 'Expense Tracking Test Deal',
        clientName: 'Test Company',
        estimatedValue: 100000,
      },
    }
  )
  await flushWorkflow(t, 10)
  return workflowId
}

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

async function completeSalesPhaseWithWonDeal(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>
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
      name: 'Expense Tracking Test Deal',
      value: 100000,
      ownerId: userId,
    }
  )
  await flushWorkflow(t, 15)

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
      qualificationNotes: 'Qualified for expense tracking test',
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
      services: [{ name: 'Development', hours: 60, rate: 12000 }],
      notes: 'Estimate for expense tracking test',
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
      documentUrl: 'https://example.com/proposal-expense.pdf',
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
    {
      dealId,
      outcome: 'proceed',
      negotiationNotes: 'Terms accepted',
    }
  )
  await flushWorkflow(t, 15)

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

async function completePlanningPhaseSetup(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  dealId: Id<'deals'>
): Promise<{ projectId: Id<'projects'>; budgetId: Id<'budgets'>; planningWorkflowId: Id<'tasquencerWorkflows'> }> {
  const planningWorkflowId = await getPlanningPhaseWorkflowId(t, rootWorkflowId)

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

  await completeWorkItem(
    t,
    planningWorkflowId,
    'setBudget',
    ['dealToDelivery', 'planning', 'planningPhase', 'setBudget', 'setBudget'],
    {
      budgetId,
      type: 'TimeAndMaterials',
      services: [{ name: 'Development', rate: 12000, estimatedHours: 60 }],
    }
  )
  await flushWorkflow(t, 20)

  return { projectId, budgetId, planningWorkflowId }
}

async function completeResourcePlanningPhase(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  projectId: Id<'projects'>,
  developerId: Id<'users'>
): Promise<void> {
  const planningWorkflowId = await getPlanningPhaseWorkflowId(t, rootWorkflowId)
  await flushWorkflow(t, 20)

  const resourceWorkflowId = await getResourcePlanningWorkflowId(t, planningWorkflowId)

  const startDate = Date.now()
  const endDate = startDate + 14 * 24 * 60 * 60 * 1000

  await completeWorkItem(
    t,
    resourceWorkflowId,
    'viewTeamAvailability',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
    { projectId, startDate, endDate }
  )

  await completeWorkItem(
    t,
    resourceWorkflowId,
    'filterBySkillsRole',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
    { projectId, filters: {}, startDate, endDate }
  )

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

  await completeWorkItem(
    t,
    resourceWorkflowId,
    'reviewBookings',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'reviewBookings', 'reviewBookings'],
    { projectId, bookingIds }
  )

  await completeWorkItem(
    t,
    resourceWorkflowId,
    'checkConfirmationNeeded',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'checkConfirmationNeeded', 'checkConfirmationNeeded'],
    { bookingIds }
  )

  await flushWorkflow(t, 30)
}

async function completeExecutionPhaseSetup(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  projectId: Id<'projects'>,
  developerId: Id<'users'>
): Promise<{ executionWorkflowId: Id<'tasquencerWorkflows'> }> {
  const executionWorkflowId = await getExecutionPhaseWorkflowId(t, rootWorkflowId)

  await completeWorkItem(
    t,
    executionWorkflowId,
    'createAndAssignTasks',
    ['dealToDelivery', 'execution', 'executionPhase', 'createAndAssignTasks', 'createAndAssignTasks'],
    {
      projectId,
      tasks: [
        {
          name: 'Implement Feature',
          description: 'Build the feature',
          assigneeIds: [developerId],
          estimatedHours: 30,
          priority: 'High',
        },
      ],
    },
    { projectId }
  )
  await flushWorkflow(t, 20)

  return { executionWorkflowId }
}

async function progressToExpenseTrackingPhase(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  developerId: Id<'users'>
): Promise<{
  dealId: Id<'deals'>
  projectId: Id<'projects'>
  executionWorkflowId: Id<'tasquencerWorkflows'>
  expenseTrackingWorkflowId: Id<'tasquencerWorkflows'>
}> {
  const { dealId } = await completeSalesPhaseWithWonDeal(
    t,
    rootWorkflowId,
    orgId,
    userId,
    companyId,
    contactId
  )
  await flushWorkflow(t, 30)

  const { projectId } = await completePlanningPhaseSetup(t, rootWorkflowId, dealId)

  await completeResourcePlanningPhase(t, rootWorkflowId, projectId, developerId)
  await flushWorkflow(t, 30)

  const { executionWorkflowId } = await completeExecutionPhaseSetup(
    t,
    rootWorkflowId,
    projectId,
    developerId
  )
  await flushWorkflow(t, 30)

  const expenseTrackingWorkflowId = await getExpenseTrackingWorkflowId(t, executionWorkflowId)

  return { dealId, projectId, executionWorkflowId, expenseTrackingWorkflowId }
}

describe('Expense Tracking Workflow Entry', () => {
  it('trackExpenses composite task is enabled after createAndAssignTasks completes', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
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

    const { projectId } = await completePlanningPhaseSetup(testContext, rootWorkflowId, dealId)

    await completeResourcePlanningPhase(testContext, rootWorkflowId, projectId, developerId)
    await flushWorkflow(testContext, 30)

    const { executionWorkflowId } = await completeExecutionPhaseSetup(
      testContext,
      rootWorkflowId,
      projectId,
      developerId
    )

    await assertTaskState(testContext, executionWorkflowId, 'trackExpenses', 'enabled')
  })

  it('expense tracking workflow creates selectExpenseType task', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'enabled')
  })
})

describe('SelectExpenseType Work Item', () => {
  it('completes selectExpenseType and enables logOtherExpense (default routing)', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      {
        expenseType: 'Other',
        projectId,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logOtherExpense', 'enabled')
  })

  it('routes to logSoftwareExpense when Software type is selected', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      {
        expenseType: 'Software',
        projectId,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logSoftwareExpense', 'enabled')
  })

  it('routes to logTravelExpense when Travel type is selected', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      {
        expenseType: 'Travel',
        projectId,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logTravelExpense', 'enabled')
  })

  it('routes to logMaterialsExpense when Materials type is selected', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      {
        expenseType: 'Materials',
        projectId,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logMaterialsExpense', 'enabled')
  })

  it('routes to logSubcontractorExpense when Subcontractor type is selected', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      {
        expenseType: 'Subcontractor',
        projectId,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'selectExpenseType', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logSubcontractorExpense', 'enabled')
  })
})

describe('LogOtherExpense Work Item Lifecycle', () => {
  it('creates expense with Draft status', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Complete logOtherExpense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Office supplies',
        amount: 1500, // $15 in cents (below $25 threshold)
        currency: 'USD',
        date: yesterday,
        category: 'Supplies',
        vendor: 'Office Depot',
        notes: 'Pens and notebooks',
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'logOtherExpense', 'completed')

    // Verify expense was created with Draft status
    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(expenses.length).toBe(1)
    expect(expenses[0].amount).toBe(1500)
    expect(expenses[0].status).toBe('Draft')
    expect(expenses[0].type).toBe('Other')
    expect(expenses[0].billable).toBe(false)

    // Verify attachReceipt is enabled
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'attachReceipt', 'enabled')
  })
})

describe('AttachReceipt Work Item Lifecycle', () => {
  it('allows skipping receipt for expenses under $25', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Create expense under $25
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Small supplies',
        amount: 2000, // $20 in cents (below $25 threshold)
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    // Get the expense ID
    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Complete attachReceipt without receipt (should succeed for under $25)
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'attachReceipt', 'completed')
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'markBillable', 'enabled')
  })

  it('requires receipt for expenses over $25', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Create expense over $25
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Equipment purchase',
        amount: 5000, // $50 in cents (over $25 threshold)
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Initialize attachReceipt work item
    const workItems = await getTaskWorkItems(testContext, expenseTrackingWorkflowId, 'attachReceipt')
    let workItemId: Id<'tasquencerWorkItems'>

    if (workItems.length === 0) {
      workItemId = await testContext.mutation(
        internal.testing.tasquencer.initializeWorkItem,
        {
          target: {
            path: ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
            parentWorkflowId: expenseTrackingWorkflowId,
            parentTaskName: 'attachReceipt',
          },
          args: { name: 'attachReceipt' as any, payload: { expenseId } },
        }
      )
      await flushWorkflow(testContext, 5)
    } else {
      workItemId = workItems[0]._id
    }

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'attachReceipt' as any },
    })
    await flushWorkflow(testContext, 5)

    // Attempt to complete without receipt (should fail for over $25)
    await expect(
      testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
        workItemId,
        args: {
          name: 'attachReceipt',
          payload: { expenseId },
        } as any,
      })
    ).rejects.toThrow('Receipt is required')
  })
})

describe('SubmitExpense Work Item Lifecycle', () => {
  it('changes expense status from Draft to Submitted', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Complete logOtherExpense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Test expense',
        amount: 1500, // Under $25
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Complete attachReceipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Complete markBillable (non-billable)
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      {
        expenseId,
        billable: false,
      },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Complete submitExpense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'submitExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'submitExpense', 'submitExpense'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    await assertTaskState(testContext, expenseTrackingWorkflowId, 'submitExpense', 'completed')

    // Verify expense status changed to Submitted
    const updatedExpense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })

    expect(updatedExpense?.status).toBe('Submitted')
  })
})

describe('Complete Expense Tracking Flow', () => {
  it('completes full expense tracking workflow', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, executionWorkflowId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // 1. Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    // 2. Complete logOtherExpense
    const yesterday = Date.now() - 24 * 60 * 60 * 1000
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Full flow test expense',
        amount: 2000, // $20
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // 3. Complete attachReceipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // 4. Complete markBillable
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: false },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // 5. Complete submitExpense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'submitExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'submitExpense', 'submitExpense'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 30)

    // Verify expense tracking workflow completed
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'submitExpense', 'completed')

    // Verify expense is submitted
    const submittedExpense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })
    expect(submittedExpense?.status).toBe('Submitted')
    expect(submittedExpense?.amount).toBe(2000)
    expect(submittedExpense?.billable).toBe(false)

    // Verify trackExpenses composite task completed in execution workflow
    await assertTaskState(testContext, executionWorkflowId, 'trackExpenses', 'completed')

    // Verify finalizeExpenseTracking completed (dummy tasks complete immediately)
    await assertTaskState(testContext, executionWorkflowId, 'finalizeExpenseTracking', 'completed')
  })
})

describe('90-Day Age Limit for Expense Submission', () => {
  /**
   * Per spec 08-workflow-expense-tracking.md line 427:
   * "Expenses older than 90 days require approval exception"
   */
  it('rejects submission of expenses older than 90 days', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const oldDate = Date.now() - (91 * 24 * 60 * 60 * 1000) // 91 days ago

    // Create expense with old date
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Old expense',
        amount: 1500, // Under $25, no receipt needed
        currency: 'USD',
        date: oldDate,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Update date to be > 90 days old
    await testContext.run(async (ctx) => {
      const expense = await ctx.db.get(expenseId)
      if (expense) {
        await ctx.db.replace(expenseId, { ...expense, date: oldDate })
      }
    })

    // Complete attachReceipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Complete markBillable (non-billable)
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: false },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Initialize and start submitExpense work item
    const workItems = await getTaskWorkItems(testContext, expenseTrackingWorkflowId, 'submitExpense')
    let workItemId: Id<'tasquencerWorkItems'>

    if (workItems.length === 0) {
      workItemId = await testContext.mutation(
        internal.testing.tasquencer.initializeWorkItem,
        {
          target: {
            path: ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'submitExpense', 'submitExpense'],
            parentWorkflowId: expenseTrackingWorkflowId,
            parentTaskName: 'submitExpense',
          },
          args: { name: 'submitExpense' as any, payload: { expenseId } },
        }
      )
      await flushWorkflow(testContext, 5)
    } else {
      workItemId = workItems[0]._id
    }

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'submitExpense' as any },
    })
    await flushWorkflow(testContext, 5)

    // Attempt to complete - should fail because expense is > 90 days old
    await expect(
      testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
        workItemId,
        args: {
          name: 'submitExpense',
          payload: { expenseId },
        } as any,
      })
    ).rejects.toThrow('requires admin approval')
  })
})

describe('Billable Expense Routing to SetBillableRate', () => {
  /**
   * Per spec 08-workflow-expense-tracking.md:
   * When markBillable is completed with billable=true, route to setBillableRate
   */
  it('routes to setBillableRate when expense is marked billable', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Create expense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Billable expense test',
        amount: 1500,
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Complete attachReceipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Complete markBillable with billable=true
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Verify markBillable is completed
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'markBillable', 'completed')

    // Verify setBillableRate is enabled (billable routing)
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'setBillableRate', 'enabled')
  })

  /**
   * Per spec 08-workflow-expense-tracking.md:
   * When markBillable is completed with billable=false, route directly to submitExpense
   */
  it('routes to submitExpense when expense is marked non-billable', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    // Create expense
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Non-billable expense test',
        amount: 500,
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Complete attachReceipt (amount < $25, can skip receipt)
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Complete markBillable with billable=false (non-billable)
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: false },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Verify markBillable is completed
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'markBillable', 'completed')

    // Verify submitExpense is enabled (non-billable routing bypasses setBillableRate)
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'submitExpense', 'enabled')

    // Verify setBillableRate is NOT enabled (should be skipped for non-billable)
    const tasks = await getWorkflowTasks(testContext, expenseTrackingWorkflowId)
    const setBillableRateTask = tasks.find((t) => t.name === 'setBillableRate')
    // setBillableRate should either not exist or not be enabled
    if (setBillableRateTask) {
      expect(setBillableRateTask.state).not.toBe('enabled')
    }
  })
})

describe('SetBillableRate Markup Validation', () => {
  /**
   * Per spec 08-workflow-expense-tracking.md line 426:
   * "Markup cannot exceed 50% without manager override"
   * "Maximum markup with override is 100% (2.0 rate)"
   */
  it('allows markup up to 50% without manager override', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Billable expense for markup test',
        amount: 1000,
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Mark as billable to route to setBillableRate
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Set markup rate at 1.5 (50% markup) - should succeed
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'setBillableRate',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'setBillableRate', 'setBillableRate'],
      { expenseId, markupRate: 1.5, hasManagerOverride: false },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Verify setBillableRate completed
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'setBillableRate', 'completed')

    // Verify markup rate was set
    const updatedExpense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })
    expect(updatedExpense?.markupRate).toBe(1.5)
  })

  it('rejects markup over 50% without manager override', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Expense for high markup test',
        amount: 1000,
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Mark as billable to route to setBillableRate
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Initialize and start setBillableRate work item
    const workItems = await getTaskWorkItems(testContext, expenseTrackingWorkflowId, 'setBillableRate')
    let workItemId: Id<'tasquencerWorkItems'>

    if (workItems.length === 0) {
      workItemId = await testContext.mutation(
        internal.testing.tasquencer.initializeWorkItem,
        {
          target: {
            path: ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'setBillableRate', 'setBillableRate'],
            parentWorkflowId: expenseTrackingWorkflowId,
            parentTaskName: 'setBillableRate',
          },
          args: { name: 'setBillableRate' as any, payload: { expenseId } },
        }
      )
      await flushWorkflow(testContext, 5)
    } else {
      workItemId = workItems[0]._id
    }

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'setBillableRate' as any },
    })
    await flushWorkflow(testContext, 5)

    // Attempt to set markup at 1.6 (60% markup) without override - should fail
    await expect(
      testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
        workItemId,
        args: {
          name: 'setBillableRate',
          payload: { expenseId, markupRate: 1.6, hasManagerOverride: false },
        } as any,
      })
    ).rejects.toThrow('Markup rate cannot exceed 50%')
  })

  /**
   * Per spec 08-workflow-expense-tracking.md line 426:
   * "Maximum markup with override is 100% (2.0 rate)"
   * With manager override, markup up to 2.0 (100%) is allowed
   */
  it('allows markup up to 100% with manager override', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Expense for manager override test',
        amount: 2000, // 2000 cents = $20, under $25 threshold so no receipt required
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Amount is under $25 threshold, can complete without receipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Mark as billable to route to setBillableRate
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Set markup rate at 1.8 (80% markup) WITH manager override - should succeed
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'setBillableRate',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'setBillableRate', 'setBillableRate'],
      { expenseId, markupRate: 1.8, hasManagerOverride: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Verify setBillableRate completed
    await assertTaskState(testContext, expenseTrackingWorkflowId, 'setBillableRate', 'completed')

    // Verify markup rate was set
    const updatedExpense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })
    expect(updatedExpense?.markupRate).toBe(1.8)
  })

  /**
   * Per spec 08-workflow-expense-tracking.md:
   * "Maximum markup with override is 100% (2.0 rate)"
   * Markup cannot exceed 2.0 even with manager override
   */
  it('rejects markup over 100% even with manager override', async () => {
    const rootWorkflowId = await initializeRootWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )
    const { developerId } = await createTeamMembers(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    const { projectId, expenseTrackingWorkflowId } = await progressToExpenseTrackingPhase(
      testContext,
      rootWorkflowId,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      companyId,
      contactId,
      developerId
    )

    // Complete selectExpenseType
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'selectExpenseType',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'selectExpenseType', 'selectExpenseType'],
      { expenseType: 'Other', projectId },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'logOtherExpense',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'logOtherExpense', 'logOtherExpense'],
      {
        projectId,
        description: 'Expense for max markup test',
        amount: 2400, // 2400 cents = $24, under $25 threshold so no receipt required
        currency: 'USD',
        date: yesterday,
      },
      { projectId }
    )
    await flushWorkflow(testContext, 20)

    const expenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })
    const expenseId = expenses[0]._id

    // Amount is under $25 threshold, can complete without receipt
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'attachReceipt',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'attachReceipt', 'attachReceipt'],
      { expenseId },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Mark as billable to route to setBillableRate
    await completeWorkItem(
      testContext,
      expenseTrackingWorkflowId,
      'markBillable',
      ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'markBillable', 'markBillable'],
      { expenseId, billable: true },
      { expenseId }
    )
    await flushWorkflow(testContext, 20)

    // Initialize and start setBillableRate work item
    const workItems = await getTaskWorkItems(testContext, expenseTrackingWorkflowId, 'setBillableRate')
    let workItemId: Id<'tasquencerWorkItems'>

    if (workItems.length === 0) {
      workItemId = await testContext.mutation(
        internal.testing.tasquencer.initializeWorkItem,
        {
          target: {
            path: ['dealToDelivery', 'execution', 'executionPhase', 'trackExpenses', 'expenseTracking', 'setBillableRate', 'setBillableRate'],
            parentWorkflowId: expenseTrackingWorkflowId,
            parentTaskName: 'setBillableRate',
          },
          args: { name: 'setBillableRate' as any, payload: { expenseId } },
        }
      )
      await flushWorkflow(testContext, 5)
    } else {
      workItemId = workItems[0]._id
    }

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'setBillableRate' as any },
    })
    await flushWorkflow(testContext, 5)

    // Attempt to set markup at 2.5 (150% markup) even with override - should fail
    // Zod schema enforces max 2.0 (100% markup)
    await expect(
      testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
        workItemId,
        args: {
          name: 'setBillableRate',
          payload: { expenseId, markupRate: 2.5, hasManagerOverride: true },
        } as any,
      })
    ).rejects.toThrow('Too big')
  })
})
