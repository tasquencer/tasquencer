/// <reference types="vite/client" />
/**
 * Resources API Tests
 *
 * Tests for resource management and booking CRUD operations
 * via the API layer.
 *
 * Key test scenarios:
 * - Team availability queries with filtering (skills, roles, departments)
 * - User bookings in date range
 * - Project bookings listing
 * - Creating bookings (Tentative, Confirmed, TimeOff)
 * - Updating booking details
 * - Deleting bookings
 * - Confirming tentative bookings
 * - Authorization checks
 * - Cross-organization isolation
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for resources tests
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
 * Creates test data (company, project) required for booking creation
 */
async function setupResourcePrerequisites(
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
      endDate: Date.now() + 90 * DAY_MS,
      managerId: userId,
      createdAt: Date.now(),
    })
  })

  return { companyId, projectId }
}

/**
 * Creates a booking directly in the database (for testing queries)
 */
async function createBookingDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  overrides: Partial<{
    projectId: Id<'projects'>
    taskId: Id<'tasks'>
    type: Doc<'bookings'>['type']
    startDate: number
    endDate: number
    hoursPerDay: number
    notes: string
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('bookings', {
      organizationId: orgId,
      userId,
      projectId: overrides.projectId,
      taskId: overrides.taskId,
      type: overrides.type ?? 'Tentative',
      startDate: overrides.startDate ?? Date.now(),
      endDate: overrides.endDate ?? Date.now() + 7 * DAY_MS,
      hoursPerDay: overrides.hoursPerDay ?? 8,
      notes: overrides.notes,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates an additional user in the organization
 */
async function createAdditionalUser(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  overrides: Partial<{
    email: string
    name: string
    role: string
    skills: string[]
    department: string
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId: orgId,
      email: overrides.email ?? 'user2@example.com',
      name: overrides.name ?? 'Additional User',
      role: overrides.role ?? 'staff',
      costRate: 10000,
      billRate: 15000,
      skills: overrides.skills ?? [],
      department: overrides.department ?? 'Engineering',
      location: 'Remote',
      isActive: true,
    })
  })
}

// =============================================================================
// getTeamAvailability Tests
// =============================================================================

describe('getTeamAvailability', () => {
  it('returns team members with availability information', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create a booking for the user
    const startDate = Date.now()
    const endDate = startDate + 4 * DAY_MS // 5 days
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Confirmed',
      startDate,
      endDate,
      hoursPerDay: 6,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
    })

    expect(result.length).toBeGreaterThan(0)
    const userAvailability = result.find((r) => r.user._id === userId)
    expect(userAvailability).toBeDefined()
    expect(userAvailability?.availability.bookedHours).toBe(30) // 5 days * 6 hours
    expect(userAvailability?.bookings.length).toBe(1)
  })

  it('filters by skills', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Update current user with skills
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { skills: ['React', 'TypeScript'] })
    })

    // Create another user with different skills
    await createAdditionalUser(t, orgId, {
      email: 'backend@example.com',
      name: 'Backend Dev',
      skills: ['Go', 'Python'],
    })

    const startDate = Date.now()
    const endDate = startDate + 7 * DAY_MS

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
      skills: ['React'],
    })

    // Should only return user with React skill
    expect(result.length).toBe(1)
    expect(result[0].user._id).toBe(userId)
  })

  it('filters by roles', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Update current user role
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { role: 'manager' })
    })

    // Create user with different role
    await createAdditionalUser(t, orgId, {
      email: 'dev@example.com',
      name: 'Developer',
      role: 'developer',
    })

    const startDate = Date.now()
    const endDate = startDate + 7 * DAY_MS

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
      roles: ['manager'],
    })

    expect(result.length).toBe(1)
    expect(result[0].user.role).toBe('manager')
  })

  it('filters by departments', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    // Update current user department
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { department: 'Design' })
    })

    // Create user in different department
    await createAdditionalUser(t, orgId, {
      email: 'eng@example.com',
      name: 'Engineer',
      department: 'Engineering',
    })

    const startDate = Date.now()
    const endDate = startDate + 7 * DAY_MS

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
      departments: ['Design'],
    })

    expect(result.length).toBe(1)
    expect(result[0].user.department).toBe('Design')
  })

  it('calculates utilization percentage', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 4 * DAY_MS // 5 days = 40 working hours

    // Book 4 hours per day = 20 hours = 50% utilization
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Confirmed',
      startDate,
      endDate,
      hoursPerDay: 4,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
    })

    const userAvailability = result.find((r) => r.user._id === userId)
    expect(userAvailability?.availability.utilization).toBe(50)
    expect(userAvailability?.availability.isOverallocated).toBe(false)
  })

  it('detects overallocation', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupResourcePrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 4 * DAY_MS // 5 days

    // Create a second project
    const project2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        name: 'Project 2',
        status: 'Active',
        startDate,
        managerId: userId,
        createdAt: Date.now(),
      })
    })

    // Book 8 hours per day on two projects = 200% utilization
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate,
      endDate,
      hoursPerDay: 8,
    })
    await createBookingDirectly(t, orgId, userId, {
      projectId: project2Id,
      startDate,
      endDate,
      hoursPerDay: 8,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
      startDate,
      endDate,
    })

    const userAvailability = result.find((r) => r.user._id === userId)
    expect(userAvailability?.availability.utilization).toBeGreaterThan(100)
    expect(userAvailability?.availability.isOverallocated).toBe(true)
  })
})

