/**
 * Time Tracking API
 *
 * Domain-specific mutations and queries for time entry management.
 * These provide data access for time tracking features and support
 * work item handlers that manage time entry workflows.
 *
 * TENET-AUTHZ: All queries are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Doc, Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  insertTimeEntry,
  getTimeEntry,
  updateTimeEntry as updateTimeEntryInDb,
  updateTimeEntryStatus,
  listTimeEntriesByUser,
  listTimeEntriesByProject,
  listTimeEntriesByUserAndDate,
  calculateProjectHours,
} from '../db/timeEntries'
import { getUser } from '../db/users'
import { getProject } from '../db/projects'

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Gets a user's timesheet for a specific week.
 * Entries are grouped by date with daily and weekly totals calculated.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.userId - The user to get the timesheet for
 * @param args.weekStartDate - Start of the week (timestamp)
 * @returns Timesheet with entries grouped by date and totals
 */
export const getTimesheet = query({
  args: {
    userId: v.id('users'),
    weekStartDate: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Calculate week end date (7 days from start)
    const weekEndDate = args.weekStartDate + 7 * 24 * 60 * 60 * 1000

    // Get all entries for this user
    const allEntries = await listTimeEntriesByUser(ctx.db, args.userId, 500)

    // Filter entries within the week range
    const weekEntries = allEntries.filter(
      (entry) => entry.date >= args.weekStartDate && entry.date < weekEndDate
    )

    // Group entries by date
    const entriesByDate: Record<number, Doc<'timeEntries'>[]> = {}
    for (const entry of weekEntries) {
      // Normalize to start of day
      const dateKey = new Date(entry.date).setHours(0, 0, 0, 0)
      if (!entriesByDate[dateKey]) {
        entriesByDate[dateKey] = []
      }
      entriesByDate[dateKey].push(entry)
    }

    // Calculate daily totals
    const dailyTotals: Record<number, { total: number; billable: number }> = {}
    for (const [dateKey, entries] of Object.entries(entriesByDate)) {
      const date = Number(dateKey)
      dailyTotals[date] = {
        total: entries.reduce((sum, e) => sum + e.hours, 0),
        billable: entries.reduce((sum, e) => sum + (e.billable ? e.hours : 0), 0),
      }
    }

    // Calculate weekly totals
    const weeklyTotal = weekEntries.reduce((sum, e) => sum + e.hours, 0)
    const weeklyBillable = weekEntries.reduce(
      (sum, e) => sum + (e.billable ? e.hours : 0),
      0
    )

    return {
      userId: args.userId,
      weekStartDate: args.weekStartDate,
      weekEndDate,
      entriesByDate,
      dailyTotals,
      weeklyTotals: {
        total: weeklyTotal,
        billable: weeklyBillable,
      },
      entries: weekEntries,
    }
  },
})

/**
 * Gets all time entries for a project with optional filters.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project to get entries for
 * @param args.status - Optional status filter
 * @param args.billableOnly - Optional filter for billable entries only
 * @param args.limit - Maximum number of entries to return (default 100)
 * @returns Array of time entries with calculated totals
 */
export const getProjectTimeEntries = query({
  args: {
    projectId: v.id('projects'),
    status: v.optional(
      v.union(
        v.literal('Draft'),
        v.literal('Submitted'),
        v.literal('Approved'),
        v.literal('Rejected'),
        v.literal('Locked')
      )
    ),
    billableOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const limit = args.limit ?? 100
    let entries = await listTimeEntriesByProject(ctx.db, args.projectId, limit)

    // Apply status filter
    if (args.status) {
      entries = entries.filter((e) => e.status === args.status)
    }

    // Apply billable filter
    if (args.billableOnly) {
      entries = entries.filter((e) => e.billable)
    }

    // Calculate totals
    const hours = await calculateProjectHours(ctx.db, args.projectId)

    return {
      entries,
      totals: hours,
    }
  },
})

/**
 * Lists time entries for a user with optional date filter.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.userId - The user to list entries for
 * @param args.date - Optional specific date filter (timestamp)
 * @param args.startDate - Optional start date for range filter (timestamp)
 * @param args.endDate - Optional end date for range filter (timestamp)
 * @param args.limit - Maximum number of entries to return (default 100)
 * @returns Array of time entries
 */
export const listTimeEntriesByUserQuery = query({
  args: {
    userId: v.id('users'),
    date: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const limit = args.limit ?? 100

    // If specific date is provided, use the by_user_date index
    if (args.date !== undefined) {
      return await listTimeEntriesByUserAndDate(ctx.db, args.userId, args.date, limit)
    }

    // Otherwise, get all entries for user and filter by date range if provided
    let entries = await listTimeEntriesByUser(ctx.db, args.userId, limit)

    // Apply date range filter
    if (args.startDate !== undefined || args.endDate !== undefined) {
      entries = entries.filter((entry) => {
        if (args.startDate !== undefined && entry.date < args.startDate) {
          return false
        }
        if (args.endDate !== undefined && entry.date > args.endDate) {
          return false
        }
        return true
      })
    }

    return entries
  },
})

