/// <reference types="vite/client" />
/**
 * Close Phase Workflow Integration Tests
 *
 * These tests verify the close phase workflow domain operations and business rules.
 * Tests follow the contract defined in specs/13-workflow-close-phase.md.
 *
 * The close phase workflow:
 * 1. Starts after billing phase completes
 * 2. closeProject task verifies closure criteria (hard blockers vs soft warnings)
 * 3. conductRetro task captures retrospective learnings and creates project scorecard
 *
 * Key business rules tested:
 * - Hard blockers: incomplete tasks, unapproved time entries, unapproved expenses
 * - Soft warnings: uninvoiced billable items, unpaid invoices (can proceed with acknowledgment)
 * - Future bookings are automatically cancelled on project close
 * - Retrospective captures successes, improvements, key learnings, recommendations
 * - Project scorecard calculates onTime, onBudget, clientSatisfied, profitable
 *
 * Reference:
 * - .review/recipes/psa-platform/specs/13-workflow-close-phase.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  type TestContext,
} from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

// Import domain functions for project closure
import {
  getProjectClosureChecklist,
  calculateProjectMetrics,
  cancelFutureBookings,
  updateProjectStatus,
  createProjectMetricsSnapshot,
  getProjectMetricsSnapshot,
  listProjectMetricsByOrganization,
} from '../workflows/dealToDelivery/db/projects'

// Import domain functions for retrospective
import {
  insertLessonsFromRetrospective,
  createProjectScorecard,
  getProjectScorecardByProject,
  listLessonsLearnedByProject,
} from '../workflows/dealToDelivery/db/lessonsLearned'

// Import for test data setup
import { insertTask } from '../workflows/dealToDelivery/db/tasks'
import { insertTimeEntry } from '../workflows/dealToDelivery/db/timeEntries'
import { insertExpense } from '../workflows/dealToDelivery/db/expenses'
import { insertBooking } from '../workflows/dealToDelivery/db/bookings'
import { insertInvoice, updateInvoiceStatus } from '../workflows/dealToDelivery/db/invoices'
import { insertBudget } from '../workflows/dealToDelivery/db/budgets'

let testContext: TestContext

// All scopes needed for close phase workflow tests
const CLOSE_PHASE_SCOPES = [
  // Project management scopes
  'dealToDelivery:projects:create',
  'dealToDelivery:projects:edit:own',
  'dealToDelivery:projects:close',
  'dealToDelivery:projects:view:own',
  // Task scopes
  'dealToDelivery:tasks:create',
  'dealToDelivery:tasks:assign',
  'dealToDelivery:tasks:edit:own',
  // Time entry scopes
  'dealToDelivery:time:create',
  'dealToDelivery:time:edit:own',
  'dealToDelivery:time:approve',
  // Expense scopes
  'dealToDelivery:expenses:create',
  'dealToDelivery:expenses:edit:own',
  'dealToDelivery:expenses:approve',
  // Invoice scopes
  'dealToDelivery:invoices:create',
  'dealToDelivery:invoices:view:all',
  // Resource scopes
  'dealToDelivery:resources:book:team',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  // Set up role for authorization (result unused in domain tests)
  await setupUserWithRole(testContext, 'project-manager', CLOSE_PHASE_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

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
      name: 'Close Phase Test Organization',
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
      costRate: 8000, // $80/hr cost
      billRate: 15000, // $150/hr bill rate
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
      name: 'Close Phase Test Client',
      billingAddress: {
        street: '999 Closure Ave',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94106',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })
}

/**
 * Create a test contact
 */
async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<Id<'contacts'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId,
      companyId,
      name: 'Closure Contact',
      email: 'closure@test.com',
      phone: '+1-555-9999',
      isPrimary: true,
    })
  })
}

/**
 * Create a test deal
 */
async function createTestDeal(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  ownerId: Id<'users'>
): Promise<Id<'deals'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId,
      companyId,
      contactId,
      ownerId,
      name: 'Close Phase Test Deal',
      value: 10000000, // $100,000
      probability: 100,
      stage: 'Won',
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a test project
 */
async function createTestProject(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  dealId: Id<'deals'>,
  managerId: Id<'users'>
): Promise<Id<'projects'>> {
  const startDate = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId,
      companyId,
      dealId,
      managerId,
      name: 'Close Phase Test Project',
      status: 'Active',
      startDate,
      endDate: startDate + 60 * 24 * 60 * 60 * 1000, // Planned 60 days
      createdAt: Date.now(),
    })
  })
}

