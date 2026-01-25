/// <reference types="vite/client" />
/**
 * Time Tracking API Tests
 *
 * Tests for time entry CRUD operations, timesheets, and approval workflows
 * via the API layer.
 *
 * Key test scenarios:
 * - Getting timesheets for a user and week with daily/weekly totals
 * - Getting project time entries with filtering (status, billable)
 * - Listing time entries by user with date filters
 * - Creating time entries with validation
 * - Updating time entries (only Draft/Rejected allowed)
 * - Submitting time entries for approval
 * - Getting timesheets pending approval (grouped by user/week)
 * - Bulk approving and rejecting time entries
 * - Authorization checks
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for time tracking tests
const STAFF_SCOPES = ['dealToDelivery:staff']

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
 * Creates test data (company, project) required for time entry creation
 */
async function setupTimeTrackingPrerequisites(
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
      startDate: Date.now(),
      endDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
      managerId: userId,
      createdAt: Date.now(),
    })
  })

  return { companyId, projectId }
}

/**
 * Creates a time entry directly in the database (for testing queries)
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
      status: overrides.status ?? 'Draft',
      billable: overrides.billable ?? true,
      notes: overrides.notes ?? 'Test time entry',
      taskId: overrides.taskId,
      serviceId: overrides.serviceId,
      createdAt: Date.now(),
    })
  })
}

/**
 * Gets a specific Monday timestamp for testing week-based queries
 */
function getMondayTimestamp(weeksAgo: number = 0): number {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Adjust to Monday
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff - weeksAgo * 7)
  monday.setHours(0, 0, 0, 0)
  return monday.getTime()
}

/**
 * Gets a specific day timestamp relative to a week start
 */
function getDayTimestamp(weekStart: number, dayOffset: number): number {
  return weekStart + dayOffset * 24 * 60 * 60 * 1000
}

// =============================================================================
// getTimesheet Tests
// =============================================================================

describe('getTimesheet', () => {
  it('returns timesheet with entries grouped by date', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)
    const tuesday = getDayTimestamp(weekStart, 1)

    // Create entries for Monday and Tuesday
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 8,
      billable: true,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: tuesday,
      hours: 6,
      billable: false,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.time.getTimesheet, {
      userId,
      weekStartDate: weekStart,
    })

    expect(result.userId).toBe(userId)
    expect(result.weekStartDate).toBe(weekStart)
    expect(result.entries.length).toBe(2)
    expect(result.weeklyTotals.total).toBe(14)
    expect(result.weeklyTotals.billable).toBe(8)
  })

  it('calculates daily totals correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)

    // Create multiple entries on the same day
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 4,
      billable: true,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 3,
      billable: true,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 1,
      billable: false,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.time.getTimesheet, {
      userId,
      weekStartDate: weekStart,
    })

    // Normalize monday to start of day for comparison
    const mondayKey = new Date(monday).setHours(0, 0, 0, 0)
    expect(result.dailyTotals[mondayKey]).toBeDefined()
    expect(result.dailyTotals[mondayKey].total).toBe(8)
    expect(result.dailyTotals[mondayKey].billable).toBe(7)
  })

  it('returns empty timesheet when no entries exist for week', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()

    const result = await t.query(api.workflows.dealToDelivery.api.time.getTimesheet, {
      userId,
      weekStartDate: weekStart,
    })

    expect(result.entries.length).toBe(0)
    expect(result.weeklyTotals.total).toBe(0)
    expect(result.weeklyTotals.billable).toBe(0)
    expect(Object.keys(result.dailyTotals).length).toBe(0)
  })

  it('filters entries by week range correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const thisWeekStart = getMondayTimestamp()
    const lastWeekStart = getMondayTimestamp(1)
    const thisMonday = getDayTimestamp(thisWeekStart, 0)
    const lastMonday = getDayTimestamp(lastWeekStart, 0)

    // Create entry for this week
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: thisMonday,
      hours: 8,
    })
    // Create entry for last week
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: lastMonday,
      hours: 6,
    })

    // Query this week only
    const result = await t.query(api.workflows.dealToDelivery.api.time.getTimesheet, {
      userId,
      weekStartDate: thisWeekStart,
    })

    expect(result.entries.length).toBe(1)
    expect(result.weeklyTotals.total).toBe(8)
  })
})

