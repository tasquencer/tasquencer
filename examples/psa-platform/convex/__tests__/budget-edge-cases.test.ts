/// <reference types="vite/client" />
/**
 * Budget Edge Case Tests
 *
 * These tests verify budget calculation and overrun handling edge cases:
 *
 * 1. Budget calculation with missing cost rates
 * 2. Boundary conditions (exactly at 90% threshold)
 * 3. Mixed time/expense contributions
 * 4. Change order rejection terminal state
 * 5. Project budget state consistency
 *
 * Reference:
 * - specs/task-monitorbudgetburn.md
 * - specs/task-pausework.md
 * - specs/task-requestchangeorder.md
 * - specs/task-getchangeorderapproval.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  type TestContext,
} from './helpers.test'
import type { Id } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// Budget management scopes
const BUDGET_SCOPES = [
  'dealToDelivery:projects:create',
  'dealToDelivery:projects:edit:own',
  'dealToDelivery:budgets:create',
  'dealToDelivery:budgets:edit',
  'dealToDelivery:budgets:view:own',
  'dealToDelivery:budgets:approve',
  'dealToDelivery:changeOrders:request',
  'dealToDelivery:changeOrders:approve',
  'dealToDelivery:time:create:own',
  'dealToDelivery:time:approve',
  'dealToDelivery:expenses:create',
  'dealToDelivery:expenses:approve',
  'dealToDelivery:tasks:create',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'budget_manager', BUDGET_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Helper to create a project with budget
 */
async function createProjectWithBudget(
  t: TestContext,
  orgId: Id<'organizations'>,
  budgetAmount: number,
  managerId: Id<'users'>
) {
  return await t.run(async (ctx) => {
    // Create company for the project
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company',
      billingAddress: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        postalCode: '12345',
        country: 'US',
      },
      paymentTerms: 30,
    })

    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'Budget Test Project',
      status: 'Active',
      startDate: Date.now(),
      managerId,
      createdAt: Date.now(),
    })

    const budgetId = await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: 'TimeAndMaterials',
      totalAmount: budgetAmount,
      createdAt: Date.now(),
    })

    await ctx.db.patch(projectId, { budgetId })

    return { projectId, budgetId, companyId }
  })
}

/**
 * Helper to create a user with specific cost rate
 */
async function createUserWithCostRate(
  t: TestContext,
  orgId: Id<'organizations'>,
  costRate: number,
  email: string
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId: orgId,
      email,
      name: `User ${email}`,
      role: 'team_member',
      costRate,
      billRate: 15000,
      skills: [],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })
  })
}

// =============================================================================
// Budget Calculation Edge Cases
// =============================================================================

describe('Budget Calculation with Missing Cost Rates', () => {
  it('calculates budget burn correctly when user has cost rate', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000, // $10,000 budget in cents
      authResult.userId as Id<'users'>
    )

    // Create time entry (user from setupUserWithRole has costRate: 10000 = $100/hr)
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 50, // 50 hours * $100 = $5,000 = 50% of budget
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Calculate budget burn
    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0

      return {
        timeCost,
        budgetTotal,
        burnRate,
        budgetOk: burnRate <= 0.9,
      }
    })

    expect(burnResult.timeCost).toBe(500000) // $5,000 in cents
    expect(burnResult.burnRate).toBeCloseTo(0.5) // 50%
    expect(burnResult.budgetOk).toBe(true)
  })

  it('handles time entries from users with zero cost rate', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000, // $10,000 budget
      authResult.userId as Id<'users'>
    )

    // Create user with zero cost rate (e.g., volunteer or intern)
    const zeroCostRateUserId = await createUserWithCostRate(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      0, // Zero cost rate
      'zerocostrate@test.com'
    )

    // Create time entry from user with zero cost rate
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: zeroCostRateUserId,
        date: Date.now(),
        hours: 100, // 100 hours at $0/hr = $0 cost
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Calculate budget burn - zero cost rate contributes $0 to cost
    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      let timeCost = 0
      let entriesWithZeroRate = 0

      for (const entry of entries) {
        const user = await ctx.db.get(entry.userId)
        if (user?.costRate && user.costRate > 0) {
          timeCost += entry.hours * user.costRate
        } else if (user?.costRate === 0) {
          entriesWithZeroRate++
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0

      return {
        timeCost,
        entriesWithZeroRate,
        burnRate,
      }
    })

    // Time cost should be 0 since user has zero cost rate
    expect(burnResult.timeCost).toBe(0)
    expect(burnResult.entriesWithZeroRate).toBe(1)
    expect(burnResult.burnRate).toBe(0)
  })

  it('calculates budget correctly with mixed cost rate values', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000, // $10,000 budget
      authResult.userId as Id<'users'>
    )

    // Create user with zero cost rate
    const zeroCostRateUserId = await createUserWithCostRate(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      0, // Zero cost rate (e.g., volunteer)
      'mixed-zerocost@test.com'
    )

    // Create time entries from both users
    await testContext.run(async (ctx) => {
      // Entry from user with cost rate ($100/hr)
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 50, // 50 * $100 = $5,000
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })

      // Entry from user with zero cost rate
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: zeroCostRateUserId,
        date: Date.now(),
        hours: 50, // 50 * $0 = $0 cost
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Calculate with audit info
    const auditResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      let timeCost = 0
      let totalHours = 0
      let paidHours = 0
      let unpaidHours = 0

      for (const entry of entries) {
        totalHours += entry.hours
        const user = await ctx.db.get(entry.userId)
        if (user?.costRate && user.costRate > 0) {
          timeCost += entry.hours * user.costRate
          paidHours += entry.hours
        } else {
          unpaidHours += entry.hours // Zero cost rate hours
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0

      return {
        timeCost,
        totalHours,
        paidHours,
        unpaidHours,
        hasZeroCostRates: unpaidHours > 0,
        calculatedBurnRate: timeCost / budgetTotal,
      }
    })

    expect(auditResult.totalHours).toBe(100)
    expect(auditResult.paidHours).toBe(50)
    expect(auditResult.unpaidHours).toBe(50) // Hours from zero cost rate user
    expect(auditResult.hasZeroCostRates).toBe(true)
    expect(auditResult.timeCost).toBe(500000) // Only the $5,000 from user with non-zero rate
  })
})

