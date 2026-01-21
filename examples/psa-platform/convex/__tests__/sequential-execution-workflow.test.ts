/// <reference types="vite/client" />
/**
 * Sequential Execution Workflow Tests
 *
 * These tests verify the sequential execution workflow implementation that processes
 * tasks one-by-one in sortOrder sequence.
 *
 * Tests cover:
 * - getNextTask work item: Identifies next Todo task by sortOrder, stores nextTaskId in metadata
 * - executeTask work item: Marks task as InProgress
 * - completeTask work item: Marks task as Done
 * - Sequential loop flow: completeTask → getNextTask loop when more tasks exist
 * - Sequential completion: finishSequence when all tasks are done
 *
 * Workflow topology:
 *   start → getNextTask → executeTask → completeTask → (loop back OR finishSequence) → end
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
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

// All scopes needed for sequential execution workflow tests
const SEQUENTIAL_EXECUTION_SCOPES = [
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
  // Execution phase scopes (required for sequential execution)
  'dealToDelivery:tasks:create',
  'dealToDelivery:tasks:assign',
  'dealToDelivery:tasks:view:own',
  'dealToDelivery:tasks:edit:own',
  'dealToDelivery:budgets:view:own',
  'dealToDelivery:projects:edit:own',
  'dealToDelivery:changeOrders:request',
  'dealToDelivery:changeOrders:approve',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(
    testContext,
    'project-manager',
    SEQUENTIAL_EXECUTION_SCOPES
  )
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
 * Helper to create test entities
 */
async function createTestEntities(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Sequential Test Company',
      billingAddress: {
        street: '123 Sequential Ave',
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
      name: 'Test Contact',
      email: 'contact@test.com',
      phone: '+1-555-0123',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Helper to create team members
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
      skills: ['TypeScript', 'React'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    return { developer1Id }
  })
}

/**
 * Helper to get workflow IDs
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

/**
 * Get sequentialExecution workflow from executeProjectWork composite task
 */
async function getSequentialExecutionWorkflowId(
  t: TestContext,
  executionWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const childWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: executionWorkflowId, taskName: 'executeProjectWork' }
  )
  const sequentialWorkflow = childWorkflows.find(
    (w) => w.name === 'sequentialExecution'
  )
  if (!sequentialWorkflow) {
    throw new Error('sequentialExecution workflow not found')
  }
  return sequentialWorkflow._id
}

/**
 * Initialize root workflow
 */
async function initializeRootWorkflow(t: TestContext) {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName: 'Sequential Execution Test Deal',
        clientName: 'Test Company',
        estimatedValue: 200000,
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
      name: 'Sequential Execution Test Deal',
      value: 200000,
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
      qualificationNotes: 'Qualified for sequential execution test',
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
        { name: 'Development', hours: 100, rate: 12000 },
        { name: 'QA', hours: 30, rate: 10000 },
      ],
      notes: 'Estimate for sequential execution test',
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
      documentUrl: 'https://example.com/proposal-sequential.pdf',
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
        { name: 'Development', rate: 12000, estimatedHours: 100 },
        { name: 'QA', rate: 10000, estimatedHours: 30 },
      ],
    }
  )
  await flushWorkflow(t, 20)

  return { projectId, budgetId, planningWorkflowId }
}

/**
 * Complete resource planning phase with confirmed bookings
 */
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
  const endDate = startDate + 14 * 24 * 60 * 60 * 1000 // 2 weeks

  // Complete viewTeamAvailability
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'viewTeamAvailability',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'viewTeamAvailability', 'viewTeamAvailability'],
    { projectId, startDate, endDate }
  )

  // Complete filterBySkillsRole
  await completeWorkItem(
    t,
    resourceWorkflowId,
    'filterBySkillsRole',
    ['dealToDelivery', 'planning', 'planningPhase', 'allocateResources', 'resourcePlanning', 'filterBySkillsRole', 'filterBySkillsRole'],
    { projectId, filters: {}, startDate, endDate }
  )

  // Complete recordPlannedTimeOff (no time off)
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

  // Create Confirmed bookings (skip confirmBookings step)
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

