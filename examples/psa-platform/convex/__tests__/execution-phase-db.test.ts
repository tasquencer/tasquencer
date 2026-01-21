/// <reference types="vite/client" />
/**
 * Tests for Execution Phase domain DB functions
 *
 * These tests validate the CRUD operations and business logic for
 * tasks, change orders, and budget burn calculations.
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */

import { describe, it, expect } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

// Import domain functions
import {
  insertTask,
  getTask,
  updateTaskStatus,
  listTasksByProject,
  listTasksByStatus,
  listTasksByAssignee,
  getNextTaskSortOrder,
  assignTask,
} from '../workflows/dealToDelivery/db/tasks'

import {
  insertChangeOrder,
  getChangeOrder,
  updateChangeOrderStatus,
  listPendingChangeOrdersByProject,
  approveChangeOrder,
  rejectChangeOrder,
  calculateApprovedBudgetImpact,
} from '../workflows/dealToDelivery/db/changeOrders'

import {
  insertBudget,
  getBudget,
} from '../workflows/dealToDelivery/db/budgets'

import {
  listApprovedTimeEntriesByProject,
} from '../workflows/dealToDelivery/db/timeEntries'

import {
  listApprovedExpensesByProject,
} from '../workflows/dealToDelivery/db/expenses'

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

/**
 * Create a test organization
 */
async function createTestOrganization(
  t: TestContext
): Promise<Id<'organizations'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', {
      name: 'Test Organization',
      settings: {},
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a test user
 */
async function createTestUser(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<Id<'users'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId,
      email: `user-${Date.now()}@example.com`,
      name: 'Test User',
      role: 'admin',
      costRate: 10000, // $100/hr in cents
      billRate: 15000, // $150/hr in cents
      skills: [],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
      ...overrides,
    })
  })
}

/**
 * Create a test company
 */
async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>
): Promise<Id<'companies'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId,
      name: 'Acme Corp',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })
}

/**
 * Create a test project (requires budget to be created separately)
 */
async function createTestProject(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  managerId: Id<'users'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'projects'>>> = {}
): Promise<Id<'projects'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId,
      companyId,
      name: 'Test Project',
      status: 'Active',
      startDate: Date.now(),
      managerId,
      createdAt: Date.now(),
      ...overrides,
    })
  })
}

/**
 * Create a test task
 */
async function createTestTask(
  t: TestContext,
  projectId: Id<'projects'>,
  organizationId: Id<'organizations'>,
  assigneeIds: Id<'users'>[],
  overrides: Partial<OmitIdAndCreationTime<Doc<'tasks'>>> = {}
): Promise<Id<'tasks'>> {
  return await t.run(async (ctx) => {
    const sortOrder = await getNextTaskSortOrder(ctx.db, projectId)
    return await insertTask(ctx.db, {
      projectId,
      organizationId,
      name: 'Test Task',
      description: 'A test task',
      status: 'Todo',
      assigneeIds,
      priority: 'Medium',
      dependencies: [],
      sortOrder,
      createdAt: Date.now(),
      ...overrides,
    })
  })
}

/**
 * Create base test data (org, user, company, project, budget)
 */
async function createBaseTestData(t: TestContext) {
  const orgId = await createTestOrganization(t)
  const userId = await createTestUser(t, orgId)
  const companyId = await createTestCompany(t, orgId)
  const projectId = await createTestProject(t, orgId, companyId, userId)

  // Create budget for project
  const budgetId = await t.run(async (ctx) => {
    return await insertBudget(ctx.db, {
      projectId,
      organizationId: orgId,
      type: 'TimeAndMaterials',
      totalAmount: 10000000, // $100,000 in cents
      createdAt: Date.now(),
    })
  })

  // Update project with budget reference
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { budgetId })
  })

  return { orgId, userId, companyId, projectId, budgetId }
}

// =============================================================================
// Task Tests
// =============================================================================