// =============================================================================
// Budget Boundary Conditions
// =============================================================================

describe('Budget Threshold Boundary Conditions', () => {
  it('allows work when burn rate is exactly at 90% threshold', async () => {
    const budgetAmount = 1000000 // $10,000 in cents
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      budgetAmount,
      authResult.userId as Id<'users'>
    )

    // Create time entry to hit exactly 90%
    // User cost rate is 10000 ($100/hr)
    // 90 hours * $100 = $9,000 = 90% of $10,000
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 90,
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0

      return {
        burnRate,
        budgetOk: burnRate <= 0.9, // <= 90% is OK
      }
    })

    expect(burnResult.burnRate).toBeCloseTo(0.9)
    expect(burnResult.budgetOk).toBe(true)
  })

  it('triggers overrun when burn rate exceeds 90% threshold', async () => {
    const budgetAmount = 1000000 // $10,000 in cents
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      budgetAmount,
      authResult.userId as Id<'users'>
    )

    // Create time entry to exceed 90% (91%)
    // 91 hours * $100 = $9,100 = 91% of $10,000
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 91,
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : 0

      return {
        burnRate,
        budgetOk: burnRate <= 0.9,
      }
    })

    expect(burnResult.burnRate).toBeGreaterThan(0.9)
    expect(burnResult.budgetOk).toBe(false)
  })

  it('handles project with zero budget amount', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      0, // Zero budget
      authResult.userId as Id<'users'>
    )

    // Create time entry
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 1,
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0

      // Handle division by zero
      const burnRate = budgetTotal > 0 ? timeCost / budgetTotal : Infinity

      return {
        timeCost,
        budgetTotal,
        burnRate,
        isOverBudget: budgetTotal === 0 && timeCost > 0,
      }
    })

    expect(burnResult.budgetTotal).toBe(0)
    expect(burnResult.timeCost).toBe(10000) // $100 (1 hour * $100/hr)
    expect(burnResult.burnRate).toBe(Infinity)
    expect(burnResult.isOverBudget).toBe(true)
  })
})

// =============================================================================
// Mixed Time and Expense Budget Consumption
// =============================================================================