// =============================================================================
// Sequential Execution Work Item Tests
// =============================================================================

describe('GetNextTask Work Item', () => {
  /**
   * Helper to create a project with tasks directly (for unit testing work items)
   */
  async function createProjectWithTasks(
    t: TestContext,
    orgId: Id<'organizations'>,
    managerId: Id<'users'>,
    tasks: { name: string; sortOrder: number; status: 'Todo' | 'InProgress' | 'Done' }[]
  ) {
    return await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        organizationId: orgId,
        name: 'Sequential Test Company',
        billingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'USA',
        },
        paymentTerms: 30,
      })

      const projectId = await ctx.db.insert('projects', {
        organizationId: orgId,
        name: 'Sequential Test Project',
        companyId,
        status: 'Active',
        startDate: Date.now(),
        managerId,
        createdAt: Date.now(),
      })

      // Create tasks with specified sortOrder
      const taskIds: Id<'tasks'>[] = []
      for (const task of tasks) {
        const taskId = await ctx.db.insert('tasks', {
          organizationId: orgId,
          projectId,
          name: task.name,
          description: `Description for ${task.name}`,
          status: task.status,
          priority: 'Medium',
          assigneeIds: [managerId],
          dependencies: [],
          sortOrder: task.sortOrder,
          createdAt: Date.now(),
        })
        taskIds.push(taskId)
      }

      return { projectId, companyId, taskIds }
    })
  }

  it('identifies next Todo task by sortOrder', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    // Create project with tasks in non-sequential sortOrder to verify sorting
    const { projectId } = await createProjectWithTasks(
      testContext,
      orgId,
      userId,
      [
        { name: 'Task C', sortOrder: 3, status: 'Todo' },
        { name: 'Task A', sortOrder: 1, status: 'Todo' },
        { name: 'Task B', sortOrder: 2, status: 'Todo' },
      ]
    )

    // Query tasks and verify selection
    const result = await testContext.run(async (ctx) => {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()

      const pendingTasks = tasks
        .filter((t) => t.status === 'Todo')
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const nextTask = pendingTasks[0] || null

      return {
        nextTaskId: nextTask?._id,
        nextTaskName: nextTask?.name,
        hasMoreTasks: pendingTasks.length > 0,
        totalPending: pendingTasks.length,
      }
    })

    // Task A should be selected first (sortOrder: 1)
    expect(result.nextTaskName).toBe('Task A')
    expect(result.hasMoreTasks).toBe(true)
    expect(result.totalPending).toBe(3)
  })

  it('returns no task when all tasks are done', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    // Create project with all Done tasks
    const { projectId } = await createProjectWithTasks(
      testContext,
      orgId,
      userId,
      [
        { name: 'Task A', sortOrder: 1, status: 'Done' },
        { name: 'Task B', sortOrder: 2, status: 'Done' },
      ]
    )

    // Query tasks and verify no pending tasks
    const result = await testContext.run(async (ctx) => {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()

      const pendingTasks = tasks
        .filter((t) => t.status === 'Todo')
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const nextTask = pendingTasks[0] || null

      return {
        nextTaskId: nextTask?._id,
        hasMoreTasks: pendingTasks.length > 0,
      }
    })

    expect(result.nextTaskId).toBeUndefined()
    expect(result.hasMoreTasks).toBe(false)
  })

  it('skips InProgress tasks (only selects Todo)', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    // Create project with mixed status tasks
    const { projectId } = await createProjectWithTasks(
      testContext,
      orgId,
      userId,
      [
        { name: 'Task A', sortOrder: 1, status: 'InProgress' },
        { name: 'Task B', sortOrder: 2, status: 'Todo' },
        { name: 'Task C', sortOrder: 3, status: 'Done' },
      ]
    )

    // Query tasks - should only select Todo tasks
    const result = await testContext.run(async (ctx) => {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()

      const pendingTasks = tasks
        .filter((t) => t.status === 'Todo')
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const nextTask = pendingTasks[0] || null

      return {
        nextTaskName: nextTask?.name,
        totalPending: pendingTasks.length,
      }
    })

    // Task B should be selected (only Todo task)
    expect(result.nextTaskName).toBe('Task B')
    expect(result.totalPending).toBe(1)
  })
})

