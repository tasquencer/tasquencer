/// <reference types="vite/client" />
/**
 * Tests for time tracking DB functions
 *
 * These tests cover the database functions used by the time tracking workflow,
 * focusing on query and listing functions that weren't fully tested in domain-db.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'
import {
  insertTimeEntry,
  getTimeEntry,
  updateTimeEntry,
  listTimeEntriesByUser,
  listTimeEntriesByUserAndDate,
  listTimeEntriesByStatus,
  listSubmittedTimeEntriesByProject,
  listApprovedTimeEntriesByProject,
  lockTimeEntry,
} from '../workflows/dealToDelivery/db/timeEntries'

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

async function createTestOrganization(
  t: TestContext,
  overrides: Partial<OmitIdAndCreationTime<Doc<'organizations'>>> = {}
): Promise<Id<'organizations'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', {
      name: 'Test Organization',
      settings: {},
      createdAt: Date.now(),
      ...overrides,
    })
  })
}

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
      costRate: 10000,
      billRate: 15000,
      skills: [],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
      ...overrides,
    })
  })
}

async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>
): Promise<Id<'companies'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId,
      name: 'Test Company',
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

async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<Id<'contacts'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId,
      companyId,
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1-555-0100',
      isPrimary: true,
    })
  })
}

async function createTestDeal(
  t: TestContext,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  ownerId: Id<'users'>,
  contactId: Id<'contacts'>
): Promise<Id<'deals'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Test Deal',
      stage: 'Lead',
      probability: 10,
      value: 100000,
      ownerId,
      createdAt: Date.now(),
    })
  })
}

async function createTestProject(
  t: TestContext,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  dealId: Id<'deals'>,
  managerId: Id<'users'>
): Promise<Id<'projects'>> {
  const now = Date.now()
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      dealId,
      managerId,
      name: 'Test Project',
      status: 'Active',
      startDate: now,
      endDate: now + 90 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
  })
}

async function createTestInvoice(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>
): Promise<Id<'invoices'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('invoices', {
      organizationId: orgId,
      projectId,
      companyId,
      status: 'Finalized',
      method: 'TimeAndMaterials',
      subtotal: 100000,
      tax: 10000,
      total: 110000,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    })
  })
}

async function createBaseTestData(t: TestContext) {
  const orgId = await createTestOrganization(t)
  const userId = await createTestUser(t, orgId)
  const companyId = await createTestCompany(t, orgId)
  const contactId = await createTestContact(t, orgId, companyId)
  const dealId = await createTestDeal(t, orgId, companyId, userId, contactId)
  const projectId = await createTestProject(t, orgId, companyId, dealId, userId)
  return { orgId, userId, companyId, contactId, dealId, projectId }
}

// =============================================================================
// Time Entry Query Tests
// =============================================================================

describe('Time Entry Query Functions', () => {
  describe('getTimeEntry', () => {
    it('should return a time entry by ID', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const entryId = await t.run(async (ctx) => {
        return await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          notes: 'Test entry',
          createdAt: Date.now(),
        })
      })

      const entry = await t.run(async (ctx) => {
        return await getTimeEntry(ctx.db, entryId)
      })

      expect(entry).not.toBeNull()
      expect(entry?.hours).toBe(4)
      expect(entry?.status).toBe('Draft')
      expect(entry?.notes).toBe('Test entry')
    })

    it('should return null for non-existent entry', async () => {
      const t = setup()
      const { orgId: _orgId } = await createBaseTestData(t)

      const entry = await t.run(async (ctx) => {
        // Use a fake ID
        return await getTimeEntry(ctx.db, 'jd7g3mnabcdefg12345678' as Id<'timeEntries'>)
      })

      expect(entry).toBeNull()
    })
  })

  describe('listTimeEntriesByUser', () => {
    it('should list all entries for a user', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      // Create multiple entries
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now() - 86400000, // Yesterday
          hours: 8,
          billable: true,
          status: 'Approved',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listTimeEntriesByUser(ctx.db, userId)
      })

      expect(entries).toHaveLength(2)
    })

    it('should not return entries for other users', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)
      const otherUserId = await createTestUser(t, orgId, { name: 'Other User' })

      // Create entries for different users
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId: otherUserId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listTimeEntriesByUser(ctx.db, userId)
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].userId).toBe(userId)
    })
  })

  describe('listTimeEntriesByUserAndDate', () => {
    it('should list entries for a specific user and date', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const targetDate = Date.now()
      const yesterday = targetDate - 86400000

      await t.run(async (ctx) => {
        // Entry for today
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: targetDate,
          hours: 8,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
        // Entry for yesterday
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: yesterday,
          hours: 4,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listTimeEntriesByUserAndDate(ctx.db, userId, targetDate)
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].date).toBe(targetDate)
    })
  })

  describe('listTimeEntriesByStatus', () => {
    it('should filter entries by status', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          billable: true,
          status: 'Submitted',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
      })

      const submittedEntries = await t.run(async (ctx) => {
        return await listTimeEntriesByStatus(ctx.db, orgId, 'Submitted')
      })

      expect(submittedEntries).toHaveLength(1)
      expect(submittedEntries[0].status).toBe('Submitted')
    })
  })

  describe('listSubmittedTimeEntriesByProject', () => {
    it('should return only submitted entries for a project', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          billable: true,
          status: 'Submitted',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 6,
          billable: true,
          status: 'Approved',
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listSubmittedTimeEntriesByProject(ctx.db, projectId)
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].status).toBe('Submitted')
    })
  })

  describe('listApprovedTimeEntriesByProject', () => {
    it('should return only approved entries for a project', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          billable: true,
          status: 'Approved',
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Submitted',
          createdAt: Date.now(),
        })
      })

      const entries = await t.run(async (ctx) => {
        return await listApprovedTimeEntriesByProject(ctx.db, projectId)
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].status).toBe('Approved')
    })
  })
})

// =============================================================================
// Time Entry Mutation Tests
// =============================================================================

describe('Time Entry Mutation Functions', () => {
  describe('updateTimeEntry', () => {
    it('should update time entry fields', async () => {
      const t = setup()
      const { orgId, userId, projectId } = await createBaseTestData(t)

      const entryId = await t.run(async (ctx) => {
        return await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 4,
          billable: true,
          status: 'Draft',
          notes: 'Original notes',
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await updateTimeEntry(ctx.db, entryId, {
          hours: 8,
          notes: 'Updated notes',
          billable: false,
        })
      })

      const entry = await t.run(async (ctx) => {
        return await getTimeEntry(ctx.db, entryId)
      })

      expect(entry?.hours).toBe(8)
      expect(entry?.notes).toBe('Updated notes')
      expect(entry?.billable).toBe(false)
    })
  })

  describe('lockTimeEntry', () => {
    it('should lock entry with invoice reference', async () => {
      const t = setup()
      const { orgId, userId, projectId, companyId } = await createBaseTestData(t)

      const entryId = await t.run(async (ctx) => {
        return await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          billable: true,
          status: 'Approved',
          createdAt: Date.now(),
        })
      })

      const invoiceId = await createTestInvoice(t, orgId, projectId, companyId)

      await t.run(async (ctx) => {
        await lockTimeEntry(ctx.db, entryId, invoiceId)
      })

      const entry = await t.run(async (ctx) => {
        return await getTimeEntry(ctx.db, entryId)
      })

      expect(entry?.status).toBe('Locked')
      expect(entry?.invoiceId).toBe(invoiceId)
    })
  })
})

// =============================================================================
// Time Entry Validation Tests
// =============================================================================

describe('Time Entry Validation', () => {
  it('should store hours as decimal values', async () => {
    const t = setup()
    const { orgId, userId, projectId } = await createBaseTestData(t)

    const entryId = await t.run(async (ctx) => {
      return await insertTimeEntry(ctx.db, {
        organizationId: orgId,
        userId,
        projectId,
        date: Date.now(),
        hours: 2.5, // 2 hours 30 minutes
        billable: true,
        status: 'Draft',
        createdAt: Date.now(),
      })
    })

    const entry = await t.run(async (ctx) => {
      return await getTimeEntry(ctx.db, entryId)
    })

    expect(entry?.hours).toBe(2.5)
  })

  it('should store optional task and service IDs', async () => {
    const t = setup()
    const { orgId, userId, projectId } = await createBaseTestData(t)

    // Create a task for the project
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('tasks', {
        organizationId: orgId,
        projectId,
        name: 'Test Task',
        description: '',
        status: 'Todo',
        assigneeIds: [userId],
        estimatedHours: 8,
        priority: 'Medium',
        dependencies: [],
        sortOrder: 1,
        createdAt: Date.now(),
      })
    })

    const entryId = await t.run(async (ctx) => {
      return await insertTimeEntry(ctx.db, {
        organizationId: orgId,
        userId,
        projectId,
        taskId, // Optional task
        date: Date.now(),
        hours: 4,
        billable: true,
        status: 'Draft',
        createdAt: Date.now(),
      })
    })

    const entry = await t.run(async (ctx) => {
      return await getTimeEntry(ctx.db, entryId)
    })

    expect(entry?.taskId).toBe(taskId)
  })
})