describe('Tasks DB Functions', () => {
  describe('insertTask', () => {
    it('should insert a new task', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const taskId = await t.run(async (ctx) => {
        return await insertTask(ctx.db, {
          projectId,
          organizationId: orgId,
          name: 'New Task',
          description: 'Task description',
          status: 'Todo',
          assigneeIds: [userId],
          priority: 'High',
          dependencies: [],
          sortOrder: 0,
          createdAt: Date.now(),
        })
      })

      expect(taskId).toBeDefined()
    })
  })

  describe('getTask', () => {
    it('should return task by ID', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const taskId = await createTestTask(t, projectId, orgId, [userId], { name: 'My Task' })

      const task = await t.run(async (ctx) => {
        return await getTask(ctx.db, taskId)
      })

      expect(task?.name).toBe('My Task')
    })

    it('should return null for non-existent task', async () => {
      const t = setup()

      const task = await t.run(async (ctx) => {
        // Create a fake ID using the dataModel convention
        const fakeId = 'nonexistent' as Id<'tasks'>
        return await getTask(ctx.db, fakeId)
      })

      expect(task).toBeNull()
    })
  })

  describe('updateTaskStatus', () => {
    it('should update task status', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const taskId = await createTestTask(t, projectId, orgId, [userId], { status: 'Todo' })

      await t.run(async (ctx) => {
        await updateTaskStatus(ctx.db, taskId, 'InProgress')
      })

      const task = await t.run(async (ctx) => {
        return await getTask(ctx.db, taskId)
      })
      expect(task?.status).toBe('InProgress')
    })

    it('should update status to OnHold', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const taskId = await createTestTask(t, projectId, orgId, [userId], { status: 'InProgress' })

      await t.run(async (ctx) => {
        await updateTaskStatus(ctx.db, taskId, 'OnHold')
      })

      const task = await t.run(async (ctx) => {
        return await getTask(ctx.db, taskId)
      })
      expect(task?.status).toBe('OnHold')
    })
  })

  describe('listTasksByProject', () => {
    it('should return all tasks for a project', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      await createTestTask(t, projectId, orgId, [userId], { name: 'Task 1' })
      await createTestTask(t, projectId, orgId, [userId], { name: 'Task 2' })
      await createTestTask(t, projectId, orgId, [userId], { name: 'Task 3' })

      const tasks = await t.run(async (ctx) => {
        return await listTasksByProject(ctx.db, projectId)
      })

      expect(tasks).toHaveLength(3)
    })
  })

  describe('listTasksByStatus', () => {
    it('should filter tasks by status', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      await createTestTask(t, projectId, orgId, [userId], { status: 'Todo' })
      await createTestTask(t, projectId, orgId, [userId], { status: 'InProgress' })
      await createTestTask(t, projectId, orgId, [userId], { status: 'Todo' })

      const todoTasks = await t.run(async (ctx) => {
        return await listTasksByStatus(ctx.db, projectId, 'Todo')
      })

      expect(todoTasks).toHaveLength(2)
    })

    it('should return OnHold tasks', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      await createTestTask(t, projectId, orgId, [userId], { status: 'InProgress' })
      await createTestTask(t, projectId, orgId, [userId], { status: 'OnHold' })

      const onHoldTasks = await t.run(async (ctx) => {
        return await listTasksByStatus(ctx.db, projectId, 'OnHold')
      })

      expect(onHoldTasks).toHaveLength(1)
    })
  })

  describe('listTasksByAssignee', () => {
    it('should filter tasks by assignee', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const userId2 = await createTestUser(t, orgId, { email: 'user2@example.com' })

      await createTestTask(t, projectId, orgId, [userId], { name: 'Task for User 1' })
      await createTestTask(t, projectId, orgId, [userId2], { name: 'Task for User 2' })
      await createTestTask(t, projectId, orgId, [userId, userId2], { name: 'Shared Task' })

      const user1Tasks = await t.run(async (ctx) => {
        return await listTasksByAssignee(ctx.db, projectId, userId)
      })

      expect(user1Tasks).toHaveLength(2) // Own task + shared task
    })
  })

  describe('getNextTaskSortOrder', () => {
    it('should return 0 for empty project', async () => {
      const t = setup()
      const { projectId } = await createBaseTestData(t)

      const sortOrder = await t.run(async (ctx) => {
        return await getNextTaskSortOrder(ctx.db, projectId)
      })

      expect(sortOrder).toBe(0)
    })

    it('should increment sort order', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      await createTestTask(t, projectId, orgId, [userId], { sortOrder: 5 })

      const sortOrder = await t.run(async (ctx) => {
        return await getNextTaskSortOrder(ctx.db, projectId)
      })

      expect(sortOrder).toBe(6)
    })
  })

  describe('assignTask', () => {
    it('should update task assignees', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const userId2 = await createTestUser(t, orgId, { email: 'user2@example.com' })
      const taskId = await createTestTask(t, projectId, orgId, [userId])

      await t.run(async (ctx) => {
        await assignTask(ctx.db, taskId, [userId2])
      })

      const task = await t.run(async (ctx) => {
        return await getTask(ctx.db, taskId)
      })
      expect(task?.assigneeIds).toEqual([userId2])
    })
  })
})

