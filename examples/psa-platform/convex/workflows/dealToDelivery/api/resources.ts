/**
 * Resources API
 *
 * Domain-specific mutations and queries for resource management and bookings.
 * These provide helper endpoints for resource planning operations.
 *
 * HELPER ENDPOINTS: These are supplementary CRUD operations that support
 * the workflow-driven resource planning work items. The primary booking
 * creation happens through work items (createBookings, confirmBookings).
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import { authComponent } from '../../../auth'
import {
  getUser,
  listActiveUsersByOrganization,
} from '../db/users'
import {
  insertBooking,
  getBooking,
  updateBooking as updateBookingInDb,
  deleteBooking as deleteBookingFromDb,
  listBookingsByProject,
  listUserBookingsInDateRange,
  confirmAllTentativeBookings,
  calculateUserBookedHours,
} from '../db/bookings'
import { getProject } from '../db/projects'

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Gets team availability for a date range with optional filters.
 * Returns users with their booking information and availability metrics.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.startDate - Start of date range (timestamp)
 * @param args.endDate - End of date range (timestamp)
 * @param args.skills - Optional filter by skills (user must have at least one)
 * @param args.roles - Optional filter by roles
 * @param args.departments - Optional filter by departments
 * @returns Array of users with availability information
 */
export const getTeamAvailability = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    skills: v.optional(v.array(v.string())),
    roles: v.optional(v.array(v.string())),
    departments: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      return []
    }

    const organizationId = currentUser.organizationId

    // Start with active users in the organization
    let users = await listActiveUsersByOrganization(ctx.db, organizationId)

    // Apply skill filter (user must have at least one matching skill)
    if (args.skills && args.skills.length > 0) {
      users = users.filter((user) =>
        args.skills!.some((skill) => user.skills.includes(skill))
      )
    }

    // Apply role filter
    if (args.roles && args.roles.length > 0) {
      users = users.filter((user) => args.roles!.includes(user.role))
    }

    // Apply department filter
    if (args.departments && args.departments.length > 0) {
      users = users.filter((user) => args.departments!.includes(user.department))
    }

    // Calculate availability for each user
    const standardWorkingHoursPerDay = 8
    const days = Math.ceil((args.endDate - args.startDate) / (24 * 60 * 60 * 1000)) + 1
    const totalAvailableHours = days * standardWorkingHoursPerDay

    const usersWithAvailability = await Promise.all(
      users.map(async (user) => {
        const bookedHours = await calculateUserBookedHours(
          ctx.db,
          user._id,
          args.startDate,
          args.endDate
        )

        const bookings = await listUserBookingsInDateRange(
          ctx.db,
          user._id,
          args.startDate,
          args.endDate
        )

        const utilization = totalAvailableHours > 0
          ? (bookedHours / totalAvailableHours) * 100
          : 0

        // Enrich bookings with project names
        const enrichedBookings = await Promise.all(
          bookings.map(async (booking) => {
            let projectName: string | undefined
            if (booking.projectId) {
              const project = await getProject(ctx.db, booking.projectId)
              projectName = project?.name
            }
            return {
              _id: booking._id,
              projectId: booking.projectId,
              projectName,
              type: booking.type,
              startDate: booking.startDate,
              endDate: booking.endDate,
              hoursPerDay: booking.hoursPerDay,
            }
          })
        )

        return {
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            skills: user.skills,
            department: user.department,
            billRate: user.billRate,
            costRate: user.costRate,
          },
          availability: {
            totalAvailableHours,
            bookedHours,
            remainingHours: Math.max(0, totalAvailableHours - bookedHours),
            utilization: Math.round(utilization * 10) / 10, // Round to 1 decimal
            isOverallocated: utilization > 100,
          },
          bookings: enrichedBookings,
        }
      })
    )

    return usersWithAvailability
  },
})

/**
 * Gets bookings for a specific user in a date range.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.userId - The user to get bookings for
 * @param args.startDate - Start of date range (timestamp)
 * @param args.endDate - End of date range (timestamp)
 * @returns Array of bookings for the user
 */
export const getUserBookings = query({
  args: {
    userId: v.id('users'),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify user exists
    const user = await getUser(ctx.db, args.userId)
    if (!user) {
      return []
    }

    const bookings = await listUserBookingsInDateRange(
      ctx.db,
      args.userId,
      args.startDate,
      args.endDate
    )

    // Calculate hours for each booking within the date range
    return bookings.map((booking) => {
      const overlapStart = Math.max(booking.startDate, args.startDate)
      const overlapEnd = Math.min(booking.endDate, args.endDate)
      const overlapDays = Math.ceil((overlapEnd - overlapStart) / (24 * 60 * 60 * 1000)) + 1
      const hoursInRange = overlapDays * booking.hoursPerDay

      return {
        ...booking,
        hoursInRange,
      }
    })
  },
})

/**
 * Lists all bookings for a project.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project to list bookings for
 * @returns Array of bookings with user information
 */
export const listProjectBookings = query({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify project exists
    const project = await getProject(ctx.db, args.projectId)
    if (!project) {
      return []
    }

    const bookings = await listBookingsByProject(ctx.db, args.projectId)

    // Enrich with user information
    const enrichedBookings = await Promise.all(
      bookings.map(async (booking) => {
        const user = await getUser(ctx.db, booking.userId)
        return {
          ...booking,
          userName: user?.name ?? 'Unknown',
          userEmail: user?.email ?? '',
        }
      })
    )

    return enrichedBookings
  },
})

// =============================================================================
// MUTATIONS (Helper mutations for resource management)
// =============================================================================

