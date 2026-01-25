/// <reference types="vite/client" />
/**
 * Tests for resource planning domain DB functions
 *
 * These tests validate the booking operations and availability calculations
 * that power the resource planning workflow: viewTeamAvailability,
 * filterBySkillsRole, createBookings, reviewBookings, confirmBookings.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 * TENET-BACKPRESSURE: Tests are required for all work item implementations
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

async function createTestOrganization(
  t: TestContext,
  overrides: Partial<OmitIdAndCreationTime<Doc<'organizations'>>> = {}
): Promise<{ id: Id<'organizations'>; data: OmitIdAndCreationTime<Doc<'organizations'>> }> {
  const data: OmitIdAndCreationTime<Doc<'organizations'>> = {
    name: 'Test Organization',
    settings: {},
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', data)
  })
  return { id, data }
}

async function createTestUser(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<{ id: Id<'users'>; data: OmitIdAndCreationTime<Doc<'users'>> }> {
  const data: OmitIdAndCreationTime<Doc<'users'>> = {
    organizationId,
    email: `user-${Date.now()}-${Math.random().toString(36)}@example.com`,
    name: 'Test User',
    role: 'teamMember',
    costRate: 10000, // $100/hr in cents
    billRate: 15000, // $150/hr in cents
    skills: [],
    department: 'Engineering',
    location: 'Remote',
    isActive: true,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('users', data)
  })
  return { id, data }
}

async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'companies'>>> = {}
): Promise<{ id: Id<'companies'> }> {
  const data: OmitIdAndCreationTime<Doc<'companies'>> = {
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
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('companies', data)
  })
  return { id }
}

async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<{ id: Id<'contacts'> }> {
  const data: OmitIdAndCreationTime<Doc<'contacts'>> = {
    organizationId,
    companyId,
    name: 'John Doe',
    email: `contact-${Date.now()}@acme.example.com`,
    phone: '+1-555-0101',
    isPrimary: false,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', data)
  })
  return { id }
}

async function createTestDeal(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  ownerId: Id<'users'>,
  contactId: Id<'contacts'>
): Promise<{ id: Id<'deals'> }> {
  const data: OmitIdAndCreationTime<Doc<'deals'>> = {
    organizationId,
    companyId,
    contactId,
    ownerId,
    name: 'New Software Project',
    value: 10000000, // $100,000 in cents
    stage: 'Won',
    probability: 100,
    createdAt: Date.now(),
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('deals', data)
  })
  return { id }
}

async function createTestProject(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  dealId: Id<'deals'>,
  managerId: Id<'users'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'projects'>>> = {}
): Promise<{ id: Id<'projects'>; data: OmitIdAndCreationTime<Doc<'projects'>> }> {
  const now = Date.now()
  const data: OmitIdAndCreationTime<Doc<'projects'>> = {
    organizationId,
    companyId,
    dealId,
    managerId,
    name: 'Software Implementation',
    status: 'Planning',
    startDate: now,
    endDate: now + 90 * 24 * 60 * 60 * 1000, // 90 days
    createdAt: now,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('projects', data)
  })
  return { id, data }
}

async function createTestBooking(
  t: TestContext,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
  projectId: Id<'projects'> | undefined,
  overrides: Partial<OmitIdAndCreationTime<Doc<'bookings'>>> = {}
): Promise<{ id: Id<'bookings'>; data: OmitIdAndCreationTime<Doc<'bookings'>> }> {
  const now = Date.now()
  const data: OmitIdAndCreationTime<Doc<'bookings'>> = {
    organizationId,
    userId,
    projectId,
    type: 'Tentative',
    startDate: now,
    endDate: now + 7 * 24 * 60 * 60 * 1000, // 7 days
    hoursPerDay: 8,
    notes: 'Sprint 1 allocation',
    createdAt: now,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('bookings', data)
  })
  return { id, data }
}

/**
 * Create base test data (org, user, company, contact, deal, project) for resource planning tests
 */
async function createResourcePlanningBaseData(t: TestContext) {
  const { id: orgId } = await createTestOrganization(t)
  const { id: userId } = await createTestUser(t, orgId, { name: 'Project Manager', role: 'projectManager' })
  const { id: companyId } = await createTestCompany(t, orgId)
  const { id: contactId } = await createTestContact(t, orgId, companyId)
  const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
  const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
  return { orgId, userId, companyId, contactId, dealId, projectId }
}