// =============================================================================
// Change Order Tests
// =============================================================================

describe('Change Orders DB Functions', () => {
  describe('insertChangeOrder', () => {
    it('should insert a new change order', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const changeOrderId = await t.run(async (ctx) => {
        return await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Additional scope',
          justification: 'Test justification',
          budgetImpact: 500000, // $5,000
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      expect(changeOrderId).toBeDefined()
    })
  })

  describe('getChangeOrder', () => {
    it('should return change order by ID', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const changeOrderId = await t.run(async (ctx) => {
        return await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Scope change',
          justification: 'Test justification',
          budgetImpact: 100000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      const changeOrder = await t.run(async (ctx) => {
        return await getChangeOrder(ctx.db, changeOrderId)
      })

      expect(changeOrder?.description).toBe('Scope change')
    })
  })

  describe('updateChangeOrderStatus', () => {
    it('should update change order status', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const changeOrderId = await t.run(async (ctx) => {
        return await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Test CO',
          justification: 'Test justification',
          budgetImpact: 50000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await updateChangeOrderStatus(ctx.db, changeOrderId, 'Approved')
      })

      const changeOrder = await t.run(async (ctx) => {
        return await getChangeOrder(ctx.db, changeOrderId)
      })
      expect(changeOrder?.status).toBe('Approved')
    })
  })

  describe('approveChangeOrder', () => {
    it('should approve with approver and timestamp', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const approverId = await createTestUser(t, orgId, { email: 'approver@example.com' })

      const changeOrderId = await t.run(async (ctx) => {
        return await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Needs approval',
          justification: 'Test justification',
          budgetImpact: 75000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      const beforeApproval = Date.now()

      await t.run(async (ctx) => {
        await approveChangeOrder(ctx.db, changeOrderId, approverId)
      })

      const changeOrder = await t.run(async (ctx) => {
        return await getChangeOrder(ctx.db, changeOrderId)
      })

      expect(changeOrder?.status).toBe('Approved')
      expect(changeOrder?.approvedBy).toBe(approverId)
      expect(changeOrder?.approvedAt).toBeGreaterThanOrEqual(beforeApproval)
    })
  })

  describe('rejectChangeOrder', () => {
    it('should set status to Rejected', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const changeOrderId = await t.run(async (ctx) => {
        return await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Will be rejected',
          justification: 'Test justification',
          budgetImpact: 25000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await rejectChangeOrder(ctx.db, changeOrderId)
      })

      const changeOrder = await t.run(async (ctx) => {
        return await getChangeOrder(ctx.db, changeOrderId)
      })
      expect(changeOrder?.status).toBe('Rejected')
    })
  })

  describe('listPendingChangeOrdersByProject', () => {
    it('should return only pending change orders', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      // Create pending change orders
      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Pending 1',
          justification: 'Test justification',
          budgetImpact: 10000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Pending 2',
          justification: 'Test justification',
          budgetImpact: 20000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      // Create approved change order (should not be in list)
      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Approved',
          justification: 'Test justification',
          budgetImpact: 30000,
          status: 'Approved',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      const pending = await t.run(async (ctx) => {
        return await listPendingChangeOrdersByProject(ctx.db, projectId)
      })

      expect(pending).toHaveLength(2)
      expect(pending.every(co => co.status === 'Pending')).toBe(true)
    })
  })

  describe('calculateApprovedBudgetImpact', () => {
    it('should sum only approved change order impacts', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      // Create approved change orders
      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Approved 1',
          justification: 'Test justification',
          budgetImpact: 100000, // $1,000
          status: 'Approved',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Approved 2',
          justification: 'Test justification',
          budgetImpact: 200000, // $2,000
          status: 'Approved',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      // Pending should not count
      await t.run(async (ctx) => {
        await insertChangeOrder(ctx.db, {
          organizationId: orgId,
          projectId,
          description: 'Pending',
          justification: 'Test justification',
          budgetImpact: 500000,
          status: 'Pending',
          requestedBy: userId,
          createdAt: Date.now(),
        })
      })

      const total = await t.run(async (ctx) => {
        return await calculateApprovedBudgetImpact(ctx.db, projectId)
      })

      expect(total).toBe(300000) // $3,000
    })

    it('should return 0 for no approved change orders', async () => {
      const t = setup()
      const { projectId } = await createBaseTestData(t)

      const total = await t.run(async (ctx) => {
        return await calculateApprovedBudgetImpact(ctx.db, projectId)
      })

      expect(total).toBe(0)
    })
  })
})