// =============================================================================
// getProjectTimeEntries Tests
// =============================================================================

describe('getProjectTimeEntries', () => {
  it('returns time entries for a project with totals', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: 8, billable: true })
    await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: 4, billable: false })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
      { projectId }
    )

    expect(result.entries.length).toBe(2)
    expect(result.totals.total).toBe(12)
    expect(result.totals.billable).toBe(8)
  })

  it('filters by status when provided', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Draft',
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 4,
      status: 'Submitted',
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 6,
      status: 'Approved',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
      { projectId, status: 'Submitted' }
    )

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].hours).toBe(4)
  })

  it('filters by billable flag when provided', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      billable: true,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 4,
      billable: false,
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
      { projectId, billableOnly: true }
    )

    expect(result.entries.length).toBe(1)
    expect(result.entries[0].hours).toBe(8)
    expect(result.entries[0].billable).toBe(true)
  })

  it('respects limit parameter', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    // Create 5 entries
    for (let i = 0; i < 5; i++) {
      await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: i + 1 })
    }

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
      { projectId, limit: 3 }
    )

    expect(result.entries.length).toBe(3)
  })

  it('returns empty when project has no time entries', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
      { projectId }
    )

    expect(result.entries.length).toBe(0)
    expect(result.totals.total).toBe(0)
    expect(result.totals.billable).toBe(0)
  })
})

// =============================================================================
// listTimeEntriesByUserQuery Tests
// =============================================================================

describe('listTimeEntriesByUserQuery', () => {
  it('returns time entries for a user', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: 8 })
    await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: 4 })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.listTimeEntriesByUserQuery,
      { userId }
    )

    expect(result.length).toBe(2)
  })

  it('filters by specific date when provided', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const today = Date.now()
    const yesterday = today - 24 * 60 * 60 * 1000

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: today,
      hours: 8,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: yesterday,
      hours: 4,
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.listTimeEntriesByUserQuery,
      { userId, date: today }
    )

    expect(result.length).toBe(1)
    expect(result[0].hours).toBe(8)
  })

  it('filters by date range when provided', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const today = Date.now()
    const yesterday = today - 24 * 60 * 60 * 1000
    const twoDaysAgo = today - 2 * 24 * 60 * 60 * 1000
    const threeDaysAgo = today - 3 * 24 * 60 * 60 * 1000

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: today,
      hours: 1,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: yesterday,
      hours: 2,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: twoDaysAgo,
      hours: 3,
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: threeDaysAgo,
      hours: 4,
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.listTimeEntriesByUserQuery,
      { userId, startDate: twoDaysAgo, endDate: yesterday }
    )

    expect(result.length).toBe(2)
    // Should include yesterday and twoDaysAgo
    const hourSet = new Set(result.map((e) => e.hours))
    expect(hourSet.has(2)).toBe(true)
    expect(hourSet.has(3)).toBe(true)
  })

  it('respects limit parameter', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    for (let i = 0; i < 5; i++) {
      await createTimeEntryDirectly(t, orgId, projectId, userId, { hours: i + 1 })
    }

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.listTimeEntriesByUserQuery,
      { userId, limit: 2 }
    )

    expect(result.length).toBe(2)
  })

  it('returns empty when user has no time entries', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    await setupTimeTrackingPrerequisites(t, orgId, userId)

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.listTimeEntriesByUserQuery,
      { userId }
    )

    expect(result.length).toBe(0)
  })
})

// =============================================================================
// createTimeEntry Tests
// =============================================================================

describe('createTimeEntry', () => {
  it('creates a time entry in draft status', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        date: Date.now(),
        hours: 8,
        billable: true,
        notes: 'Development work',
      }
    )

    expect(timeEntryId).toBeDefined()

    // Verify entry was created with correct status
    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.status).toBe('Draft')
    expect(entry?.hours).toBe(8)
    expect(entry?.billable).toBe(true)
    expect(entry?.userId).toBe(userId)
  })

  it('creates non-billable time entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        date: Date.now(),
        hours: 4,
        billable: false,
      }
    )

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.billable).toBe(false)
  })

  it('creates time entry with optional task', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    // Create a task with all required fields
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Test Task',
        description: 'A test task for time tracking',
        status: 'InProgress',
        priority: 'Medium',
        assigneeIds: [userId],
        dependencies: [],
        sortOrder: 0,
        createdAt: Date.now(),
      })
    })

    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        taskId,
        date: Date.now(),
        hours: 8,
        billable: true,
      }
    )

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.taskId).toBe(taskId)
  })
})