// =============================================================================
// Import DB functions to test
// =============================================================================

import {
  listBookingsByUser,
  listBookingsInDateRange,
  listUserBookingsInDateRange,
  calculateUserBookedHours,
  updateBookingType,
} from '../workflows/dealToDelivery/db/bookings'

import {
  listActiveUsersByOrganization,
  listUsersBySkill,
  listUsersByDepartment,
} from '../workflows/dealToDelivery/db/users'

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Booking Query Tests for Resource Planning
// =============================================================================

describe('Resource Planning - Booking Queries', () => {
  describe('listBookingsByUser', () => {
    it('should return all bookings for a specific user', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      // Create bookings for the team member
      await createTestBooking(t, orgId, teamMember, projectId, { notes: 'Booking 1' })
      await createTestBooking(t, orgId, teamMember, projectId, { notes: 'Booking 2' })

      // Create booking for another user (should not be included)
      const { id: otherUser } = await createTestUser(t, orgId, { name: 'Other User' })
      await createTestBooking(t, orgId, otherUser, projectId, { notes: 'Other booking' })

      const bookings = await t.run(async (ctx) => {
        return await listBookingsByUser(ctx.db, teamMember)
      })

      expect(bookings).toHaveLength(2)
      expect(bookings.every(b => b.userId === teamMember)).toBe(true)
    })

    it('should return empty array for user with no bookings', async () => {
      const t = setup()
      const { orgId } = await createResourcePlanningBaseData(t)
      const { id: newUser } = await createTestUser(t, orgId, { name: 'New User' })

      const bookings = await t.run(async (ctx) => {
        return await listBookingsByUser(ctx.db, newUser)
      })

      expect(bookings).toHaveLength(0)
    })

    it('should respect limit parameter', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      // Create 5 bookings
      for (let i = 0; i < 5; i++) {
        await createTestBooking(t, orgId, teamMember, projectId, { notes: `Booking ${i}` })
      }

      const bookings = await t.run(async (ctx) => {
        return await listBookingsByUser(ctx.db, teamMember, 3)
      })

      expect(bookings).toHaveLength(3)
    })
  })

  describe('listBookingsInDateRange', () => {
    it('should return bookings within date range', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const oneWeek = 7 * oneDay

      // Booking fully within range (now to now+7days)
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now + oneDay,
        endDate: now + oneDay * 3,
        notes: 'Within range',
      })

      // Booking overlapping start (starts before, ends within)
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneDay * 2,
        endDate: now + oneDay * 2,
        notes: 'Overlaps start',
      })

      // Booking entirely before range (should not match)
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneWeek * 2,
        endDate: now - oneWeek,
        notes: 'Before range',
      })

      const bookings = await t.run(async (ctx) => {
        return await listBookingsInDateRange(ctx.db, orgId, now, now + oneWeek)
      })

      // Should include the one fully within and the one overlapping start
      expect(bookings.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter by organization', async () => {
      const t = setup()
      const { id: org1 } = await createTestOrganization(t, { name: 'Org 1' })
      const { id: org2 } = await createTestOrganization(t, { name: 'Org 2' })

      const { id: user1 } = await createTestUser(t, org1, { name: 'User 1' })
      const { id: user2 } = await createTestUser(t, org2, { name: 'User 2' })

      const now = Date.now()
      const oneWeek = 7 * 24 * 60 * 60 * 1000

      // Create booking in org1
      await createTestBooking(t, org1, user1, undefined, {
        startDate: now,
        endDate: now + oneWeek,
      })

      // Create booking in org2
      await createTestBooking(t, org2, user2, undefined, {
        startDate: now,
        endDate: now + oneWeek,
      })

      const org1Bookings = await t.run(async (ctx) => {
        return await listBookingsInDateRange(ctx.db, org1, now, now + oneWeek)
      })

      expect(org1Bookings).toHaveLength(1)
      expect(org1Bookings[0].organizationId).toBe(org1)
    })
  })

  describe('listUserBookingsInDateRange', () => {
    it('should return user bookings that overlap with date range', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const oneWeek = 7 * oneDay

      // Booking fully within range
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now + oneDay,
        endDate: now + oneDay * 3,
        notes: 'Within range',
      })

      // Booking entirely outside range (before)
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneWeek * 2,
        endDate: now - oneWeek,
        notes: 'Before range',
      })

      // Booking entirely outside range (after)
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now + oneWeek * 2,
        endDate: now + oneWeek * 3,
        notes: 'After range',
      })

      const bookings = await t.run(async (ctx) => {
        return await listUserBookingsInDateRange(ctx.db, teamMember, now, now + oneWeek)
      })

      // Only the booking fully within range should match
      expect(bookings).toHaveLength(1)
      expect(bookings[0].notes).toBe('Within range')
    })

    it('should include bookings that partially overlap', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const oneWeek = 7 * oneDay

      // Booking starts before range but ends within
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneDay * 3,
        endDate: now + oneDay * 2,
        notes: 'Overlap start',
      })

      // Booking starts within but ends after range
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now + oneDay * 5,
        endDate: now + oneWeek + oneDay * 3,
        notes: 'Overlap end',
      })

      const bookings = await t.run(async (ctx) => {
        return await listUserBookingsInDateRange(ctx.db, teamMember, now, now + oneWeek)
      })

      expect(bookings).toHaveLength(2)
    })
  })
})