// ============================================================================
// MUTATIONS (Helper mutations for work item handlers)
// ============================================================================

/**
 * Creates a new time entry in draft status.
 * This is a helper mutation for work item handlers.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project this entry is for
 * @param args.taskId - Optional task this entry is for
 * @param args.serviceId - Optional service for billing
 * @param args.date - Entry date (timestamp)
 * @param args.hours - Hours worked (decimal)
 * @param args.billable - Whether the time is billable
 * @param args.notes - Optional notes/description
 * @returns The created time entry ID
 */
export const createTimeEntry = mutation({
  args: {
    projectId: v.id('projects'),
    taskId: v.optional(v.id('tasks')),
    serviceId: v.optional(v.id('services')),
    date: v.number(),
    hours: v.number(),
    billable: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'timeEntries'>> => {
    const userId = await requirePsaStaffMember(ctx)

    // Get user to determine organization
    const user = await getUser(ctx.db, userId)
    if (!user) {
      throw new Error('User not found')
    }

    // Create the time entry in draft status
    const timeEntryId = await insertTimeEntry(ctx.db, {
      organizationId: user.organizationId,
      userId,
      projectId: args.projectId,
      taskId: args.taskId,
      serviceId: args.serviceId,
      date: args.date,
      hours: args.hours,
      billable: args.billable,
      status: 'Draft',
      notes: args.notes,
      createdAt: Date.now(),
    })

    return timeEntryId
  },
})

/**
 * Updates an existing time entry.
 * Only draft or rejected entries can be updated.
 * This is a helper mutation for work item handlers.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.timeEntryId - The time entry to update
 * @param args.taskId - Optional task ID update
 * @param args.serviceId - Optional service ID update
 * @param args.date - Optional date update
 * @param args.hours - Optional hours update
 * @param args.billable - Optional billable flag update
 * @param args.notes - Optional notes update
 */
export const updateTimeEntryMutation = mutation({
  args: {
    timeEntryId: v.id('timeEntries'),
    taskId: v.optional(v.id('tasks')),
    serviceId: v.optional(v.id('services')),
    date: v.optional(v.number()),
    hours: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    // Get the existing entry
    const entry = await getTimeEntry(ctx.db, args.timeEntryId)
    if (!entry) {
      throw new Error('Time entry not found')
    }

    // Only allow updates to draft or rejected entries
    if (entry.status !== 'Draft' && entry.status !== 'Rejected') {
      throw new Error(
        `Cannot update time entry with status "${entry.status}". Only Draft or Rejected entries can be updated.`
      )
    }

    // Build updates object, excluding undefined values
    const updates: Partial<Omit<Doc<'timeEntries'>, '_id' | '_creationTime' | 'organizationId'>> = {}
    if (args.taskId !== undefined) updates.taskId = args.taskId
    if (args.serviceId !== undefined) updates.serviceId = args.serviceId
    if (args.date !== undefined) updates.date = args.date
    if (args.hours !== undefined) updates.hours = args.hours
    if (args.billable !== undefined) updates.billable = args.billable
    if (args.notes !== undefined) updates.notes = args.notes

    // If entry was rejected, reset to draft when updating
    if (entry.status === 'Rejected') {
      updates.status = 'Draft'
      updates.rejectionComments = undefined
    }

    await updateTimeEntryInDb(ctx.db, args.timeEntryId, updates)
  },
})

/**
 * Submits a time entry for approval.
 * Only draft entries can be submitted.
 * This is a helper mutation for work item handlers.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.timeEntryId - The time entry to submit
 */
export const submitTimeEntry = mutation({
  args: {
    timeEntryId: v.id('timeEntries'),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    // Get the existing entry
    const entry = await getTimeEntry(ctx.db, args.timeEntryId)
    if (!entry) {
      throw new Error('Time entry not found')
    }

    // Only allow submission of draft entries
    if (entry.status !== 'Draft') {
      throw new Error(
        `Cannot submit time entry with status "${entry.status}". Only Draft entries can be submitted.`
      )
    }

    // Validate the entry has required data
    if (entry.hours <= 0) {
      throw new Error('Time entry must have hours greater than 0')
    }

    await updateTimeEntryStatus(ctx.db, args.timeEntryId, 'Submitted')
  },
})

// ============================================================================
// APPROVAL QUERIES & MUTATIONS
// ============================================================================

/**
 * Gets submitted timesheets grouped by user and week for approval.
 * Returns timesheets awaiting approval from manager.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.status - Filter by status (defaults to 'Submitted')
 * @returns Array of timesheets grouped by user and week
 */
export const getTimesheetsForApproval = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('Submitted'),
        v.literal('Approved'),
        v.literal('Rejected')
      )
    ),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const status = args.status ?? 'Submitted'

    // Get all time entries with the specified status
    const allEntries = await ctx.db
      .query('timeEntries')
      .filter((q) => q.eq(q.field('status'), status))
      .order('desc')
      .take(500)

    // Group entries by user and week
    const timesheetMap = new Map<
      string,
      {
        userId: Id<'users'>
        weekStart: number
        entries: typeof allEntries
      }
    >()

    for (const entry of allEntries) {
      // Calculate week start (Monday) for the entry date
      const entryDate = new Date(entry.date)
      const dayOfWeek = entryDate.getDay()
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const weekStart = new Date(entryDate)
      weekStart.setDate(entryDate.getDate() + diff)
      weekStart.setHours(0, 0, 0, 0)

      const key = `${entry.userId}_${weekStart.getTime()}`

      if (!timesheetMap.has(key)) {
        timesheetMap.set(key, {
          userId: entry.userId,
          weekStart: weekStart.getTime(),
          entries: [],
        })
      }

      timesheetMap.get(key)!.entries.push(entry)
    }

    // Enrich timesheets with user and project info
    const timesheets = await Promise.all(
      Array.from(timesheetMap.values()).map(async (ts) => {
        const user = await getUser(ctx.db, ts.userId)

        // Calculate week end
        const weekEnd = ts.weekStart + 6 * 24 * 60 * 60 * 1000

        // Get submittedAt (latest entry submission time)
        const submittedAt = Math.max(...ts.entries.map((e) => e._creationTime))

        // Calculate totals
        const totalHours = ts.entries.reduce((sum, e) => sum + e.hours, 0)
        const billableHours = ts.entries
          .filter((e) => e.billable)
          .reduce((sum, e) => sum + e.hours, 0)

        // Group by project for summary
        const projectHoursMap = new Map<string, number>()
        for (const entry of ts.entries) {
          const current = projectHoursMap.get(entry.projectId) ?? 0
          projectHoursMap.set(entry.projectId, current + entry.hours)
        }

        // Load project names
        const projectSummary = await Promise.all(
          Array.from(projectHoursMap.entries()).map(
            async ([projectId, hours]) => {
              const project = await getProject(ctx.db, projectId as Id<'projects'>)
              return {
                projectId: projectId as Id<'projects'>,
                projectName: project?.name ?? 'Unknown Project',
                hours,
              }
            }
          )
        )

        // Load full entry details with project names
        const enrichedEntries = await Promise.all(
          ts.entries.map(async (entry) => {
            const project = await getProject(ctx.db, entry.projectId)
            return {
              ...entry,
              project: project
                ? { _id: project._id, name: project.name }
                : null,
            }
          })
        )

        return {
          id: `${ts.userId}_${ts.weekStart}`,
          user: user ? { _id: user._id, name: user.name } : null,
          weekStart: ts.weekStart,
          weekEnd,
          submittedAt,
          totalHours,
          billableHours,
          entries: enrichedEntries,
          projectSummary,
        }
      })
    )

    // Calculate summary counts
    const summary = {
      pendingCount: status === 'Submitted' ? timesheets.length : 0,
      pendingHours:
        status === 'Submitted'
          ? timesheets.reduce((sum, ts) => sum + ts.totalHours, 0)
          : 0,
      count: timesheets.length,
      totalHours: timesheets.reduce((sum, ts) => sum + ts.totalHours, 0),
    }

    return { timesheets, summary }
  },
})