// =============================================================================
// updateTimeEntryMutation Tests
// =============================================================================

describe('updateTimeEntryMutation', () => {
  it('updates a draft time entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      billable: true,
      status: 'Draft',
    })

    await t.mutation(
      api.workflows.dealToDelivery.api.time.updateTimeEntryMutation,
      {
        timeEntryId,
        hours: 6,
        billable: false,
        notes: 'Updated notes',
      }
    )

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.hours).toBe(6)
    expect(entry?.billable).toBe(false)
    expect(entry?.notes).toBe('Updated notes')
  })

  it('updates a rejected time entry and resets to draft', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Rejected',
    })

    // Set rejection comments
    await t.run(async (ctx) => {
      await ctx.db.patch(timeEntryId, { rejectionComments: 'Invalid hours' })
    })

    await t.mutation(
      api.workflows.dealToDelivery.api.time.updateTimeEntryMutation,
      {
        timeEntryId,
        hours: 4,
      }
    )

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.hours).toBe(4)
    expect(entry?.status).toBe('Draft')
    expect(entry?.rejectionComments).toBeUndefined()
  })

  it('rejects update of submitted time entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.updateTimeEntryMutation, {
        timeEntryId,
        hours: 6,
      })
    ).rejects.toThrow(/Only Draft or Rejected entries can be updated/)
  })

  it('rejects update of approved time entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Approved',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.updateTimeEntryMutation, {
        timeEntryId,
        hours: 6,
      })
    ).rejects.toThrow(/Only Draft or Rejected entries can be updated/)
  })
})

// =============================================================================
// submitTimeEntry Tests
// =============================================================================

describe('submitTimeEntry', () => {
  it('submits a draft time entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Draft',
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
      timeEntryId,
    })

    const entry = await t.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    expect(entry?.status).toBe('Submitted')
  })

  it('rejects submission of non-draft entry', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
        timeEntryId,
      })
    ).rejects.toThrow(/Only Draft entries can be submitted/)
  })

  it('rejects submission of entry with zero hours', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 0,
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
        timeEntryId,
      })
    ).rejects.toThrow(/hours greater than 0/)
  })
})

// =============================================================================
// getTimesheetsForApproval Tests
// =============================================================================

describe('getTimesheetsForApproval', () => {
  it('returns submitted timesheets grouped by user and week', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)
    const tuesday = getDayTimestamp(weekStart, 1)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 8,
      status: 'Submitted',
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: tuesday,
      hours: 6,
      status: 'Submitted',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      {}
    )

    expect(result.timesheets.length).toBe(1)
    expect(result.timesheets[0].user?._id).toBe(userId)
    expect(result.timesheets[0].totalHours).toBe(14)
    expect(result.timesheets[0].entries.length).toBe(2)
    expect(result.summary.pendingCount).toBe(1)
    expect(result.summary.pendingHours).toBe(14)
  })

  it('filters by status when provided', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 8,
      status: 'Submitted',
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday + 24 * 60 * 60 * 1000,
      hours: 6,
      status: 'Approved',
    })

    const submittedResult = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      { status: 'Submitted' }
    )
    expect(submittedResult.timesheets.length).toBeGreaterThanOrEqual(1)

    const approvedResult = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      { status: 'Approved' }
    )
    expect(approvedResult.timesheets.length).toBeGreaterThanOrEqual(1)
  })

  it('calculates billable hours correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 8,
      billable: true,
      status: 'Submitted',
    })
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 2,
      billable: false,
      status: 'Submitted',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      {}
    )

    expect(result.timesheets[0].totalHours).toBe(10)
    expect(result.timesheets[0].billableHours).toBe(8)
  })

  it('returns empty when no submitted timesheets', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    // Create only draft entries
    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Draft',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      {}
    )

    expect(result.timesheets.length).toBe(0)
    expect(result.summary.pendingCount).toBe(0)
  })

  it('includes project summary for each timesheet', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const weekStart = getMondayTimestamp()
    const monday = getDayTimestamp(weekStart, 0)

    await createTimeEntryDirectly(t, orgId, projectId, userId, {
      date: monday,
      hours: 8,
      status: 'Submitted',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
      {}
    )

    expect(result.timesheets[0].projectSummary.length).toBeGreaterThan(0)
    expect(result.timesheets[0].projectSummary[0].projectId).toBe(projectId)
    expect(result.timesheets[0].projectSummary[0].hours).toBe(8)
  })
})