// =============================================================================
// getUserBookings Tests
// =============================================================================

describe('getUserBookings', () => {
  it('returns user bookings in date range', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 14 * DAY_MS

    // Create bookings within range
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate,
      endDate: startDate + 4 * DAY_MS,
      hoursPerDay: 8,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getUserBookings, {
      userId,
      startDate,
      endDate,
    })

    expect(result.length).toBe(1)
    expect(result[0].hoursInRange).toBeDefined()
  })

  it('calculates hours in range correctly', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingStart = Date.now()
    const bookingEnd = bookingStart + 9 * DAY_MS // 10 days

    await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate: bookingStart,
      endDate: bookingEnd,
      hoursPerDay: 6,
    })

    // Query for only part of the booking
    const queryStart = bookingStart + 2 * DAY_MS // Start 2 days in
    const queryEnd = bookingStart + 6 * DAY_MS // End 4 days before booking end

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getUserBookings, {
      userId,
      startDate: queryStart,
      endDate: queryEnd,
    })

    expect(result.length).toBe(1)
    expect(result[0].hoursInRange).toBe(30) // 5 days * 6 hours
  })

  it('returns empty for user with no bookings', async () => {
    const t = setup()
    const { userId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getUserBookings, {
      userId,
      startDate: Date.now(),
      endDate: Date.now() + 7 * DAY_MS,
    })

    expect(result).toEqual([])
  })
})

// =============================================================================
// listProjectBookings Tests
// =============================================================================

describe('listProjectBookings', () => {
  it('returns bookings for project with user information', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Confirmed',
      hoursPerDay: 8,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })

    expect(result.length).toBe(1)
    expect(result[0].userName).toBe('Test User')
    expect(result[0].userEmail).toBeDefined()
    expect(result[0].type).toBe('Confirmed')
  })

  it('returns multiple bookings for project', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create another user
    const user2Id = await createAdditionalUser(t, orgId)

    // Create bookings for both users
    await createBookingDirectly(t, orgId, userId, { projectId })
    await createBookingDirectly(t, orgId, user2Id, { projectId })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })

    expect(result.length).toBe(2)
  })

  it('returns empty for project with no bookings', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })

    expect(result).toEqual([])
  })
})

// =============================================================================
// createBooking Tests
// =============================================================================