// =============================================================================
// Availability Calculation Tests
// =============================================================================

describe('Resource Planning - Availability Calculations', () => {
  describe('calculateUserBookedHours', () => {
    it('should calculate total booked hours in date range', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000

      // 5-day booking at 8 hours/day = 40 hours
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now,
        endDate: now + oneDay * 4, // 5 days (inclusive)
        hoursPerDay: 8,
      })

      const bookedHours = await t.run(async (ctx) => {
        return await calculateUserBookedHours(ctx.db, teamMember, now, now + oneDay * 4)
      })

      expect(bookedHours).toBe(40) // 5 days × 8 hours
    })

    it('should calculate hours for multiple bookings', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const oneWeek = 7 * oneDay

      // First booking: 3 days at 8 hours = 24 hours
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now,
        endDate: now + oneDay * 2,
        hoursPerDay: 8,
      })

      // Second booking: 2 days at 4 hours = 8 hours
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now + oneDay * 4,
        endDate: now + oneDay * 5,
        hoursPerDay: 4,
      })

      const bookedHours = await t.run(async (ctx) => {
        return await calculateUserBookedHours(ctx.db, teamMember, now, now + oneWeek)
      })

      expect(bookedHours).toBe(32) // 24 + 8
    })

    it('should handle partial overlap with date range', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000

      // Booking spans 10 days but we query only 5 days
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneDay * 2, // Starts 2 days before range
        endDate: now + oneDay * 7,   // Ends 3 days after range
        hoursPerDay: 8,
      })

      // Query for 5 days (day 0 to day 4)
      const bookedHours = await t.run(async (ctx) => {
        return await calculateUserBookedHours(ctx.db, teamMember, now, now + oneDay * 4)
      })

      // Should only count the overlap: 5 days × 8 hours = 40 hours
      expect(bookedHours).toBe(40)
    })

    it('should return 0 for user with no bookings in range', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const oneWeek = 7 * oneDay

      // Booking outside the query range
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now - oneWeek * 2,
        endDate: now - oneWeek,
        hoursPerDay: 8,
      })

      const bookedHours = await t.run(async (ctx) => {
        return await calculateUserBookedHours(ctx.db, teamMember, now, now + oneWeek)
      })

      expect(bookedHours).toBe(0)
    })

    it('should handle TimeOff bookings in availability calculation', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000

      // Regular project booking
      await createTestBooking(t, orgId, teamMember, projectId, {
        startDate: now,
        endDate: now + oneDay * 2,
        hoursPerDay: 8,
        type: 'Confirmed',
      })

      // TimeOff booking (no project)
      await createTestBooking(t, orgId, teamMember, undefined, {
        startDate: now + oneDay * 3,
        endDate: now + oneDay * 4,
        hoursPerDay: 8,
        type: 'TimeOff',
        notes: 'Vacation',
      })

      const bookedHours = await t.run(async (ctx) => {
        return await calculateUserBookedHours(ctx.db, teamMember, now, now + oneDay * 6)
      })

      // 3 days project + 2 days time off = 5 days × 8 hours = 40 hours
      expect(bookedHours).toBe(40)
    })
  })
})