/**
 * Create base test data for close phase tests
 */
async function createBaseTestData(t: TestContext) {
  const orgId = await createTestOrganization(t)
  const userId = await createTestUser(t, orgId)
  const companyId = await createTestCompany(t, orgId)
  const contactId = await createTestContact(t, orgId, companyId)
  const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
  const projectId = await createTestProject(t, orgId, companyId, dealId, userId)
  return { orgId, userId, companyId, contactId, dealId, projectId }
}

// =============================================================================
// CloseProject Work Item Domain Tests
// =============================================================================

describe('CloseProject Work Item - Hard Blocker Enforcement', () => {
  it('rejects closure when tasks are incomplete (InProgress status)', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create an incomplete task
    await testContext.run(async (ctx) => {
      await insertTask(ctx.db, {
        projectId,
        organizationId: orgId,
        name: 'Incomplete Task',
        description: 'This task is still in progress',
        status: 'InProgress',
        priority: 'High',
        assigneeIds: [userId],
        estimatedHours: 8,
        dependencies: [],
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allTasksComplete).toBe(false)
    expect(checklist.incompleteTasks).toBe(1)
    expect(checklist.warnings.some(w => w.includes('task'))).toBe(true)
  })

  it('rejects closure when tasks have Todo status', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a todo task
    await testContext.run(async (ctx) => {
      await insertTask(ctx.db, {
        projectId,
        organizationId: orgId,
        name: 'Todo Task',
        description: 'This task has not been started',
        status: 'Todo',
        priority: 'Medium',
        assigneeIds: [userId],
        estimatedHours: 4,
        dependencies: [],
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allTasksComplete).toBe(false)
    expect(checklist.incompleteTasks).toBe(1)
  })

  it('rejects closure when time entries are not approved (Draft status)', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a draft time entry
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 8,
        notes: 'Draft time entry',
        status: 'Draft',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allTimeEntriesApproved).toBe(false)
    expect(checklist.unapprovedTimeEntries).toBe(1)
    expect(checklist.warnings.some(w => w.includes('time entry'))).toBe(true)
  })

  it('rejects closure when time entries are Submitted but not Approved', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a submitted time entry
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 4,
        notes: 'Submitted time entry',
        status: 'Submitted',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allTimeEntriesApproved).toBe(false)
    expect(checklist.unapprovedTimeEntries).toBe(1)
  })

  it('rejects closure when expenses are not approved (Submitted status)', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a submitted expense
    await testContext.run(async (ctx) => {
      await insertExpense(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        amount: 10000, // $100
        currency: 'USD',
        type: 'Software',
        description: 'Submitted expense',
        status: 'Submitted',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allExpensesApproved).toBe(false)
    expect(checklist.unapprovedExpenses).toBe(1)
    expect(checklist.warnings.some(w => w.includes('expense'))).toBe(true)
  })

  it('rejects closure when expenses have Draft status', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a draft expense
    await testContext.run(async (ctx) => {
      await insertExpense(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        amount: 5000, // $50
        currency: 'USD',
        type: 'Other',
        description: 'Draft expense',
        status: 'Draft',
        billable: false,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(false)
    expect(checklist.allExpensesApproved).toBe(false)
    expect(checklist.unapprovedExpenses).toBe(1)
  })

  it('allows closure when all tasks are Done', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a completed task
    await testContext.run(async (ctx) => {
      await insertTask(ctx.db, {
        projectId,
        organizationId: orgId,
        name: 'Completed Task',
        description: 'This task is done',
        status: 'Done',
        priority: 'High',
        assigneeIds: [userId],
        estimatedHours: 8,
        dependencies: [],
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allTasksComplete).toBe(true)
    expect(checklist.incompleteTasks).toBe(0)
  })

  it('allows closure when tasks are OnHold (considered complete for closure)', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    // Create an on-hold task
    await testContext.run(async (ctx) => {
      await insertTask(ctx.db, {
        projectId,
        organizationId: orgId,
        name: 'OnHold Task',
        description: 'This task is on hold',
        status: 'OnHold',
        priority: 'Low',
        assigneeIds: [],
        estimatedHours: 4,
        dependencies: [],
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allTasksComplete).toBe(true)
  })

  it('allows closure when time entries are Approved or Locked', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create approved and locked time entries
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 8,
        notes: 'Approved entry',
        status: 'Approved',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 48 * 60 * 60 * 1000,
        hours: 4,
        notes: 'Locked entry',
        status: 'Locked',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allTimeEntriesApproved).toBe(true)
    expect(checklist.unapprovedTimeEntries).toBe(0)
  })
})

describe('CloseProject Work Item - Soft Warnings', () => {
  it('warns about uninvoiced billable time entries but allows closure', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create approved billable time entry without invoice
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 8,
        notes: 'Approved billable entry',
        status: 'Approved',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allItemsInvoiced).toBe(false)
    expect(checklist.uninvoicedTimeEntries).toBe(1)
    expect(checklist.warnings.some(w => w.includes('not invoiced'))).toBe(true)
  })

  it('warns about uninvoiced billable expenses but allows closure', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create approved billable expense without invoice
    await testContext.run(async (ctx) => {
      await insertExpense(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        amount: 15000, // $150
        currency: 'USD',
        type: 'Travel',
        description: 'Approved billable expense',
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allItemsInvoiced).toBe(false)
    expect(checklist.uninvoicedExpenses).toBe(1)
  })

  it('warns about unpaid invoices but allows closure', async () => {
    const { orgId, companyId, projectId } = await createBaseTestData(testContext)

    // Create an unpaid finalized invoice
    await testContext.run(async (ctx) => {
      await insertInvoice(ctx.db, {
        projectId,
        organizationId: orgId,
        companyId,
        status: 'Sent',
        method: 'TimeAndMaterials',
        subtotal: 150000, // $1,500
        tax: 0,
        total: 150000,
        dueDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // Past due
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.canClose).toBe(true)
    expect(checklist.allInvoicesPaid).toBe(false)
    expect(checklist.unpaidInvoices).toBe(1)
    expect(checklist.unpaidAmount).toBe(150000)
    expect(checklist.warnings.some(w => w.includes('unpaid'))).toBe(true)
  })

  it('tracks future bookings count to be cancelled', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create future bookings
    await testContext.run(async (ctx) => {
      await insertBooking(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        startDate: Date.now() + 7 * 24 * 60 * 60 * 1000, // Next week
        endDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
        hoursPerDay: 8,
        type: 'Confirmed',
        createdAt: Date.now(),
      })
      await insertBooking(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        startDate: Date.now() + 21 * 24 * 60 * 60 * 1000, // 3 weeks out
        endDate: Date.now() + 28 * 24 * 60 * 60 * 1000,
        hoursPerDay: 4,
        type: 'Tentative',
        createdAt: Date.now(),
      })
    })

    const checklist = await testContext.run(async (ctx) => {
      return await getProjectClosureChecklist(ctx.db, projectId)
    })

    expect(checklist.futureBookings).toBe(2)
  })
})

describe('CloseProject Work Item - Future Booking Cancellation', () => {
  it('cancels all future bookings on project close', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create future bookings
    await testContext.run(async (ctx) => {
      await insertBooking(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        startDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
        endDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
        hoursPerDay: 8,
        type: 'Confirmed',
        createdAt: Date.now(),
      })
      await insertBooking(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        startDate: Date.now() + 21 * 24 * 60 * 60 * 1000,
        endDate: Date.now() + 28 * 24 * 60 * 60 * 1000,
        hoursPerDay: 4,
        type: 'Tentative',
        createdAt: Date.now(),
      })
    })

    const cancelledCount = await testContext.run(async (ctx) => {
      return await cancelFutureBookings(ctx.db, projectId)
    })

    expect(cancelledCount).toBe(2)

    // Verify bookings are cancelled (type changed to TimeOff or deleted)
    const remainingBookings = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('bookings')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect()
    })

    // All future bookings should be cancelled (type changed to TimeOff)
    const futureBookings = remainingBookings.filter(
      b => b.startDate > Date.now() && b.type !== 'TimeOff'
    )
    expect(futureBookings.length).toBe(0)
  })

  it('does not cancel past bookings', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create a past booking
    await testContext.run(async (ctx) => {
      await insertBooking(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        startDate: Date.now() - 14 * 24 * 60 * 60 * 1000, // 2 weeks ago
        endDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // 1 week ago
        hoursPerDay: 8,
        type: 'Confirmed',
        createdAt: Date.now(),
      })
    })

    const cancelledCount = await testContext.run(async (ctx) => {
      return await cancelFutureBookings(ctx.db, projectId)
    })

    expect(cancelledCount).toBe(0)
  })
})