describe('createBooking', () => {
  it('creates tentative booking', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 7 * DAY_MS

    const bookingId = await t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
      userId,
      projectId,
      type: 'Tentative',
      startDate,
      endDate,
      hoursPerDay: 8,
    })

    expect(bookingId).toBeDefined()

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result.length).toBe(1)
    expect(result[0].type).toBe('Tentative')
  })

  it('creates confirmed booking', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingId = await t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
      userId,
      projectId,
      type: 'Confirmed',
      startDate: Date.now(),
      endDate: Date.now() + 7 * DAY_MS,
      hoursPerDay: 6,
      notes: 'Sprint 1 allocation',
    })

    expect(bookingId).toBeDefined()

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result[0].type).toBe('Confirmed')
    expect(result[0].notes).toBe('Sprint 1 allocation')
    expect(result[0].hoursPerDay).toBe(6)
  })

  it('creates TimeOff booking without project', async () => {
    const t = setup()
    const { userId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const startDate = Date.now()
    const endDate = startDate + 4 * DAY_MS

    const bookingId = await t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
      userId,
      type: 'TimeOff',
      startDate,
      endDate,
      hoursPerDay: 8,
      notes: 'Vacation',
    })

    expect(bookingId).toBeDefined()

    const result = await t.query(api.workflows.dealToDelivery.api.resources.getUserBookings, {
      userId,
      startDate,
      endDate,
    })
    expect(result.length).toBe(1)
    expect(result[0].type).toBe('TimeOff')
  })

  it('rejects non-TimeOff booking without project', async () => {
    const t = setup()
    const { userId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId,
        type: 'Tentative',
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
        hoursPerDay: 8,
      })
    ).rejects.toThrow('Project is required for non-TimeOff bookings')
  })

  it('rejects end date before start date', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId,
        projectId,
        type: 'Tentative',
        startDate: Date.now() + 7 * DAY_MS,
        endDate: Date.now(), // Before start date
        hoursPerDay: 8,
      })
    ).rejects.toThrow('End date must be after start date')
  })

  it('rejects invalid hours per day', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId,
        projectId,
        type: 'Tentative',
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
        hoursPerDay: 25, // Invalid: more than 24
      })
    ).rejects.toThrow('Hours per day must be between 0 and 24')

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId,
        projectId,
        type: 'Tentative',
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
        hoursPerDay: 0, // Invalid: zero
      })
    ).rejects.toThrow('Hours per day must be between 0 and 24')
  })
})

// =============================================================================
// updateBooking Tests
// =============================================================================

describe('updateBooking', () => {
  it('updates booking dates', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const originalStart = Date.now()
    const originalEnd = originalStart + 7 * DAY_MS

    const bookingId = await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate: originalStart,
      endDate: originalEnd,
    })

    const newStart = originalStart + 2 * DAY_MS
    const newEnd = originalEnd + 2 * DAY_MS

    await t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
      bookingId,
      startDate: newStart,
      endDate: newEnd,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result[0].startDate).toBe(newStart)
    expect(result[0].endDate).toBe(newEnd)
  })

  it('updates hours per day', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingId = await createBookingDirectly(t, orgId, userId, {
      projectId,
      hoursPerDay: 8,
    })

    await t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
      bookingId,
      hoursPerDay: 4,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result[0].hoursPerDay).toBe(4)
  })

  it('updates notes', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingId = await createBookingDirectly(t, orgId, userId, {
      projectId,
      notes: 'Original notes',
    })

    await t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
      bookingId,
      notes: 'Updated notes',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result[0].notes).toBe('Updated notes')
  })

  it('rejects invalid hours per day update', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingId = await createBookingDirectly(t, orgId, userId, { projectId })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
        bookingId,
        hoursPerDay: 30,
      })
    ).rejects.toThrow('Hours per day must be between 0 and 24')
  })

  it('rejects end date before start date', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const startDate = Date.now()
    const endDate = startDate + 7 * DAY_MS

    const bookingId = await createBookingDirectly(t, orgId, userId, {
      projectId,
      startDate,
      endDate,
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
        bookingId,
        endDate: startDate - 1 * DAY_MS, // Before start
      })
    ).rejects.toThrow('End date must be after start date')
  })
})

// =============================================================================
// deleteBooking Tests
// =============================================================================