// =============================================================================
// approveTimeEntries Tests
// =============================================================================

describe('approveTimeEntries', () => {
  it('approves submitted time entries', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId1 = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })
    const entryId2 = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 4,
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [entryId1, entryId2],
    })

    const entry1 = await t.run(async (ctx) => ctx.db.get(entryId1))
    const entry2 = await t.run(async (ctx) => ctx.db.get(entryId2))

    expect(entry1?.status).toBe('Approved')
    expect(entry2?.status).toBe('Approved')
    expect(entry1?.approvedBy).toBe(userId)
    expect(entry1?.approvedAt).toBeDefined()
  })

  it('clears rejection comments on approval', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    // Simulate a previously rejected entry that was resubmitted
    await t.run(async (ctx) => {
      await ctx.db.patch(entryId, { rejectionComments: 'Previously rejected' })
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [entryId],
    })

    const entry = await t.run(async (ctx) => ctx.db.get(entryId))
    expect(entry?.status).toBe('Approved')
    expect(entry?.rejectionComments).toBeUndefined()
  })

  it('rejects approval of non-submitted entries', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
        timeEntryIds: [entryId],
      })
    ).rejects.toThrow(/Only Submitted entries can be approved/)
  })

  it('handles empty array of entries', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Should not throw
    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [],
    })
  })
})

// =============================================================================
// rejectTimeEntries Tests
// =============================================================================

describe('rejectTimeEntries', () => {
  it('rejects submitted time entries with comments', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
      timeEntryIds: [entryId],
      comments: 'Hours seem excessive for this task',
    })

    const entry = await t.run(async (ctx) => ctx.db.get(entryId))
    expect(entry?.status).toBe('Rejected')
    expect(entry?.rejectionComments).toBe('Hours seem excessive for this task')
  })

  it('rejects multiple time entries at once', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId1 = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })
    const entryId2 = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 12,
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
      timeEntryIds: [entryId1, entryId2],
      comments: 'Needs more detail',
    })

    const entry1 = await t.run(async (ctx) => ctx.db.get(entryId1))
    const entry2 = await t.run(async (ctx) => ctx.db.get(entryId2))

    expect(entry1?.status).toBe('Rejected')
    expect(entry2?.status).toBe('Rejected')
  })

  it('requires rejection comments', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
        timeEntryIds: [entryId],
        comments: '',
      })
    ).rejects.toThrow(/Rejection comments are required/)
  })

  it('rejects rejection of non-submitted entries', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
        timeEntryIds: [entryId],
        comments: 'Some reason',
      })
    ).rejects.toThrow(/Only Submitted entries can be rejected/)
  })

  it('trims whitespace from comments', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const entryId = await createTimeEntryDirectly(t, orgId, projectId, userId, {
      hours: 8,
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
      timeEntryIds: [entryId],
      comments: '  Needs revision  ',
    })

    const entry = await t.run(async (ctx) => ctx.db.get(entryId))
    expect(entry?.rejectionComments).toBe('Needs revision')
  })
})

// =============================================================================
// Authorization Tests
// =============================================================================