describe('CloseProject Work Item - Project Metrics Calculation', () => {
  it('calculates revenue from paid invoices', async () => {
    const { orgId, companyId, projectId } = await createBaseTestData(testContext)

    // Create paid invoices
    await testContext.run(async (ctx) => {
      await insertInvoice(ctx.db, {
        projectId,
        organizationId: orgId,
        companyId,
        status: 'Paid',
        method: 'TimeAndMaterials',
        subtotal: 500000, // $5,000
        tax: 0,
        total: 500000,
        dueDate: Date.now(),
        createdAt: Date.now(),
      })
      await insertInvoice(ctx.db, {
        projectId,
        organizationId: orgId,
        companyId,
        status: 'Paid',
        method: 'TimeAndMaterials',
        subtotal: 300000, // $3,000
        tax: 0,
        total: 300000,
        dueDate: Date.now(),
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.totalRevenue).toBe(800000) // $8,000 total
  })

  it('excludes void invoices from revenue', async () => {
    const { orgId, companyId, projectId } = await createBaseTestData(testContext)

    // Create a void invoice
    await testContext.run(async (ctx) => {
      const invoiceId = await insertInvoice(ctx.db, {
        projectId,
        organizationId: orgId,
        companyId,
        status: 'Finalized',
        method: 'TimeAndMaterials',
        subtotal: 200000,
        tax: 0,
        total: 200000,
        dueDate: Date.now(),
        createdAt: Date.now(),
      })
      await updateInvoiceStatus(ctx.db, invoiceId, 'Void')
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.totalRevenue).toBe(0)
  })

  it('calculates labor cost from time entries and user cost rates', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // User has costRate of 8000 ($80/hr) from createTestUser
    // Create approved time entries
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 10,
        notes: 'Development work',
        status: 'Approved',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.timeCost).toBe(80000) // 10 hours × $80 = $800
    expect(metrics.totalHours).toBe(10)
    expect(metrics.billableHours).toBe(10)
  })

  it('calculates expense cost from approved expenses', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create approved expenses
    await testContext.run(async (ctx) => {
      await insertExpense(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        amount: 25000, // $250
        currency: 'USD',
        type: 'Travel',
        description: 'Client meeting travel',
        status: 'Approved',
        billable: true,
        createdAt: Date.now(),
      })
      await insertExpense(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 48 * 60 * 60 * 1000,
        amount: 5000, // $50
        currency: 'USD',
        type: 'Other',
        description: 'Supplies',
        status: 'Approved',
        billable: false,
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.expenseCost).toBe(30000) // $300 total
  })

  it('calculates profit and margin correctly', async () => {
    const { orgId, userId, companyId, projectId } = await createBaseTestData(testContext)

    // Create revenue (paid invoice)
    await testContext.run(async (ctx) => {
      await insertInvoice(ctx.db, {
        projectId,
        organizationId: orgId,
        companyId,
        status: 'Paid',
        method: 'TimeAndMaterials',
        subtotal: 200000, // $2,000 revenue
        tax: 0,
        total: 200000,
        dueDate: Date.now(),
        createdAt: Date.now(),
      })
    })

    // Create cost (time entries - user has $80/hr cost rate)
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 10,
        notes: 'Work',
        status: 'Approved',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.totalRevenue).toBe(200000) // $2,000
    expect(metrics.timeCost).toBe(80000) // $800 (10h × $80)
    expect(metrics.totalCost).toBe(80000) // $800
    expect(metrics.profit).toBe(120000) // $1,200
    expect(metrics.profitMargin).toBe(60) // 60%
  })

  it('calculates budget variance correctly', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Create budget
    await testContext.run(async (ctx) => {
      await insertBudget(ctx.db, {
        projectId,
        organizationId: orgId,
        type: 'TimeAndMaterials',
        totalAmount: 100000, // $1,000 budget
        createdAt: Date.now(),
      })
    })

    // Create cost at 80% of budget (user has $80/hr cost rate)
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        projectId,
        organizationId: orgId,
        userId,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 10, // 10 × $80 = $800 = 80% of $1,000 budget
        notes: 'Work',
        status: 'Approved',
        billable: true,
        approvedBy: userId,
        approvedAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.budgetVariance).toBe(80) // 80% of budget used
  })

  it('calculates project duration in days', async () => {
    const { projectId } = await createBaseTestData(testContext)

    // Project was created with startDate 30 days ago
    const closeDate = Date.now()
    const metrics = await testContext.run(async (ctx) => {
      return await calculateProjectMetrics(ctx.db, projectId, closeDate)
    })

    expect(metrics.durationDays).toBe(30)
    expect(metrics.plannedDurationDays).toBe(60) // Planned 60 days
  })
})