/**
 * Creates a resource booking.
 * This is a helper mutation for ad-hoc booking creation outside of work items.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.userId - The user to book
 * @param args.projectId - The project (optional for TimeOff bookings)
 * @param args.taskId - Optional task association
 * @param args.type - Booking type: Tentative, Confirmed, or TimeOff
 * @param args.startDate - Start date timestamp
 * @param args.endDate - End date timestamp
 * @param args.hoursPerDay - Hours per day
 * @param args.notes - Optional notes
 * @returns The created booking ID
 */
export const createBooking = mutation({
  args: {
    userId: v.id('users'),
    projectId: v.optional(v.id('projects')),
    taskId: v.optional(v.id('tasks')),
    type: v.union(v.literal('Tentative'), v.literal('Confirmed'), v.literal('TimeOff')),
    startDate: v.number(),
    endDate: v.number(),
    hoursPerDay: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user for organization context
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      throw new Error('Current user not found')
    }

    // Verify the user to be booked exists
    const targetUser = await getUser(ctx.db, args.userId)
    if (!targetUser) {
      throw new Error(`User not found: ${args.userId}`)
    }

    // Verify organization match
    if (targetUser.organizationId !== currentUser.organizationId) {
      throw new Error('Cannot book users from other organizations')
    }

    // Validate project if provided
    if (args.projectId) {
      const project = await getProject(ctx.db, args.projectId)
      if (!project) {
        throw new Error(`Project not found: ${args.projectId}`)
      }
      if (project.organizationId !== currentUser.organizationId) {
        throw new Error('Cannot book for projects in other organizations')
      }
    }

    // TimeOff bookings don't require a project
    if (args.type !== 'TimeOff' && !args.projectId) {
      throw new Error('Project is required for non-TimeOff bookings')
    }

    // Validate date range
    if (args.endDate < args.startDate) {
      throw new Error('End date must be after start date')
    }

    // Validate hours per day
    if (args.hoursPerDay <= 0 || args.hoursPerDay > 24) {
      throw new Error('Hours per day must be between 0 and 24')
    }

    const bookingId = await insertBooking(ctx.db, {
      organizationId: currentUser.organizationId,
      userId: args.userId,
      projectId: args.projectId,
      taskId: args.taskId,
      type: args.type,
      startDate: args.startDate,
      endDate: args.endDate,
      hoursPerDay: args.hoursPerDay,
      notes: args.notes,
      createdAt: Date.now(),
    })

    return bookingId
  },
})

/**
 * Updates booking details.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.bookingId - The booking to update
 * @param args.startDate - Optional new start date
 * @param args.endDate - Optional new end date
 * @param args.hoursPerDay - Optional new hours per day
 * @param args.taskId - Optional new task association
 * @param args.notes - Optional new notes
 */
export const updateBooking = mutation({
  args: {
    bookingId: v.id('bookings'),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    hoursPerDay: v.optional(v.number()),
    taskId: v.optional(v.id('tasks')),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user for organization validation
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      throw new Error('Current user not found')
    }

    // Verify booking exists
    const booking = await getBooking(ctx.db, args.bookingId)
    if (!booking) {
      throw new Error(`Booking not found: ${args.bookingId}`)
    }

    // Verify organization match
    if (booking.organizationId !== currentUser.organizationId) {
      throw new Error('Cannot update bookings in other organizations')
    }

    // Build updates object
    const updates: Parameters<typeof updateBookingInDb>[2] = {}

    if (args.startDate !== undefined) {
      updates.startDate = args.startDate
    }
    if (args.endDate !== undefined) {
      updates.endDate = args.endDate
    }
    if (args.hoursPerDay !== undefined) {
      if (args.hoursPerDay <= 0 || args.hoursPerDay > 24) {
        throw new Error('Hours per day must be between 0 and 24')
      }
      updates.hoursPerDay = args.hoursPerDay
    }
    if (args.taskId !== undefined) {
      updates.taskId = args.taskId
    }
    if (args.notes !== undefined) {
      updates.notes = args.notes
    }

    // Validate date range if both dates are being updated
    const effectiveStartDate = args.startDate ?? booking.startDate
    const effectiveEndDate = args.endDate ?? booking.endDate
    if (effectiveEndDate < effectiveStartDate) {
      throw new Error('End date must be after start date')
    }

    await updateBookingInDb(ctx.db, args.bookingId, updates)
  },
})

/**
 * Deletes a booking.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.bookingId - The booking to delete
 */
export const deleteBooking = mutation({
  args: {
    bookingId: v.id('bookings'),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user for organization validation
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      throw new Error('Current user not found')
    }

    // Verify booking exists
    const booking = await getBooking(ctx.db, args.bookingId)
    if (!booking) {
      throw new Error(`Booking not found: ${args.bookingId}`)
    }

    // Verify organization match
    if (booking.organizationId !== currentUser.organizationId) {
      throw new Error('Cannot delete bookings in other organizations')
    }

    await deleteBookingFromDb(ctx.db, args.bookingId)
  },
})

/**
 * Confirms multiple tentative bookings for a project.
 * This is a helper mutation for confirming bookings outside of work items.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project to confirm bookings for
 * @returns Number of bookings confirmed
 */
export const confirmBookings = mutation({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user for organization validation
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      throw new Error('Current user not found')
    }

    // Verify project exists
    const project = await getProject(ctx.db, args.projectId)
    if (!project) {
      throw new Error(`Project not found: ${args.projectId}`)
    }

    // Verify organization match
    if (project.organizationId !== currentUser.organizationId) {
      throw new Error('Cannot confirm bookings for projects in other organizations')
    }

    const confirmedCount = await confirmAllTentativeBookings(ctx.db, args.projectId)

    return { confirmedCount }
  },
})