describe('deleteBooking', () => {
  it('deletes a booking', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    const bookingId = await createBookingDirectly(t, orgId, userId, { projectId })

    // Verify booking exists
    let result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result.length).toBe(1)

    // Delete the booking
    await t.mutation(api.workflows.dealToDelivery.api.resources.deleteBooking, {
      bookingId,
    })

    // Verify booking is gone
    result = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(result.length).toBe(0)
  })

  it('throws error for non-existent booking', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create and delete a booking to get a valid but non-existent ID
    const bookingId = await createBookingDirectly(t, orgId, userId, { projectId })
    await t.run(async (ctx) => {
      await ctx.db.delete(bookingId)
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.deleteBooking, { bookingId })
    ).rejects.toThrow('Booking not found')
  })
})

// =============================================================================
// confirmBookings Tests
// =============================================================================

describe('confirmBookings', () => {
  it('confirms all tentative bookings for project', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create another user
    const user2Id = await createAdditionalUser(t, orgId)

    // Create tentative bookings for both users
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Tentative',
    })
    await createBookingDirectly(t, orgId, user2Id, {
      projectId,
      type: 'Tentative',
    })

    // Confirm bookings
    const result = await t.mutation(api.workflows.dealToDelivery.api.resources.confirmBookings, {
      projectId,
    })

    expect(result.confirmedCount).toBe(2)

    // Verify all are confirmed
    const bookings = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(bookings.every((b) => b.type === 'Confirmed')).toBe(true)
  })

  it('returns 0 when no tentative bookings exist', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create only confirmed bookings
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Confirmed',
    })

    const result = await t.mutation(api.workflows.dealToDelivery.api.resources.confirmBookings, {
      projectId,
    })

    expect(result.confirmedCount).toBe(0)
  })

  it('only confirms tentative bookings (leaves confirmed unchanged)', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create mixed booking types
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Tentative',
    })
    await createBookingDirectly(t, orgId, userId, {
      projectId,
      type: 'Confirmed',
    })

    const result = await t.mutation(api.workflows.dealToDelivery.api.resources.confirmBookings, {
      projectId,
    })

    expect(result.confirmedCount).toBe(1) // Only the tentative one
  })
})

// =============================================================================
// Authorization Tests
// =============================================================================

describe('Authorization', () => {
  it('getTeamAvailability requires staff scope', async () => {
    const t = setup()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.resources.getTeamAvailability, {
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
      })
    ).rejects.toThrow()
  })

  it('createBooking requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId,
        projectId,
        type: 'Tentative',
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
        hoursPerDay: 8,
      })
    ).rejects.toThrow()
  })

  it('updateBooking requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)
    const bookingId = await createBookingDirectly(t, orgId, userId, { projectId })

    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
        bookingId,
        hoursPerDay: 4,
      })
    ).rejects.toThrow()
  })

  it('deleteBooking requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)
    const bookingId = await createBookingDirectly(t, orgId, userId, { projectId })

    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.deleteBooking, { bookingId })
    ).rejects.toThrow()
  })

  it('confirmBookings requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.confirmBookings, { projectId })
    ).rejects.toThrow()
  })
})

// =============================================================================
// Cross-Organization Isolation Tests
// =============================================================================