describe('ConductRetro Work Item - Lessons Learned', () => {
  it('inserts success lessons from retrospective', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    const successCount = await testContext.run(async (ctx) => {
      return await insertLessonsFromRetrospective(
        ctx.db,
        projectId,
        orgId,
        userId,
        [
          { category: 'timeline', description: 'Delivered ahead of schedule', impact: 'high' },
          { category: 'quality', description: 'Zero bugs in production', impact: 'high' },
        ],
        []
      )
    })

    expect(successCount).toBe(2)

    const lessons = await testContext.run(async (ctx) => {
      return await listLessonsLearnedByProject(ctx.db, projectId)
    })

    expect(lessons.length).toBe(2)
    expect(lessons.every(l => l.type === 'success')).toBe(true)
  })

  it('inserts improvement lessons with recommendations', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    const count = await testContext.run(async (ctx) => {
      return await insertLessonsFromRetrospective(
        ctx.db,
        projectId,
        orgId,
        userId,
        [],
        [
          {
            category: 'communication',
            description: 'Stakeholder alignment was challenging',
            impact: 'medium',
            recommendation: 'Schedule weekly status calls with all stakeholders',
          },
          {
            category: 'process',
            description: 'Code review bottlenecks',
            impact: 'high',
            recommendation: 'Implement pair programming for critical features',
          },
        ]
      )
    })

    expect(count).toBe(2)

    const lessons = await testContext.run(async (ctx) => {
      return await listLessonsLearnedByProject(ctx.db, projectId)
    })

    expect(lessons.length).toBe(2)
    expect(lessons.every(l => l.type === 'improvement')).toBe(true)
    expect(lessons.some(l => l.recommendation === 'Schedule weekly status calls with all stakeholders')).toBe(true)
  })

  it('inserts both successes and improvements from retrospective', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    const count = await testContext.run(async (ctx) => {
      return await insertLessonsFromRetrospective(
        ctx.db,
        projectId,
        orgId,
        userId,
        [
          { category: 'budget', description: 'Came in under budget', impact: 'high' },
        ],
        [
          { category: 'timeline', description: 'Initial estimates were too aggressive', impact: 'medium' },
        ]
      )
    })

    expect(count).toBe(2)

    const lessons = await testContext.run(async (ctx) => {
      return await listLessonsLearnedByProject(ctx.db, projectId)
    })

    const successes = lessons.filter(l => l.type === 'success')
    const improvements = lessons.filter(l => l.type === 'improvement')
    expect(successes.length).toBe(1)
    expect(improvements.length).toBe(1)
  })
})