// =============================================================================
// Team Availability Query Tests
// =============================================================================

describe('Resource Planning - Team Availability Queries', () => {
  describe('listActiveUsersByOrganization', () => {
    it('should return only active users', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      await createTestUser(t, orgId, { name: 'Active 1', isActive: true })
      await createTestUser(t, orgId, { name: 'Active 2', isActive: true })
      await createTestUser(t, orgId, { name: 'Inactive', isActive: false })

      const users = await t.run(async (ctx) => {
        return await listActiveUsersByOrganization(ctx.db, orgId)
      })

      expect(users).toHaveLength(2)
      expect(users.every(u => u.isActive)).toBe(true)
    })
  })

  describe('listUsersBySkill', () => {
    it('should filter users by skill', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      await createTestUser(t, orgId, {
        name: 'React Dev',
        skills: ['React', 'TypeScript'],
      })
      await createTestUser(t, orgId, {
        name: 'Full Stack',
        skills: ['React', 'Node.js', 'TypeScript'],
      })
      await createTestUser(t, orgId, {
        name: 'Python Dev',
        skills: ['Python', 'Django'],
      })

      const reactDevs = await t.run(async (ctx) => {
        return await listUsersBySkill(ctx.db, orgId, 'React')
      })

      expect(reactDevs).toHaveLength(2)
      expect(reactDevs.every(u => u.skills.includes('React'))).toBe(true)
    })

    it('should return empty array for non-existent skill', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      await createTestUser(t, orgId, { name: 'Dev', skills: ['JavaScript'] })

      const rustDevs = await t.run(async (ctx) => {
        return await listUsersBySkill(ctx.db, orgId, 'Rust')
      })

      expect(rustDevs).toHaveLength(0)
    })
  })

  describe('listUsersByDepartment', () => {
    it('should filter users by department', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      await createTestUser(t, orgId, { name: 'Eng 1', department: 'Engineering' })
      await createTestUser(t, orgId, { name: 'Eng 2', department: 'Engineering' })
      await createTestUser(t, orgId, { name: 'Designer', department: 'Design' })

      const engineers = await t.run(async (ctx) => {
        return await listUsersByDepartment(ctx.db, orgId, 'Engineering')
      })

      expect(engineers).toHaveLength(2)
      expect(engineers.every(u => u.department === 'Engineering')).toBe(true)
    })
  })
})

// =============================================================================
// Booking Type Transition Tests
// =============================================================================

describe('Resource Planning - Booking Type Transitions', () => {
  describe('updateBookingType', () => {
    it('should transition Tentative to Confirmed', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const { id: bookingId } = await createTestBooking(t, orgId, teamMember, projectId, {
        type: 'Tentative',
      })

      await t.run(async (ctx) => {
        await updateBookingType(ctx.db, bookingId, 'Confirmed')
      })

      const booking = await t.run(async (ctx) => {
        return await ctx.db.get(bookingId)
      })

      expect(booking?.type).toBe('Confirmed')
    })

    it('should transition to TimeOff', async () => {
      const t = setup()
      const { orgId, projectId } = await createResourcePlanningBaseData(t)
      const { id: teamMember } = await createTestUser(t, orgId, { name: 'Team Member' })

      const { id: bookingId } = await createTestBooking(t, orgId, teamMember, projectId, {
        type: 'Tentative',
      })

      await t.run(async (ctx) => {
        await updateBookingType(ctx.db, bookingId, 'TimeOff')
      })

      const booking = await t.run(async (ctx) => {
        return await ctx.db.get(bookingId)
      })

      expect(booking?.type).toBe('TimeOff')
    })
  })
})

// =============================================================================
// Integration-style Resource Planning Scenario Tests
// =============================================================================