/**
 * Approves multiple time entries.
 * Changes status from Submitted to Approved.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.timeEntryIds - Array of time entry IDs to approve
 * @param args.notes - Optional approval notes
 */
export const approveTimeEntries = mutation({
  args: {
    timeEntryIds: v.array(v.id('timeEntries')),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const approverId = await requirePsaStaffMember(ctx)

    for (const timeEntryId of args.timeEntryIds) {
      const entry = await getTimeEntry(ctx.db, timeEntryId)
      if (!entry) {
        throw new Error(`Time entry not found: ${timeEntryId}`)
      }

      if (entry.status !== 'Submitted') {
        throw new Error(
          `Cannot approve time entry with status "${entry.status}". Only Submitted entries can be approved.`
        )
      }

      await updateTimeEntryInDb(ctx.db, timeEntryId, {
        status: 'Approved',
        approvedBy: approverId,
        approvedAt: Date.now(),
        rejectionComments: undefined,
      })
    }
  },
})

/**
 * Rejects multiple time entries with a reason.
 * Changes status from Submitted to Rejected.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.timeEntryIds - Array of time entry IDs to reject
 * @param args.comments - Required rejection reason
 */
export const rejectTimeEntries = mutation({
  args: {
    timeEntryIds: v.array(v.id('timeEntries')),
    comments: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    if (!args.comments || args.comments.trim().length === 0) {
      throw new Error('Rejection comments are required')
    }

    for (const timeEntryId of args.timeEntryIds) {
      const entry = await getTimeEntry(ctx.db, timeEntryId)
      if (!entry) {
        throw new Error(`Time entry not found: ${timeEntryId}`)
      }

      if (entry.status !== 'Submitted') {
        throw new Error(
          `Cannot reject time entry with status "${entry.status}". Only Submitted entries can be rejected.`
        )
      }

      await updateTimeEntryInDb(ctx.db, timeEntryId, {
        status: 'Rejected',
        rejectionComments: args.comments.trim(),
      })
    }
  },
})