describe('ConductRetro Work Item - Project Scorecard', () => {
  it('creates scorecard marking project as on-time when finished early', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    const now = Date.now()
    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: now - 5 * 24 * 60 * 60 * 1000, // Finished 5 days early
        plannedEndDate: now,
        actualCost: 80000,
        budgetedCost: 100000,
        profitMargin: 25,
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.onTime).toBe(true)
  })

  it('creates scorecard marking project as late when finished after planned date', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    const now = Date.now()
    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: now + 5 * 24 * 60 * 60 * 1000, // Finished 5 days late
        plannedEndDate: now,
        actualCost: 80000,
        budgetedCost: 100000,
        profitMargin: 25,
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.onTime).toBe(false)
  })

  it('creates scorecard marking project as on-budget when under budget', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 75000, // $750 actual
        budgetedCost: 100000, // $1,000 budget
        profitMargin: 25,
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.onBudget).toBe(true)
  })

  it('creates scorecard marking project as over-budget when exceeded', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 120000, // $1,200 actual (20% over)
        budgetedCost: 100000, // $1,000 budget
        profitMargin: 10,
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.onBudget).toBe(false)
  })

  it('creates scorecard marking client as satisfied when rating >= 4', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 100000,
        budgetedCost: 100000,
        profitMargin: 20,
        clientSatisfactionRating: 4,
        clientFeedback: 'Great work!',
        wouldRecommend: true,
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.clientSatisfied).toBe(true)
    expect(scorecard?.clientSatisfactionRating).toBe(4)
    expect(scorecard?.wouldRecommend).toBe(true)
  })

  it('creates scorecard marking client as unsatisfied when rating < 4', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 100000,
        budgetedCost: 100000,
        profitMargin: 20,
        clientSatisfactionRating: 3,
        clientFeedback: 'Some issues with delivery',
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.clientSatisfied).toBe(false)
  })

  it('creates scorecard marking project as profitable when margin >= 20%', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 80000,
        budgetedCost: 100000,
        profitMargin: 25, // 25% margin
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.profitable).toBe(true)
  })

  it('creates scorecard marking project as unprofitable when margin < 20%', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 100000,
        budgetedCost: 100000,
        profitMargin: 15, // Only 15% margin
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.profitable).toBe(false)
  })

  it('stores key learnings and recommendations in scorecard', async () => {
    const { orgId, projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      return await createProjectScorecard(ctx.db, projectId, orgId, {
        actualEndDate: Date.now(),
        plannedEndDate: Date.now(),
        actualCost: 80000,
        budgetedCost: 100000,
        profitMargin: 30,
        keyLearnings: [
          'Early stakeholder alignment is critical',
          'Automated testing saved significant time',
        ],
        recommendations: [
          'Continue with current testing practices',
          'Invest in CI/CD improvements',
        ],
      })
    })

    const scorecard = await testContext.run(async (ctx) => {
      return await getProjectScorecardByProject(ctx.db, projectId)
    })

    expect(scorecard?.keyLearnings).toHaveLength(2)
    expect(scorecard?.recommendations).toHaveLength(2)
    expect(scorecard?.keyLearnings).toContain('Early stakeholder alignment is critical')
    expect(scorecard?.recommendations).toContain('Continue with current testing practices')
  })
})