// =============================================================================
// Budget Burn Calculation Tests
// =============================================================================

describe('Budget Burn Calculations', () => {
  describe('listApprovedTimeEntriesByProject', () => {
    it('should return only approved time entries', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      // Create approved time entries
      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // Draft should not be included
      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 2,
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listApprovedTimeEntriesByProject(ctx.db, projectId)
      })

      expect(entries).toHaveLength(2)
      expect(entries.reduce((sum, e) => sum + e.hours, 0)).toBe(12)
    })
  })

  describe('listApprovedExpensesByProject', () => {
    it('should return only approved expenses', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      // Create approved expenses
      await t.run(async (ctx) => {
        await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          amount: 50000, // $500
          currency: 'USD',
          type: 'Software',
          status: 'Approved',
          billable: true,
          description: 'Software license',
          createdAt: Date.now(),
        })
      })

      // Pending should not be included
      await t.run(async (ctx) => {
        await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          amount: 100000, // $1,000
          currency: 'USD',
          type: 'Travel',
          status: 'Submitted',
          billable: true,
          description: 'Flight',
          createdAt: Date.now(),
        })
      })

      const expenses = await t.run(async (ctx) => {
        return await listApprovedExpensesByProject(ctx.db, projectId)
      })

      expect(expenses).toHaveLength(1)
      expect(expenses[0].amount).toBe(50000)
    })
  })

  describe('Budget burn calculation integration', () => {
    it('should calculate total costs from time and expenses', async () => {
      const t = setup()
      const { orgId, userId, projectId, budgetId } = await createBaseTestData(t)

      // Add some approved time entries
      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 10,
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // Add approved expense
      await t.run(async (ctx) => {
        await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          amount: 20000, // $200
          currency: 'USD',
          type: 'Materials',
          status: 'Approved',
          billable: true,
          description: 'Office supplies',
          createdAt: Date.now(),
        })
      })

      // Calculate costs
      const result = await t.run(async (ctx) => {
        const user = await ctx.db.get(userId)
        const timeEntries = await listApprovedTimeEntriesByProject(ctx.db, projectId)
        const expenses = await listApprovedExpensesByProject(ctx.db, projectId)
        const budget = await getBudget(ctx.db, budgetId)

        // Calculate time cost: hours × costRate
        let timeCost = 0
        for (const entry of timeEntries) {
          if (user) {
            timeCost += entry.hours * user.costRate
          }
        }

        // Calculate expense cost
        const expenseCost = expenses.reduce((sum, e) => sum + e.amount, 0)

        const totalCost = timeCost + expenseCost
        const budgetTotal = budget?.totalAmount || 0
        const burnRate = budgetTotal > 0 ? totalCost / budgetTotal : 0

        return { timeCost, expenseCost, totalCost, burnRate }
      })

      // 10 hours × $100/hr = $1,000 (100000 cents)
      expect(result.timeCost).toBe(100000)
      // $200 in expenses
      expect(result.expenseCost).toBe(20000)
      // Total $1,200
      expect(result.totalCost).toBe(120000)
      // Burn rate: $1,200 / $100,000 = 1.2%
      expect(result.burnRate).toBeCloseTo(0.012, 3)
    })

    it('should detect budget overrun at 90% threshold', async () => {
      const t = setup()
      const { orgId, userId, projectId, budgetId } = await createBaseTestData(t)

      // Add enough time to exceed 90% of budget
      // Budget is $100,000, so we need > $90,000 in costs
      // At $100/hr, that's 900 hours
      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 950, // 950 × $100 = $95,000
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const result = await t.run(async (ctx) => {
        const user = await ctx.db.get(userId)
        const timeEntries = await listApprovedTimeEntriesByProject(ctx.db, projectId)
        const budget = await getBudget(ctx.db, budgetId)

        let timeCost = 0
        for (const entry of timeEntries) {
          if (user) {
            timeCost += entry.hours * user.costRate
          }
        }

        const budgetTotal = budget?.totalAmount || 0
        const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0
        const OVERRUN_THRESHOLD = 0.9
        const budgetOk = burnRate <= OVERRUN_THRESHOLD

        return { timeCost, burnRate, budgetOk }
      })

      // 950 × $100 = $95,000 (9500000 cents)
      expect(result.timeCost).toBe(9500000)
      // Burn rate: 95%
      expect(result.burnRate).toBeCloseTo(0.95, 2)
      // Over 90% threshold
      expect(result.budgetOk).toBe(false)
    })
  })
})
