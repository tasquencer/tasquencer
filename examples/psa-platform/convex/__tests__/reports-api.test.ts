/// <reference types="vite/client" />
/**
 * Reports API Tests
 *
 * Tests for business reporting and analytics endpoints.
 *
 * Key test scenarios:
 * - Utilization report calculation (booked, actual, billable hours)
 * - Profitability report calculation (revenue, costs, margins)
 * - Budget burn report calculation (burn rate, projections)
 * - Working days calculation (excluding weekends)
 * - Authorization checks
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for reports tests
const STAFF_SCOPES = ['dealToDelivery:staff']

// Constants for date math
const DAY_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates test data (company, project, budget) for reports
 */
async function setupReportPrerequisites(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>
) {
  const companyId = await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })

  const projectId = await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'Test Project',
      status: 'Active',
      startDate: Date.now() - 30 * DAY_MS, // Started 30 days ago
      endDate: Date.now() + 60 * DAY_MS,
      managerId: userId,
      createdAt: Date.now() - 30 * DAY_MS,
    })
  })

  const budgetId = await t.run(async (ctx) => {
    return await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: 'TimeAndMaterials',
      totalAmount: 10000000, // $100,000
      createdAt: Date.now(),
    })
  })

  // Link budget to project
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { budgetId })
  })

  // Create a service in the budget
  const serviceId = await t.run(async (ctx) => {
    return await ctx.db.insert('services', {
      organizationId: orgId,
      budgetId,
      name: 'Development',
      rate: 15000, // $150/hr
      estimatedHours: 500,
      totalAmount: 7500000, // $75,000
    })
  })

  return { companyId, projectId, budgetId, serviceId }
}

/**
 * Creates a time entry directly in the database
 */