describe('CloseProject Work Item - Project Status Update', () => {
  it('updates project status to Completed', async () => {
    const { projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      await updateProjectStatus(ctx.db, projectId, 'Completed')
    })

    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })

    expect(project?.status).toBe('Completed')
  })

  it('updates project status to Archived', async () => {
    const { projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      await updateProjectStatus(ctx.db, projectId, 'Archived')
    })

    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })

    expect(project?.status).toBe('Archived')
  })

  it('updates project status to OnHold', async () => {
    const { projectId } = await createBaseTestData(testContext)

    await testContext.run(async (ctx) => {
      await updateProjectStatus(ctx.db, projectId, 'OnHold')
    })

    const project = await testContext.run(async (ctx) => {
      return await ctx.db.get(projectId)
    })

    expect(project?.status).toBe('OnHold')
  })
})

// =============================================================================
// Project Metrics Snapshot Tests
// Per spec 13-workflow-close-phase.md line 273:
// "Metrics Snapshot: Final metrics captured at close, immutable"
// =============================================================================

describe('Project Metrics Snapshot', () => {
  it('creates immutable metrics snapshot at project closure', async () => {
    const { orgId, userId, projectId } = await createBaseTestData(testContext)

    // Add some billable data for metrics
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        organizationId: orgId,
        userId,
        projectId,
        taskId: undefined,
        serviceId: undefined,
        date: Date.now() - 24 * 60 * 60 * 1000, // Yesterday
        hours: 8,
        billable: true,
        notes: 'Development work',
        status: 'Approved',
        createdAt: Date.now(),
      })
    })

    const closeDate = Date.now()
    const snapshotId = await testContext.run(async (ctx) => {
      return await createProjectMetricsSnapshot(ctx.db, projectId, userId, closeDate)
    })

    expect(snapshotId).toBeDefined()

    const snapshot = await testContext.run(async (ctx) => {
      return await ctx.db.get(snapshotId)
    })

    expect(snapshot).toBeDefined()
    expect(snapshot?.projectId).toBe(projectId)
    expect(snapshot?.organizationId).toBe(orgId)
    expect(snapshot?.closedBy).toBe(userId)
    expect(snapshot?.snapshotDate).toBe(closeDate)
    expect(snapshot?.totalHours).toBe(8)
    expect(snapshot?.billableHours).toBe(8)
  })

  it('is idempotent - returns existing snapshot on duplicate call', async () => {
    const { userId, projectId } = await createBaseTestData(testContext)

    const closeDate = Date.now()

    // Create first snapshot
    const snapshotId1 = await testContext.run(async (ctx) => {
      return await createProjectMetricsSnapshot(ctx.db, projectId, userId, closeDate)
    })

    // Try to create duplicate - should return same ID
    const snapshotId2 = await testContext.run(async (ctx) => {
      return await createProjectMetricsSnapshot(ctx.db, projectId, userId, closeDate + 1000)
    })

    expect(snapshotId1).toBe(snapshotId2)
  })

  it('retrieves metrics snapshot by project ID', async () => {
    const { userId, projectId } = await createBaseTestData(testContext)

    // Initially no snapshot
    const noSnapshot = await testContext.run(async (ctx) => {
      return await getProjectMetricsSnapshot(ctx.db, projectId)
    })
    expect(noSnapshot).toBeNull()

    // Create snapshot
    await testContext.run(async (ctx) => {
      return await createProjectMetricsSnapshot(ctx.db, projectId, userId, Date.now())
    })

    // Now should find it
    const snapshot = await testContext.run(async (ctx) => {
      return await getProjectMetricsSnapshot(ctx.db, projectId)
    })
    expect(snapshot).toBeDefined()
    expect(snapshot?.projectId).toBe(projectId)
  })

  it('lists metrics snapshots by organization', async () => {
    const { orgId, userId, projectId, companyId } = await createBaseTestData(testContext)

    // Create second project
    const projectId2 = await testContext.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        managerId: userId,
        name: 'Second Project',
        status: 'Active',
        startDate: Date.now(),
        createdAt: Date.now(),
      })
    })

    // Create snapshots for both projects
    await testContext.run(async (ctx) => {
      await createProjectMetricsSnapshot(ctx.db, projectId, userId, Date.now())
    })
    await testContext.run(async (ctx) => {
      await createProjectMetricsSnapshot(ctx.db, projectId2, userId, Date.now() + 1000)
    })

    const snapshots = await testContext.run(async (ctx) => {
      return await listProjectMetricsByOrganization(ctx.db, orgId)
    })

    expect(snapshots.length).toBe(2)
  })

  it('calculates financial metrics correctly', async () => {
    const { orgId, userId, projectId, companyId } = await createBaseTestData(testContext)

    // Add approved time entries (8 hours at $80/hr cost = $640 cost, $150/hr bill = $1200 revenue)
    await testContext.run(async (ctx) => {
      await insertTimeEntry(ctx.db, {
        organizationId: orgId,
        userId,
        projectId,
        taskId: undefined,
        serviceId: undefined,
        date: Date.now() - 24 * 60 * 60 * 1000,
        hours: 8,
        billable: true,
        notes: 'Billable work',
        status: 'Approved',
        createdAt: Date.now(),
      })
    })

    // Add a paid invoice
    await testContext.run(async (ctx) => {
      return await ctx.db.insert('invoices', {
        organizationId: orgId,
        projectId,
        companyId,
        status: 'Paid',
        method: 'TimeAndMaterials',
        subtotal: 120000, // $1,200
        tax: 0,
        total: 120000,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        paidAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const snapshotId = await testContext.run(async (ctx) => {
      return await createProjectMetricsSnapshot(ctx.db, projectId, userId, Date.now())
    })

    const snapshot = await testContext.run(async (ctx) => {
      return await ctx.db.get(snapshotId)
    })

    expect(snapshot?.totalHours).toBe(8)
    expect(snapshot?.billableHours).toBe(8)
    expect(snapshot?.totalRevenue).toBe(120000) // $1,200 from paid invoice
    expect(snapshot?.timeCost).toBeGreaterThan(0) // Cost depends on user's cost rate
    expect(snapshot?.profit).toBe(snapshot!.totalRevenue - snapshot!.totalCost)
  })

  it('throws error for non-existent project', async () => {
    const { userId } = await createBaseTestData(testContext)
    const fakeProjectId = 'jd77k1a1111111111111111' as Id<'projects'>

    await expect(
      testContext.run(async (ctx) => {
        await createProjectMetricsSnapshot(ctx.db, fakeProjectId, userId, Date.now())
      })
    ).rejects.toThrow(/Project/)
  })
})