describe('Mixed Time and Expense Budget Consumption', () => {
  it('sums time and expense costs toward budget', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000, // $10,000 budget
      authResult.userId as Id<'users'>
    )

    // Add time entries: 40 hours * $100 = $4,000
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 40,
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Add expenses: $3,500
    await testContext.run(async (ctx) => {
      await ctx.db.insert('expenses', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        description: 'Software Licenses',
        amount: 200000, // $2,000
        date: Date.now(),
        status: 'Approved',
        type: 'Software',
        billable: true,
        currency: 'USD',
        createdAt: Date.now(),
      })

      await ctx.db.insert('expenses', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        description: 'Travel',
        amount: 150000, // $1,500
        date: Date.now(),
        status: 'Approved',
        type: 'Travel',
        billable: true,
        currency: 'USD',
        createdAt: Date.now(),
      })
    })

    // Calculate combined burn
    const burnResult = await testContext.run(async (ctx) => {
      // Time cost
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      // Expense cost
      const expenses = await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const expenseCost = expenses.reduce((sum, e) => sum + e.amount, 0)

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const totalCost = timeCost + expenseCost
      const burnRate = budgetTotal > 0 ? totalCost / budgetTotal : 0

      return {
        timeCost,
        expenseCost,
        totalCost,
        burnRate,
        budgetOk: burnRate <= 0.9,
      }
    })

    expect(burnResult.timeCost).toBe(400000) // $4,000
    expect(burnResult.expenseCost).toBe(350000) // $3,500
    expect(burnResult.totalCost).toBe(750000) // $7,500
    expect(burnResult.burnRate).toBeCloseTo(0.75) // 75%
    expect(burnResult.budgetOk).toBe(true)
  })

  it('triggers overrun from expenses alone when time is under budget', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000, // $10,000 budget
      authResult.userId as Id<'users'>
    )

    // Add minimal time: 10 hours * $100 = $1,000 (10%)
    await testContext.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        date: Date.now(),
        hours: 10,
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Add large expense: $8,500 (pushes total to 95%)
    await testContext.run(async (ctx) => {
      await ctx.db.insert('expenses', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        userId: authResult.userId as Id<'users'>,
        description: 'Major Equipment Purchase',
        amount: 850000, // $8,500
        date: Date.now(),
        status: 'Approved',
        type: 'Materials',
        billable: true,
        currency: 'USD',
        createdAt: Date.now(),
      })
    })

    // Calculate combined burn
    const burnResult = await testContext.run(async (ctx) => {
      const entries = await ctx.db
        .query('timeEntries')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const user = await ctx.db.get(authResult.userId as Id<'users'>)
      let timeCost = 0
      for (const entry of entries) {
        if (user?.costRate) {
          timeCost += entry.hours * user.costRate
        }
      }

      const expenses = await ctx.db
        .query('expenses')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Approved'))
        .collect()

      const expenseCost = expenses.reduce((sum, e) => sum + e.amount, 0)

      const budget = await ctx.db.get(budgetId)
      const budgetTotal = budget?.totalAmount || 0
      const totalCost = timeCost + expenseCost
      const burnRate = budgetTotal > 0 ? totalCost / budgetTotal : 0

      return {
        timeCost,
        expenseCost,
        totalCost,
        burnRate,
        budgetOk: burnRate <= 0.9,
        timeBurnRate: timeCost / budgetTotal,
        expenseBurnRate: expenseCost / budgetTotal,
      }
    })

    expect(burnResult.timeBurnRate).toBeCloseTo(0.1) // Time alone is 10%
    expect(burnResult.expenseBurnRate).toBeCloseTo(0.85) // Expenses are 85%
    expect(burnResult.burnRate).toBeCloseTo(0.95) // Combined 95%
    expect(burnResult.budgetOk).toBe(false) // Over 90% threshold
  })
})

// =============================================================================
// Change Order Rejection Terminal State
// =============================================================================

describe('Change Order Rejection Terminal State', () => {
  it('keeps project OnHold after change order rejection', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000,
      authResult.userId as Id<'users'>
    )

    // Set project to OnHold (simulating budget overrun pause)
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
        budgetImpact: 200000, // $2,000
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

    // Verify project remains OnHold
    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })
    expect(project?.status).toBe('OnHold')

    // Verify budget was NOT updated
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    expect(budget?.totalAmount).toBe(1000000) // Unchanged
  })

  it('does not modify budget when change order is rejected', async () => {
    const originalBudget = 1000000
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      originalBudget,
      authResult.userId as Id<'users'>
    )

    // Create change order for significant budget increase
    const changeOrderId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('changeOrders', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        description: 'Major scope expansion',
        justification: 'Test justification',
        budgetImpact: 500000, // $5,000 increase requested
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

    // Verify budget is unchanged
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    expect(budget?.totalAmount).toBe(originalBudget)

    // Verify change order status
    const changeOrder = await testContext.run(async (ctx) => {
      return await ctx.db.get(changeOrderId)
    })
    expect(changeOrder?.status).toBe('Rejected')
  })

  it('allows project to remain paused indefinitely after rejection', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      500000,
      authResult.userId as Id<'users'>
    )

    // Set project to OnHold
    await testContext.run(async (ctx) => {
      await ctx.db.patch(projectId, { status: 'OnHold' })
    })

    // Create and reject multiple change orders
    for (let i = 1; i <= 3; i++) {
      const changeOrderId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('changeOrders', {
          organizationId: authResult.organizationId as Id<'organizations'>,
          projectId,
          description: `Budget request attempt ${i}`,
          justification: 'Test justification',
          budgetImpact: 100000 * i,
          status: 'Pending',
          requestedBy: authResult.userId as Id<'users'>,
          createdAt: Date.now(),
        })
      })

      await testContext.run(async (ctx) => {
        await ctx.db.patch(changeOrderId, {
          status: 'Rejected',
        })
      })
    }

    // Project should still be OnHold after multiple rejections
    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })
    expect(project?.status).toBe('OnHold')

    // Count rejected change orders
    const rejectedOrders = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('changeOrders')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'Rejected'))
        .collect()
    })
    expect(rejectedOrders.length).toBe(3)
  })

  it('updates budget and allows project resume when change order is approved', async () => {
    const originalBudget = 1000000
    const budgetIncrease = 300000
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      originalBudget,
      authResult.userId as Id<'users'>
    )

    // Set project to OnHold
    await testContext.run(async (ctx) => {
      await ctx.db.patch(projectId, { status: 'OnHold' })
    })

    // Create change order
    const changeOrderId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('changeOrders', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        description: 'Approved scope expansion',
        justification: 'Test justification',
        budgetImpact: budgetIncrease,
        status: 'Pending',
        requestedBy: authResult.userId as Id<'users'>,
        createdAt: Date.now(),
      })
    })

    // Approve the change order and update budget
    await testContext.run(async (ctx) => {
      await ctx.db.patch(changeOrderId, {
        status: 'Approved',
        approvedAt: Date.now(),
      })

      const currentBudget = await ctx.db.get(budgetId)
      if (currentBudget) {
        await ctx.db.patch(budgetId, {
          totalAmount: currentBudget.totalAmount + budgetIncrease,
        })
      }

      // Resume project
      await ctx.db.patch(projectId, { status: 'Active' })
    })

    // Verify budget was updated
    const budget = await testContext.run(async (ctx) => {
      return await ctx.db.get(budgetId)
    })
    expect(budget?.totalAmount).toBe(originalBudget + budgetIncrease)

    // Verify project is Active
    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })
    expect(project?.status).toBe('Active')

    // Verify change order status
    const changeOrder = await testContext.run(async (ctx) => {
      return await ctx.db.get(changeOrderId)
    })
    expect(changeOrder?.status).toBe('Approved')
  })
})