async function createTimeEntryDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  overrides: Partial<{
    date: number
    hours: number
    status: Doc<'timeEntries'>['status']
    billable: boolean
    notes: string
    taskId: Id<'tasks'>
    serviceId: Id<'services'>
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('timeEntries', {
      organizationId: orgId,
      projectId,
      userId,
      date: overrides.date ?? Date.now(),
      hours: overrides.hours ?? 8,
      status: overrides.status ?? 'Approved',
      billable: overrides.billable ?? true,
      notes: overrides.notes ?? 'Test time entry',
      taskId: overrides.taskId,
      serviceId: overrides.serviceId,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates a booking directly in the database
 */
async function createBookingDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  overrides: Partial<{
    projectId: Id<'projects'>
    type: Doc<'bookings'>['type']
    startDate: number
    endDate: number
    hoursPerDay: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('bookings', {
      organizationId: orgId,
      userId,
      projectId: overrides.projectId,
      type: overrides.type ?? 'Confirmed',
      startDate: overrides.startDate ?? Date.now(),
      endDate: overrides.endDate ?? Date.now() + 7 * DAY_MS,
      hoursPerDay: overrides.hoursPerDay ?? 8,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates an expense directly in the database
 */
async function createExpenseDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  overrides: Partial<{
    amount: number
    status: Doc<'expenses'>['status']
    billable: boolean
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('expenses', {
      organizationId: orgId,
      projectId,
      userId,
      type: 'Other',
      amount: overrides.amount ?? 10000, // $100
      currency: 'USD',
      billable: overrides.billable ?? true,
      status: overrides.status ?? 'Approved',
      date: Date.now(),
      description: 'Test expense',
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates an invoice directly in the database
 */
async function createInvoiceDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>,
  overrides: Partial<{
    status: Doc<'invoices'>['status']
    total: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('invoices', {
      organizationId: orgId,
      projectId,
      companyId,
      status: overrides.status ?? 'Paid',
      method: 'TimeAndMaterials',
      subtotal: overrides.total ?? 500000, // $5,000
      tax: 0,
      total: overrides.total ?? 500000,
      dueDate: Date.now() + 30 * DAY_MS,
      createdAt: Date.now(),
    })
  })
}

/**
 * Gets the start of a week (Monday) for date calculations
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// =============================================================================
// getUtilizationReport Tests
// =============================================================================

describe('getUtilizationReport', () => {
  it('returns utilization data for team members', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Create time entries in the date range
    const weekStart = getWeekStart(new Date()).getTime()
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: weekStart,
      hours: 8,
      billable: true,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: weekStart + 1 * DAY_MS,
      hours: 6,
      billable: false,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate: weekStart,
      endDate: weekStart + 4 * DAY_MS, // Monday to Friday (5 days)
    })

    expect(result.teamMembers.length).toBeGreaterThan(0)
    const userUtil = result.teamMembers.find((m) => m.userId === userId)
    expect(userUtil).toBeDefined()
    expect(userUtil?.actualHours).toBe(14) // 8 + 6
    expect(userUtil?.billableHours).toBe(8) // Only first entry is billable
  })

  it('calculates utilization rates correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    const weekStart = getWeekStart(new Date()).getTime()

    // Create time entries: 20 billable + 20 non-billable = 40 total hours
    for (let i = 0; i < 5; i++) {
      await createTimeEntryDirectly(t, orgId, projectId, userId, {
        date: weekStart + i * DAY_MS,
        hours: 4,
        billable: true,
      })
      await createTimeEntryDirectly(t, orgId, projectId, userId, {
        date: weekStart + i * DAY_MS,
        hours: 4,
        billable: false,
      })
    }

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate: weekStart,
      endDate: weekStart + 4 * DAY_MS, // Monday to Friday (5 working days = 40 hours)
    })

    const userUtil = result.teamMembers.find((m) => m.userId === userId)
    expect(userUtil?.actualHours).toBe(40)
    expect(userUtil?.billableHours).toBe(20)
    expect(userUtil?.availableHours).toBe(40) // 5 days * 8 hours
    expect(userUtil?.utilizationRate).toBe(100) // 40/40 = 100%
    expect(userUtil?.billableUtilizationRate).toBe(50) // 20/40 = 50%
  })

  it('includes booked hours from bookings', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 4 * DAY_MS // 5 days

    // Create a booking for 6 hours per day
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate,
      endDate,
      hoursPerDay: 6,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate,
      endDate,
    })

    const userUtil = result.teamMembers.find((m) => m.userId === userId)
    expect(userUtil?.bookedHours).toBe(30) // 5 days * 6 hours
  })

  it('supports custom hours per day', async () => {
    const t = setup()
    const { userId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const weekStart = getWeekStart(new Date()).getTime()

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate: weekStart,
      endDate: weekStart + 4 * DAY_MS, // 5 working days
      hoursPerDay: 6, // Custom: 6 hours instead of 8
    })

    const userUtil = result.teamMembers.find((m) => m.userId === userId)
    expect(userUtil?.availableHours).toBe(30) // 5 days * 6 hours
  })

  it('returns summary totals', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const weekStart = getWeekStart(new Date()).getTime()

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate: weekStart,
      endDate: weekStart + 4 * DAY_MS,
    })

    expect(result.summary).toBeDefined()
    expect(result.summary.totalTeamMembers).toBeGreaterThan(0)
    expect(result.summary.totalAvailableHours).toBeGreaterThan(0)
    expect(result.summary.averageUtilizationRate).toBeDefined()
    expect(result.summary.averageBillableUtilizationRate).toBeDefined()
  })
})

// =============================================================================
// getProfitabilityReport Tests
// =============================================================================

describe('getProfitabilityReport', () => {
  it('returns profitability data for projects', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupReportPrerequisites(t, orgId, userId)

    // Create time entries
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 10,
      billable: true,
      status: 'Approved',
    })

    // Create an invoice
    await createInvoiceDirectly(t, orgId, projectId, companyId, {
      status: 'Paid',
      total: 150000, // $1,500
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {})

    expect(result.projects.length).toBeGreaterThan(0)
    const projectProfit = result.projects.find((p) => p.projectId === projectId)
    expect(projectProfit).toBeDefined()
    expect(projectProfit?.projectName).toBe('Test Project')
    expect(projectProfit?.revenue).toBe(150000)
    expect(projectProfit?.totalHours).toBe(10)
    expect(projectProfit?.billableHours).toBe(10)
  })

  it('filters by project IDs', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupReportPrerequisites(t, orgId, userId)

    // Create a second project
    const project2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        name: 'Project 2',
        status: 'Active',
        startDate: Date.now(),
        managerId: userId,
        createdAt: Date.now(),
      })
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('budgets', {
        organizationId: orgId,
        projectId: project2Id,
        type: 'FixedFee',
        totalAmount: 5000000,
        createdAt: Date.now(),
      })
    })

    // Query for only the first project
    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {
      projectIds: [projectId],
    })

    expect(result.projects.length).toBe(1)
    expect(result.projects[0].projectId).toBe(projectId)
  })

  it('includes expense costs in profitability', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Create approved expenses
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 50000, // $500
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {
      projectIds: [projectId],
    })

    const projectProfit = result.projects.find((p) => p.projectId === projectId)
    expect(projectProfit?.expenseCost).toBe(50000)
  })

  it('calculates gross margin correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupReportPrerequisites(t, orgId, userId)

    // Create revenue via invoice
    await createInvoiceDirectly(t, orgId, projectId, companyId, {
      status: 'Paid',
      total: 100000, // $1,000 revenue
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {
      projectIds: [projectId],
    })

    const projectProfit = result.projects.find((p) => p.projectId === projectId)
    expect(projectProfit?.revenue).toBe(100000)
    expect(projectProfit?.grossProfit).toBeDefined()
    expect(projectProfit?.grossMargin).toBeDefined()
    expect(projectProfit?.grossMargin).toBeLessThanOrEqual(100)
  })

  it('returns summary totals', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {})

    expect(result.summary).toBeDefined()
    expect(result.summary.totalProjects).toBeDefined()
    expect(result.summary.totalRevenue).toBeDefined()
    expect(result.summary.totalCost).toBeDefined()
    expect(result.summary.totalGrossProfit).toBeDefined()
    expect(result.summary.averageGrossMargin).toBeDefined()
  })
})

// =============================================================================
// getBudgetBurnReport Tests
// =============================================================================

describe('getBudgetBurnReport', () => {
  it('returns budget burn data for projects', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Create time entries to simulate burn
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 50,
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {})

    expect(result.projects.length).toBeGreaterThan(0)
    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    expect(projectBurn).toBeDefined()
    expect(projectBurn?.projectName).toBe('Test Project')
    expect(projectBurn?.hoursSpent).toBe(50)
    expect(projectBurn?.totalBudget).toBeGreaterThan(0)
  })

  it('calculates hours remaining correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Budget has 500 estimated hours
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 100,
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    expect(projectBurn?.hoursSpent).toBe(100)
    expect(projectBurn?.hoursRemaining).toBe(400) // 500 - 100
  })

  it('calculates percentage used correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Budget has 500 estimated hours, spend 250
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 250,
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    expect(projectBurn?.hoursPercentUsed).toBe(50) // 250/500 = 50%
  })

  it('detects over budget projects', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Budget has 500 estimated hours, spend 600 (over budget)
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 600,
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    expect(projectBurn?.isOverBudget).toBe(true)
    expect(projectBurn?.hoursPercentUsed).toBeGreaterThan(100)
  })

  it('supports custom risk threshold', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Budget has 500 hours, spend 350 (70% used)
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 350,
      status: 'Approved',
    })

    // With default 80% threshold, should be on track
    let result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })
    expect(result.summary.projectsOnTrack).toBe(1)
    expect(result.summary.projectsAtRisk).toBe(0)

    // With 60% threshold, should be at risk
    result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
      riskThreshold: 60,
    })
    expect(result.summary.projectsAtRisk).toBe(1)
  })

  it('includes expenses in amount spent', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Create approved expenses
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 100000, // $1,000
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    // Amount spent should include expenses
    expect(projectBurn?.amountSpent).toBeGreaterThanOrEqual(100000)
  })

  it('calculates burn rate', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    // Project started 30 days ago, add some spend
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 300000, // $3,000
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    const projectBurn = result.projects.find((p) => p.projectId === projectId)
    expect(projectBurn?.burnRate).toBeGreaterThan(0)
  })

  it('returns summary totals', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {})

    expect(result.summary).toBeDefined()
    expect(result.summary.totalProjects).toBeDefined()
    expect(result.summary.projectsOnTrack).toBeDefined()
    expect(result.summary.projectsAtRisk).toBeDefined()
    expect(result.summary.projectsOverBudget).toBeDefined()
    expect(result.summary.totalBudget).toBeDefined()
    expect(result.summary.totalSpent).toBeDefined()
    expect(result.summary.overallPercentUsed).toBeDefined()
  })

  it('filters by project IDs', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupReportPrerequisites(t, orgId, userId)

    // Create a second project with budget
    const project2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        name: 'Project 2',
        status: 'Active',
        startDate: Date.now(),
        managerId: userId,
        createdAt: Date.now(),
      })
    })
    await t.run(async (ctx) => {
      return await ctx.db.insert('budgets', {
        organizationId: orgId,
        projectId: project2Id,
        type: 'FixedFee',
        totalAmount: 5000000,
        createdAt: Date.now(),
      })
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {
      projectIds: [projectId],
    })

    expect(result.projects.length).toBe(1)
    expect(result.projects[0].projectId).toBe(projectId)
  })
})

// =============================================================================
// Authorization Tests
// =============================================================================

describe('Authorization', () => {
  it('getUtilizationReport requires staff scope', async () => {
    const t = setup()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
      })
    ).rejects.toThrow()
  })

  it('getProfitabilityReport requires staff scope', async () => {
    const t = setup()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {})
    ).rejects.toThrow()
  })

  it('getBudgetBurnReport requires staff scope', async () => {
    const t = setup()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {})
    ).rejects.toThrow()
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('utilization report handles user with no time entries', async () => {
    const t = setup()
    const { userId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const weekStart = getWeekStart(new Date()).getTime()

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getUtilizationReport, {
      startDate: weekStart,
      endDate: weekStart + 4 * DAY_MS,
    })

    const userUtil = result.teamMembers.find((m) => m.userId === userId)
    expect(userUtil?.actualHours).toBe(0)
    expect(userUtil?.billableHours).toBe(0)
    expect(userUtil?.utilizationRate).toBe(0)
  })

  it('profitability report handles project with no invoices', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupReportPrerequisites(t, orgId, userId)

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {
      projectIds: [projectId],
    })

    const projectProfit = result.projects.find((p) => p.projectId === projectId)
    expect(projectProfit?.revenue).toBe(0)
  })

  it('budget burn report skips projects without budgets', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    await setupReportPrerequisites(t, orgId, userId)

    // Create a project without a budget
    const companyId = await t.run(async (ctx) => {
      const company = await ctx.db
        .query('companies')
        .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
        .first()
      return company!._id
    })

    const projectWithoutBudget = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        name: 'No Budget Project',
        status: 'Active',
        startDate: Date.now(),
        managerId: userId,
        createdAt: Date.now(),
      })
    })

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getBudgetBurnReport, {})

    // Should not include the project without budget
    const projectBurn = result.projects.find((p) => p.projectId === projectWithoutBudget)
    expect(projectBurn).toBeUndefined()
  })

  it('returns empty report when no projects exist', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.query(api.workflows.dealToDelivery.api.reports.getProfitabilityReport, {})

    expect(result.projects).toEqual([])
    expect(result.summary.totalProjects).toBe(0)
    expect(result.summary.totalRevenue).toBe(0)
  })
})