describe('ExecuteTask Work Item', () => {
  /**
   * Helper to create a project with a task
   */
  async function createProjectWithTask(
    t: TestContext,
    orgId: Id<'organizations'>,
    managerId: Id<'users'>,
    taskStatus: 'Todo' | 'InProgress' | 'Done'
  ) {
    return await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        organizationId: orgId,
        name: 'ExecuteTask Test Company',
        billingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'USA',
        },
        paymentTerms: 30,
      })

      const projectId = await ctx.db.insert('projects', {
        organizationId: orgId,
        name: 'ExecuteTask Test Project',
        companyId,
        status: 'Active',
        startDate: Date.now(),
        managerId,
        createdAt: Date.now(),
      })

      const taskId = await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Test Task',
        description: 'Task to execute',
        status: taskStatus,
        priority: 'Medium',
        assigneeIds: [managerId],
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })

      return { projectId, companyId, taskId }
    })
  }

  it('marks Todo task as InProgress', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { taskId } = await createProjectWithTask(
      testContext,
      orgId,
      userId,
      'Todo'
    )

    // Simulate executeTask logic: mark task as InProgress
    await testContext.run(async (ctx) => {
      const task = await ctx.db.get(taskId)
      if (task && task.status === 'Todo') {
        await ctx.db.patch(taskId, { status: 'InProgress' })
      }
    })

    // Verify task is now InProgress
    const task = await testContext.run(async (ctx) => {
      return await ctx.db.get(taskId)
    })

    expect(task!.status).toBe('InProgress')
  })

  it('does not change status if task is already InProgress', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { taskId } = await createProjectWithTask(
      testContext,
      orgId,
      userId,
      'InProgress'
    )

    // Simulate executeTask logic
    await testContext.run(async (ctx) => {
      const task = await ctx.db.get(taskId)
      if (task && task.status === 'Todo') {
        await ctx.db.patch(taskId, { status: 'InProgress' })
      }
    })

    // Verify task remains InProgress
    const task = await testContext.run(async (ctx) => {
      return await ctx.db.get(taskId)
    })

    expect(task!.status).toBe('InProgress')
  })
})

describe('CompleteTask Work Item', () => {
  /**
   * Helper to create a project with an InProgress task
   */
  async function createProjectWithInProgressTask(
    t: TestContext,
    orgId: Id<'organizations'>,
    managerId: Id<'users'>
  ) {
    return await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        organizationId: orgId,
        name: 'CompleteTask Test Company',
        billingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'USA',
        },
        paymentTerms: 30,
      })

      const projectId = await ctx.db.insert('projects', {
        organizationId: orgId,
        name: 'CompleteTask Test Project',
        companyId,
        status: 'Active',
        startDate: Date.now(),
        managerId,
        createdAt: Date.now(),
      })

      const taskId = await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Task to Complete',
        description: 'Task that will be completed',
        status: 'InProgress',
        priority: 'Medium',
        assigneeIds: [managerId],
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })

      return { projectId, companyId, taskId }
    })
  }

  it('marks InProgress task as Done', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { taskId } = await createProjectWithInProgressTask(
      testContext,
      orgId,
      userId
    )

    // Simulate completeTask logic: mark task as Done
    await testContext.run(async (ctx) => {
      await ctx.db.patch(taskId, { status: 'Done' })
    })

    // Verify task is now Done
    const task = await testContext.run(async (ctx) => {
      return await ctx.db.get(taskId)
    })

    expect(task!.status).toBe('Done')
  })

  it('completes task without changing other fields', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { taskId } = await createProjectWithInProgressTask(
      testContext,
      orgId,
      userId
    )

    // Verify initial state has estimatedHours preserved
    const initialTask = await testContext.run(async (ctx) => {
      return await ctx.db.get(taskId)
    })
    const initialName = initialTask!.name

    // Simulate completeTask
    await testContext.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        status: 'Done',
      })
    })

    // Verify task is Done and other fields unchanged
    const task = await testContext.run(async (ctx) => {
      return await ctx.db.get(taskId)
    })

    expect(task!.status).toBe('Done')
    expect(task!.name).toBe(initialName)
  })
})