describe('Cross-Organization Isolation', () => {
  it('cannot book users from other organizations', async () => {
    const t = setup()
    const { organizationId: org1Id } = await setupUserWithRole(t, 'staff1', STAFF_SCOPES)

    // Create org2 with user
    const org2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('organizations', {
        name: 'Org 2',
        settings: {},
        createdAt: Date.now(),
      })
    })
    const user2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        organizationId: org2Id,
        email: 'user@org2.com',
        name: 'Org2 User',
        role: 'staff',
        costRate: 10000,
        billRate: 15000,
        skills: [],
        department: 'Engineering',
        location: 'Remote',
        isActive: true,
      })
    })

    // Create project in org1
    const companyId = await t.run(async (ctx) => {
      return await ctx.db.insert('companies', {
        organizationId: org1Id,
        name: 'Org1 Company',
        billingAddress: {
          street: '123 Main',
          city: 'SF',
          state: 'CA',
          postalCode: '94105',
          country: 'USA',
        },
        paymentTerms: 30,
      })
    })
    const projectId = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: org1Id,
        companyId,
        name: 'Org1 Project',
        status: 'Active',
        startDate: Date.now(),
        managerId: user2Id, // Wrong org user (for setup purposes)
        createdAt: Date.now(),
      })
    })

    // Try to book user from org2 as org1 user
    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
        userId: user2Id,
        projectId,
        type: 'Tentative',
        startDate: Date.now(),
        endDate: Date.now() + 7 * DAY_MS,
        hoursPerDay: 8,
      })
    ).rejects.toThrow('Cannot book users from other organizations')
  })

  it('cannot update bookings in other organizations', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff1', STAFF_SCOPES)

    // Create org2 with user and booking
    const org2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('organizations', {
        name: 'Org 2',
        settings: {},
        createdAt: Date.now(),
      })
    })
    const user2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        organizationId: org2Id,
        email: 'user@org2.com',
        name: 'Org2 User',
        role: 'staff',
        costRate: 10000,
        billRate: 15000,
        skills: [],
        department: 'Engineering',
        location: 'Remote',
        isActive: true,
      })
    })
    const bookingId = await createBookingDirectly(t, org2Id, user2Id, {
      type: 'TimeOff',
    })

    // Try to update booking from org2 as org1 user
    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
        bookingId,
        hoursPerDay: 4,
      })
    ).rejects.toThrow('Cannot update bookings in other organizations')
  })

  it('cannot delete bookings in other organizations', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff1', STAFF_SCOPES)

    // Create org2 with user and booking
    const org2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('organizations', {
        name: 'Org 2',
        settings: {},
        createdAt: Date.now(),
      })
    })
    const user2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        organizationId: org2Id,
        email: 'user@org2.com',
        name: 'Org2 User',
        role: 'staff',
        costRate: 10000,
        billRate: 15000,
        skills: [],
        department: 'Engineering',
        location: 'Remote',
        isActive: true,
      })
    })
    const bookingId = await createBookingDirectly(t, org2Id, user2Id, {
      type: 'TimeOff',
    })

    // Try to delete booking from org2 as org1 user
    await expect(
      t.mutation(api.workflows.dealToDelivery.api.resources.deleteBooking, { bookingId })
    ).rejects.toThrow('Cannot delete bookings in other organizations')
  })
})

// =============================================================================
// Booking Lifecycle Tests
// =============================================================================

describe('Booking Lifecycle', () => {
  it('Tentative → Confirmed via confirmBookings', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create tentative booking
    await t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
      userId,
      projectId,
      type: 'Tentative',
      startDate: Date.now(),
      endDate: Date.now() + 7 * DAY_MS,
      hoursPerDay: 8,
    })

    // Verify it's tentative
    let bookings = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(bookings[0].type).toBe('Tentative')

    // Confirm all
    await t.mutation(api.workflows.dealToDelivery.api.resources.confirmBookings, { projectId })

    // Verify it's confirmed
    bookings = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(bookings[0].type).toBe('Confirmed')
  })

  it('Create → Update → Delete lifecycle', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupResourcePrerequisites(t, orgId, userId)

    // Create
    const bookingId = await t.mutation(api.workflows.dealToDelivery.api.resources.createBooking, {
      userId,
      projectId,
      type: 'Tentative',
      startDate: Date.now(),
      endDate: Date.now() + 7 * DAY_MS,
      hoursPerDay: 8,
    })

    // Update
    await t.mutation(api.workflows.dealToDelivery.api.resources.updateBooking, {
      bookingId,
      hoursPerDay: 4,
      notes: 'Part-time allocation',
    })

    let bookings = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(bookings[0].hoursPerDay).toBe(4)
    expect(bookings[0].notes).toBe('Part-time allocation')

    // Delete
    await t.mutation(api.workflows.dealToDelivery.api.resources.deleteBooking, { bookingId })

    bookings = await t.query(api.workflows.dealToDelivery.api.resources.listProjectBookings, {
      projectId,
    })
    expect(bookings.length).toBe(0)
  })
})