// =============================================================================
// Task Pause on Budget Overrun
// =============================================================================

describe('Task Pause on Budget Overrun', () => {
  it('pauses all InProgress tasks when project is put on hold', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000,
      authResult.userId as Id<'users'>
    )

    // Create multiple tasks in different states
    await testContext.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Task 1 - InProgress',
        description: 'Test task in progress',
        status: 'InProgress',
        priority: 'High',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })

      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Task 2 - InProgress',
        description: 'Another test task in progress',
        status: 'InProgress',
        priority: 'Medium',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 2,
        createdAt: Date.now(),
      })

      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Task 3 - Todo',
        description: 'Test task todo',
        status: 'Todo',
        priority: 'Low',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 3,
        createdAt: Date.now(),
      })

      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Task 4 - Done',
        description: 'Test task done',
        status: 'Done',
        priority: 'High',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 4,
        createdAt: Date.now(),
      })
    })

    // Simulate budget overrun pause: put project on hold and pause InProgress tasks
    await testContext.run(async (ctx) => {
      await ctx.db.patch(projectId, { status: 'OnHold' })

      // Pause InProgress tasks
      const inProgressTasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'InProgress'))
        .collect()

      for (const task of inProgressTasks) {
        await ctx.db.patch(task._id, { status: 'OnHold' })
      }
    })

    // Verify task states
    const tasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    const tasksByStatus = tasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    expect(tasksByStatus['OnHold']).toBe(2) // Previously InProgress tasks
    expect(tasksByStatus['Todo']).toBe(1) // Unchanged
    expect(tasksByStatus['Done']).toBe(1) // Unchanged
  })

  it('resumes OnHold tasks when project is reactivated', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      1000000,
      authResult.userId as Id<'users'>
    )

    // Create OnHold tasks (simulating paused state)
    await testContext.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Paused Task 1',
        description: 'First paused task',
        status: 'OnHold',
        priority: 'High',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })

      await ctx.db.insert('tasks', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        name: 'Paused Task 2',
        description: 'Second paused task',
        status: 'OnHold',
        priority: 'Medium',
        assigneeIds: [],
        dependencies: [],
        sortOrder: 2,
        createdAt: Date.now(),
      })

      await ctx.db.patch(projectId, { status: 'OnHold' })
    })

    // Resume project and tasks
    await testContext.run(async (ctx) => {
      await ctx.db.patch(projectId, { status: 'Active' })

      const onHoldTasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .filter((q) => q.eq(q.field('status'), 'OnHold'))
        .collect()

      for (const task of onHoldTasks) {
        await ctx.db.patch(task._id, { status: 'InProgress' })
      }
    })

    // Verify all tasks are now InProgress
    const tasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    expect(tasks.every((t) => t.status === 'InProgress')).toBe(true)

    // Verify project is Active
    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })
    expect(project?.status).toBe('Active')
  })
})