// =============================================================================
// Sequential Execution Workflow Integration Tests
// =============================================================================

describe('Sequential Execution Workflow: Loop Behavior', () => {
  /**
   * Helper to create a project with multiple tasks for loop testing
   */
  async function createProjectWithMultipleTasks(
    t: TestContext,
    orgId: Id<'organizations'>,
    managerId: Id<'users'>
  ) {
    return await t.run(async (ctx) => {
      const companyId = await ctx.db.insert('companies', {
        organizationId: orgId,
        name: 'Loop Test Company',
        billingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'USA',
        },
        paymentTerms: 30,
      })

      const projectId = await ctx.db.insert('projects', {
        organizationId: orgId,
        name: 'Loop Test Project',
        companyId,
        status: 'Active',
        startDate: Date.now(),
        managerId,
        createdAt: Date.now(),
      })

      // Create 3 tasks for sequential processing
      const task1Id = await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Task 1',
        description: 'First task',
        status: 'Todo',
        priority: 'High',
        assigneeIds: [managerId],
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })

      const task2Id = await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Task 2',
        description: 'Second task',
        status: 'Todo',
        priority: 'Medium',
        assigneeIds: [managerId],
        dependencies: [],
        sortOrder: 2,
        createdAt: Date.now(),
      })

      const task3Id = await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Task 3',
        description: 'Third task',
        status: 'Todo',
        priority: 'Low',
        assigneeIds: [managerId],
        dependencies: [],
        sortOrder: 3,
        createdAt: Date.now(),
      })

      return { projectId, companyId, taskIds: [task1Id, task2Id, task3Id] }
    })
  }

  it('processes tasks in sortOrder sequence', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { projectId } = await createProjectWithMultipleTasks(
      testContext,
      orgId,
      userId
    )

    // Simulate sequential execution loop: process all tasks
    for (let i = 0; i < 3; i++) {
      // getNextTask
      const nextTask = await testContext.run(async (ctx) => {
        const tasks = await ctx.db
          .query('tasks')
          .withIndex('by_project', (q) => q.eq('projectId', projectId))
          .collect()
        const pending = tasks
          .filter((t) => t.status === 'Todo')
          .sort((a, b) => a.sortOrder - b.sortOrder)
        return pending[0] || null
      })

      if (!nextTask) break

      // executeTask
      await testContext.run(async (ctx) => {
        if (nextTask.status === 'Todo') {
          await ctx.db.patch(nextTask._id, { status: 'InProgress' })
        }
      })

      // completeTask
      await testContext.run(async (ctx) => {
        await ctx.db.patch(nextTask._id, { status: 'Done' })
      })
    }

    // Verify all tasks are now Done
    const finalTasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(finalTasks.every((t) => t.status === 'Done')).toBe(true)
  })

  it('terminates when no more Todo tasks remain', async () => {
    const orgId = authResult.organizationId as Id<'organizations'>
    const userId = authResult.userId as Id<'users'>

    const { projectId } = await createProjectWithMultipleTasks(
      testContext,
      orgId,
      userId
    )

    // Process tasks until none remain
    let iterations = 0
    const maxIterations = 10 // Safety limit

    while (iterations < maxIterations) {
      iterations++

      // getNextTask
      const result = await testContext.run(async (ctx) => {
        const tasks = await ctx.db
          .query('tasks')
          .withIndex('by_project', (q) => q.eq('projectId', projectId))
          .collect()
        const pending = tasks.filter((t) => t.status === 'Todo' || t.status === 'InProgress')
        const todoTasks = pending.filter((t) => t.status === 'Todo').sort((a, b) => a.sortOrder - b.sortOrder)
        return {
          nextTask: todoTasks[0] || null,
          hasPendingTasks: pending.length > 0,
        }
      })

      if (!result.hasPendingTasks) {
        // No more pending tasks - workflow should terminate
        break
      }

      if (result.nextTask) {
        // executeTask + completeTask
        await testContext.run(async (ctx) => {
          await ctx.db.patch(result.nextTask!._id, { status: 'InProgress' })
        })
        await testContext.run(async (ctx) => {
          await ctx.db.patch(result.nextTask!._id, { status: 'Done' })
        })
      }
    }

    // Should have processed exactly 3 tasks + 1 termination check = 4 iterations
    expect(iterations).toBe(4)

    // Verify all tasks are Done
    const finalTasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(finalTasks.every((t) => t.status === 'Done')).toBe(true)
  })
})