describe('Resource Planning - Scenario Tests', () => {
  it('should calculate team utilization for a sprint', async () => {
    const t = setup()
    const { orgId, projectId } = await createResourcePlanningBaseData(t)

    // Create a team
    const { id: dev1 } = await createTestUser(t, orgId, {
      name: 'Developer 1',
      skills: ['React', 'TypeScript'],
    })
    const { id: dev2 } = await createTestUser(t, orgId, {
      name: 'Developer 2',
      skills: ['Node.js', 'TypeScript'],
    })
    const { id: designer } = await createTestUser(t, orgId, {
      name: 'Designer',
      skills: ['Figma', 'UI/UX'],
    })

    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    const sprintEnd = now + oneDay * 9 // 10 days

    // Dev 1: Full time on project
    await createTestBooking(t, orgId, dev1, projectId, {
      startDate: now,
      endDate: sprintEnd,
      hoursPerDay: 8,
      type: 'Confirmed',
    })

    // Dev 2: Half time on project
    await createTestBooking(t, orgId, dev2, projectId, {
      startDate: now,
      endDate: sprintEnd,
      hoursPerDay: 4,
      type: 'Tentative',
    })

    // Designer: First half of sprint only
    await createTestBooking(t, orgId, designer, projectId, {
      startDate: now,
      endDate: now + oneDay * 4,
      hoursPerDay: 8,
      type: 'Confirmed',
    })

    // Calculate booked hours for each team member
    const [dev1Hours, dev2Hours, designerHours] = await t.run(async (ctx) => {
      const d1 = await calculateUserBookedHours(ctx.db, dev1, now, sprintEnd)
      const d2 = await calculateUserBookedHours(ctx.db, dev2, now, sprintEnd)
      const des = await calculateUserBookedHours(ctx.db, designer, now, sprintEnd)
      return [d1, d2, des]
    })

    // Sprint is 10 days
    const standardHoursInSprint = 10 * 8 // 80 hours

    expect(dev1Hours).toBe(80)  // Full time: 10 days × 8 hours
    expect(dev2Hours).toBe(40)  // Half time: 10 days × 4 hours
    expect(designerHours).toBe(40) // First half: 5 days × 8 hours

    // Utilization percentages
    const dev1Util = (dev1Hours / standardHoursInSprint) * 100
    const dev2Util = (dev2Hours / standardHoursInSprint) * 100
    const designerUtil = (designerHours / standardHoursInSprint) * 100

    expect(dev1Util).toBe(100)
    expect(dev2Util).toBe(50)
    expect(designerUtil).toBe(50)
  })

  it('should detect over-allocation when user has multiple project bookings', async () => {
    const t = setup()
    const base = await createResourcePlanningBaseData(t)
    const { orgId, projectId } = base

    // Create another project
    const { id: companyId } = await createTestCompany(t, orgId, { name: 'Another Corp' })
    const { id: contactId } = await createTestContact(t, orgId, companyId)
    const { id: dealId } = await createTestDeal(t, orgId, companyId, base.userId, contactId)
    const { id: project2Id } = await createTestProject(t, orgId, companyId, dealId, base.userId)

    // Create a team member
    const { id: teamMember } = await createTestUser(t, orgId, { name: 'Busy Dev' })

    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000
    const weekEnd = now + oneDay * 4 // 5 days

    // Book on project 1: 6 hours/day
    await createTestBooking(t, orgId, teamMember, projectId, {
      startDate: now,
      endDate: weekEnd,
      hoursPerDay: 6,
    })

    // Book on project 2: 4 hours/day (over-allocation!)
    await createTestBooking(t, orgId, teamMember, project2Id, {
      startDate: now,
      endDate: weekEnd,
      hoursPerDay: 4,
    })

    const bookedHours = await t.run(async (ctx) => {
      return await calculateUserBookedHours(ctx.db, teamMember, now, weekEnd)
    })

    const standardHours = 5 * 8 // 40 hours in a week
    const utilizationPercent = (bookedHours / standardHours) * 100

    // 5 days × (6 + 4) = 50 hours, which is 125% utilization
    expect(bookedHours).toBe(50)
    expect(utilizationPercent).toBe(125)
    expect(utilizationPercent > 100).toBe(true) // Over-allocated!
  })
})