describe('Authorization', () => {
  it('allows getTimesheet with staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    await setupTimeTrackingPrerequisites(t, orgId, userId)

    // This should work with proper scopes
    const result = await t.query(api.workflows.dealToDelivery.api.time.getTimesheet, {
      userId,
      weekStartDate: getMondayTimestamp(),
    })
    expect(result.userId).toBe(userId)
  })

  it('allows getProjectTimeEntries with staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const result = await t.query(api.workflows.dealToDelivery.api.time.getProjectTimeEntries, {
      projectId,
    })
    expect(result.entries).toBeDefined()
  })

  it('allows createTimeEntry with staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        date: Date.now(),
        hours: 8,
        billable: true,
      }
    )
    expect(timeEntryId).toBeDefined()
  })

  it('allows approveTimeEntries with staff scope', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Empty array should work without errors
    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [],
    })
  })

  it('allows rejectTimeEntries with staff scope (empty array)', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Empty array should work without errors (no comments validation for empty arrays)
    await t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
      timeEntryIds: [],
      comments: 'test reason',
    })
  })
})

// =============================================================================
// Cross-Organization Isolation Tests
// =============================================================================

describe('Cross-Organization Isolation', () => {
  it('does not return time entries from other organizations', async () => {
    // Setup first organization
    const t1 = setup()
    const { userId: userId1, organizationId: orgId1 } = await setupUserWithRole(
      t1,
      'staff1',
      STAFF_SCOPES
    )
    const { projectId: projectId1 } = await setupTimeTrackingPrerequisites(
      t1,
      orgId1,
      userId1
    )

    // Create time entry in org1
    await createTimeEntryDirectly(t1, orgId1, projectId1, userId1, {
      hours: 8,
    })

    // Setup second organization
    const t2 = setup()
    const { userId: userId2, organizationId: orgId2 } = await setupUserWithRole(
      t2,
      'staff2',
      STAFF_SCOPES
    )
    const { projectId: projectId2 } = await setupTimeTrackingPrerequisites(
      t2,
      orgId2,
      userId2
    )

    // Create time entry in org2
    await createTimeEntryDirectly(t2, orgId2, projectId2, userId2, {
      hours: 4,
    })

    // Query from org1 should only see org1's entries
    const weekStart = getMondayTimestamp()
    const result1 = await t1.query(
      api.workflows.dealToDelivery.api.time.getTimesheet,
      {
        userId: userId1,
        weekStartDate: weekStart,
      }
    )

    // Should only see entries from user1
    expect(result1.entries.every((e) => e.userId === userId1)).toBe(true)
  })
})

// =============================================================================
// Time Entry Lifecycle Tests
// =============================================================================

describe('Time Entry Lifecycle', () => {
  it('follows correct lifecycle: Draft -> Submitted -> Approved', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    // 1. Create in Draft
    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        date: Date.now(),
        hours: 8,
        billable: true,
      }
    )

    let entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Draft')

    // 2. Submit for approval
    await t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
      timeEntryId,
    })

    entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Submitted')

    // 3. Approve
    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [timeEntryId],
    })

    entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Approved')
  })

  it('follows rejection and resubmission flow: Draft -> Submitted -> Rejected -> Draft -> Submitted -> Approved', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupTimeTrackingPrerequisites(t, orgId, userId)

    // 1. Create and submit
    const timeEntryId = await t.mutation(
      api.workflows.dealToDelivery.api.time.createTimeEntry,
      {
        projectId,
        date: Date.now(),
        hours: 8,
        billable: true,
      }
    )
    await t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
      timeEntryId,
    })

    // 2. Reject
    await t.mutation(api.workflows.dealToDelivery.api.time.rejectTimeEntries, {
      timeEntryIds: [timeEntryId],
      comments: 'Please add more detail',
    })

    let entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Rejected')

    // 3. Update (which resets to Draft)
    await t.mutation(
      api.workflows.dealToDelivery.api.time.updateTimeEntryMutation,
      {
        timeEntryId,
        notes: 'Added more detail as requested',
      }
    )

    entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Draft')

    // 4. Resubmit
    await t.mutation(api.workflows.dealToDelivery.api.time.submitTimeEntry, {
      timeEntryId,
    })

    entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Submitted')

    // 5. Finally approve
    await t.mutation(api.workflows.dealToDelivery.api.time.approveTimeEntries, {
      timeEntryIds: [timeEntryId],
    })

    entry = await t.run(async (ctx) => ctx.db.get(timeEntryId))
    expect(entry?.status).toBe('Approved')
  })
})