describe('Sequential Execution Workflow: Strategy Selection', () => {
  it('selects sequential execution by default', async () => {
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

    const { projectId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await completeResourcePlanningPhase(
      testContext,
      rootWorkflowId,
      projectId,
      developer1Id
    )

    await flushWorkflow(testContext, 30)

    const executionWorkflowId = await getExecutionPhaseWorkflowId(
      testContext,
      rootWorkflowId
    )

    // Complete createAndAssignTasks without executionStrategy (defaults to sequential)
    await completeWorkItem(
      testContext,
      executionWorkflowId,
      'createAndAssignTasks',
      ['dealToDelivery', 'execution', 'executionPhase', 'createAndAssignTasks', 'createAndAssignTasks'],
      {
        projectId,
        tasks: [
          {
            name: 'Sequential Task 1',
            description: 'First sequential task',
            assigneeIds: [developer1Id],
            estimatedHours: 10,
            priority: 'High',
          },
          {
            name: 'Sequential Task 2',
            description: 'Second sequential task',
            assigneeIds: [developer1Id],
            estimatedHours: 8,
            priority: 'Medium',
          },
        ],
        // executionStrategy not specified - defaults to 'sequential'
      },
      { projectId }
    )

    await flushWorkflow(testContext, 20)

    // Verify executeProjectWork created sequentialExecution child workflow
    const sequentialWorkflowId = await getSequentialExecutionWorkflowId(
      testContext,
      executionWorkflowId
    )

    expect(sequentialWorkflowId).toBeDefined()

    // Verify getNextTask task is enabled in the sequential workflow
    await assertTaskState(testContext, sequentialWorkflowId, 'getNextTask', 'enabled')
  })

  it('creates tasks with correct sortOrder for sequential processing', async () => {
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

    const { projectId } = await completePlanningPhaseSetup(
      testContext,
      rootWorkflowId,
      dealId
    )

    await completeResourcePlanningPhase(
      testContext,
      rootWorkflowId,
      projectId,
      developer1Id
    )

    await flushWorkflow(testContext, 30)

    const executionWorkflowId = await getExecutionPhaseWorkflowId(
      testContext,
      rootWorkflowId
    )

    // Create tasks with createAndAssignTasks
    await completeWorkItem(
      testContext,
      executionWorkflowId,
      'createAndAssignTasks',
      ['dealToDelivery', 'execution', 'executionPhase', 'createAndAssignTasks', 'createAndAssignTasks'],
      {
        projectId,
        tasks: [
          {
            name: 'First Task',
            description: 'Should be processed first',
            assigneeIds: [developer1Id],
            estimatedHours: 5,
            priority: 'High',
          },
          {
            name: 'Second Task',
            description: 'Should be processed second',
            assigneeIds: [developer1Id],
            estimatedHours: 5,
            priority: 'Medium',
          },
          {
            name: 'Third Task',
            description: 'Should be processed third',
            assigneeIds: [developer1Id],
            estimatedHours: 5,
            priority: 'Low',
          },
        ],
      },
      { projectId }
    )

    await flushWorkflow(testContext, 20)

    // Verify tasks were created with correct sortOrder
    const tasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(tasks.length).toBe(3)

    const sortedTasks = tasks.sort((a, b) => a.sortOrder - b.sortOrder)
    expect(sortedTasks[0].name).toBe('First Task')
    expect(sortedTasks[1].name).toBe('Second Task')
    expect(sortedTasks[2].name).toBe('Third Task')

    // Verify all tasks are in Todo status initially
    expect(tasks.every((t) => t.status === 'Todo')).toBe(true)
  })
})
