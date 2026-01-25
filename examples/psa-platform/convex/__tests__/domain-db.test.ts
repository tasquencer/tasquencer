/// <reference types="vite/client" />
/**
 * Tests for domain DB functions in the deal-to-delivery workflow
 *
 * These tests validate the CRUD operations and business logic for all
 * domain entities: organizations, users, companies, contacts, deals,
 * projects, budgets, bookings, time entries, expenses, invoices, and payments.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'
import { EntityNotFoundError } from '@repo/tasquencer'

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

/**
 * Create base test data (org, user, company, contact) for deal tests
 */
async function createBaseTestData(t: TestContext) {
  const { id: orgId } = await createTestOrganization(t)
  const { id: userId } = await createTestUser(t, orgId)
  const { id: companyId } = await createTestCompany(t, orgId)
  const { id: contactId } = await createTestContact(t, orgId, companyId)
  return { orgId, userId, companyId, contactId }
}

/**
 * Create a test organization
 */
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

/**
 * Create a test user
 */
async function createTestUser(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<{ id: Id<'users'>; data: OmitIdAndCreationTime<Doc<'users'>> }> {
  const data: OmitIdAndCreationTime<Doc<'users'>> = {
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
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('users', data)
  })
  return { id, data }
}

/**
 * Create a test company
 */
async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'companies'>>> = {}
): Promise<{ id: Id<'companies'>; data: OmitIdAndCreationTime<Doc<'companies'>> }> {
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
  return { id, data }
}

/**
 * Create a test contact
 */
async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'contacts'>>> = {}
): Promise<{ id: Id<'contacts'>; data: OmitIdAndCreationTime<Doc<'contacts'>> }> {
  const data: OmitIdAndCreationTime<Doc<'contacts'>> = {
    organizationId,
    companyId,
    name: 'John Doe',
    email: `contact-${Date.now()}@acme.example.com`,
    phone: '+1-555-0101',
    isPrimary: false,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', data)
  })
  return { id, data }
}

/**
 * Create a test deal (requires contactId to be set in overrides or defaults to creating one)
 */
async function createTestDeal(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  ownerId: Id<'users'>,
  contactId: Id<'contacts'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'deals'>>> = {}
): Promise<{ id: Id<'deals'>; data: OmitIdAndCreationTime<Doc<'deals'>> }> {
  const data: OmitIdAndCreationTime<Doc<'deals'>> = {
    organizationId,
    companyId,
    contactId,
    ownerId,
    name: 'New Software Project',
    value: 10000000, // $100,000 in cents
    stage: 'Lead',
    probability: 10,
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('deals', data)
  })
  return { id, data }
}

/**
 * Create a test project
 */
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

/**
 * Create a test booking
 */
async function createTestBooking(
  t: TestContext,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
  projectId: Id<'projects'>,
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
 * Create a test time entry
 */
async function createTestTimeEntry(
  t: TestContext,
  organizationId: Id<'organizations'>,
  userId: Id<'users'>,
  projectId: Id<'projects'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'timeEntries'>>> = {}
): Promise<{ id: Id<'timeEntries'>; data: OmitIdAndCreationTime<Doc<'timeEntries'>> }> {
  const now = Date.now()
  const data: OmitIdAndCreationTime<Doc<'timeEntries'>> = {
    organizationId,
    userId,
    projectId,
    date: now,
    hours: 8,
    notes: 'Development work',
    billable: true,
    status: 'Draft',
    createdAt: now,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('timeEntries', data)
  })
  return { id, data }
}

/**
 * Create a test invoice
 */
async function createTestInvoice(
  t: TestContext,
  organizationId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'invoices'>>> = {}
): Promise<{ id: Id<'invoices'>; data: OmitIdAndCreationTime<Doc<'invoices'>> }> {
  const now = Date.now()
  const data: OmitIdAndCreationTime<Doc<'invoices'>> = {
    organizationId,
    projectId,
    companyId,
    status: 'Draft',
    method: 'TimeAndMaterials',
    subtotal: 1000000, // $10,000 in cents
    tax: 100000, // $1,000 in cents
    total: 1100000, // $11,000 in cents
    dueDate: now + 30 * 24 * 60 * 60 * 1000, // 30 days
    createdAt: now,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('invoices', data)
  })
  return { id, data }
}

// =============================================================================
// Import DB functions to test
// =============================================================================

import {
  insertOrganization,
  getOrganization,
  updateOrganization,
  listOrganizations,
} from '../workflows/dealToDelivery/db/organizations'

import {
  insertUser,
  getUser,
  getUserByEmail,
  updateUser,
  listUsersByOrganization,
  listActiveUsersByOrganization,
  listUsersBySkill,
  listUsersByDepartment,
} from '../workflows/dealToDelivery/db/users'

import {
  insertCompany,
  getCompany,
  updateCompany,
  listCompaniesByOrganization,
} from '../workflows/dealToDelivery/db/companies'

import {
  insertContact,
  getContact,
  updateContact,
  listContactsByCompany,
  listContactsByOrganization,
  getPrimaryContactForCompany,
} from '../workflows/dealToDelivery/db/contacts'

import {
  insertDeal,
  getDeal,
  updateDealStage,
  listDealsByOrganization,
  listDealsByStage,
  listDealsByOwner,
} from '../workflows/dealToDelivery/db/deals'

import {
  insertProject,
  getProject,
  getProjectByDealId,
  updateProjectStatus,
  listProjectsByOrganization,
  listProjectsByStatus,
  listProjectsByManager,
  listProjectsByCompany,
} from '../workflows/dealToDelivery/db/projects'

import {
  insertBooking,
  getBooking,
  updateBookingType,
  deleteBooking,
  listBookingsByProject,
  listTentativeBookingsByProject,
  confirmAllTentativeBookings,
} from '../workflows/dealToDelivery/db/bookings'

import {
  insertTimeEntry,
  updateTimeEntryStatus,
  listBillableUninvoicedTimeEntries,
  approveTimeEntry,
  rejectTimeEntry,
  calculateProjectHours,
} from '../workflows/dealToDelivery/db/timeEntries'

import {
  insertInvoice,
  updateInvoiceStatus,
  finalizeInvoice,
  markInvoiceSent,
  insertInvoiceLineItem,
  listLineItemsByInvoice,
  recalculateInvoiceTotals,
  insertPayment,
  calculateInvoicePayments,
  recordPaymentAndCheckPaid,
} from '../workflows/dealToDelivery/db/invoices'

import {
  insertBudget,
  getBudget,
  getBudgetByProjectId,
  updateBudget,
  insertService,
  getService,
  listServicesByBudget,
  updateService,
  deleteService,
  recalculateBudgetTotal,
} from '../workflows/dealToDelivery/db/budgets'

import {
  insertEstimate,
  getEstimate,
  getEstimateByDealId,
  insertEstimateService,
  listEstimateServices,
  recalculateEstimateTotal,
} from '../workflows/dealToDelivery/db/estimates'

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
// Organization Tests
// =============================================================================

describe('Organizations DB Functions', () => {
  describe('insertOrganization', () => {
    it('should insert a new organization', async () => {
      const t = setup()

      const orgId = await t.run(async (ctx) => {
        return await insertOrganization(ctx.db, {
          name: 'Test Org',
          settings: { timezone: 'UTC' },
          createdAt: Date.now(),
        })
      })

      expect(orgId).toBeDefined()

      const org = await t.run(async (ctx) => {
        return await ctx.db.get(orgId)
      })
      expect(org?.name).toBe('Test Org')
    })
  })

  describe('getOrganization', () => {
    it('should return organization by ID', async () => {
      const t = setup()
      const { id } = await createTestOrganization(t, { name: 'My Org' })

      const org = await t.run(async (ctx) => {
        return await getOrganization(ctx.db, id)
      })

      expect(org).not.toBeNull()
      expect(org?.name).toBe('My Org')
    })

    it('should return null for non-existent organization', async () => {
      const t = setup()
      const fakeId = 'k170pv7x1wqjc3t5e3yjfxd26d72q4v3' as Id<'organizations'>

      const org = await t.run(async (ctx) => {
        return await getOrganization(ctx.db, fakeId)
      })

      expect(org).toBeNull()
    })
  })

  describe('updateOrganization', () => {
    it('should update organization fields', async () => {
      const t = setup()
      const { id } = await createTestOrganization(t)

      await t.run(async (ctx) => {
        await updateOrganization(ctx.db, id, { name: 'Updated Org' })
      })

      const org = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })
      expect(org?.name).toBe('Updated Org')
    })

    it('should throw EntityNotFoundError for non-existent organization', async () => {
      const t = setup()
      const fakeId = 'k170pv7x1wqjc3t5e3yjfxd26d72q4v3' as Id<'organizations'>

      await expect(
        t.run(async (ctx) => {
          await updateOrganization(ctx.db, fakeId, { name: 'Test' })
        })
      ).rejects.toThrow(EntityNotFoundError)
    })
  })

  describe('listOrganizations', () => {
    it('should return all organizations', async () => {
      const t = setup()
      await createTestOrganization(t, { name: 'Org 1' })
      await createTestOrganization(t, { name: 'Org 2' })

      const orgs = await t.run(async (ctx) => {
        return await listOrganizations(ctx.db)
      })

      expect(orgs).toHaveLength(2)
    })

    it('should respect limit parameter', async () => {
      const t = setup()
      await createTestOrganization(t, { name: 'Org 1' })
      await createTestOrganization(t, { name: 'Org 2' })
      await createTestOrganization(t, { name: 'Org 3' })

      const orgs = await t.run(async (ctx) => {
        return await listOrganizations(ctx.db, 2)
      })

      expect(orgs).toHaveLength(2)
    })
  })
})

// =============================================================================
// User Tests
// =============================================================================

describe('Users DB Functions', () => {
  describe('insertUser', () => {
    it('should insert a new user', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      const userId = await t.run(async (ctx) => {
        return await insertUser(ctx.db, {
          organizationId: orgId,
          email: 'test@example.com',
          name: 'Test User',
          role: 'admin',
          costRate: 10000,
          billRate: 15000,
          skills: ['TypeScript', 'React'],
          department: 'Engineering',
          location: 'NYC',
          isActive: true,
        })
      })

      expect(userId).toBeDefined()
    })
  })

  describe('getUser', () => {
    it('should return user by ID', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: userId } = await createTestUser(t, orgId, { name: 'Alice' })

      const user = await t.run(async (ctx) => {
        return await getUser(ctx.db, userId)
      })

      expect(user?.name).toBe('Alice')
    })
  })

  describe('getUserByEmail', () => {
    it('should return user by email within organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestUser(t, orgId, { email: 'alice@example.com', name: 'Alice' })

      const user = await t.run(async (ctx) => {
        return await getUserByEmail(ctx.db, orgId, 'alice@example.com')
      })

      expect(user?.name).toBe('Alice')
    })

    it('should return null for non-existent email', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      const user = await t.run(async (ctx) => {
        return await getUserByEmail(ctx.db, orgId, 'nonexistent@example.com')
      })

      expect(user).toBeNull()
    })
  })

  describe('updateUser', () => {
    it('should update user fields', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: userId } = await createTestUser(t, orgId)

      await t.run(async (ctx) => {
        await updateUser(ctx.db, userId, { name: 'Updated Name', role: 'manager' })
      })

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId)
      })
      expect(user?.name).toBe('Updated Name')
      expect(user?.role).toBe('manager')
    })
  })

  describe('listUsersByOrganization', () => {
    it('should return users for organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestUser(t, orgId, { name: 'Alice' })
      await createTestUser(t, orgId, { name: 'Bob' })

      const users = await t.run(async (ctx) => {
        return await listUsersByOrganization(ctx.db, orgId)
      })

      expect(users).toHaveLength(2)
    })
  })

  describe('listActiveUsersByOrganization', () => {
    it('should return only active users', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestUser(t, orgId, { name: 'Active', isActive: true })
      await createTestUser(t, orgId, { name: 'Inactive', isActive: false })

      const users = await t.run(async (ctx) => {
        return await listActiveUsersByOrganization(ctx.db, orgId)
      })

      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('Active')
    })
  })

  describe('listUsersBySkill', () => {
    it('should return users with specific skill', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestUser(t, orgId, { name: 'React Dev', skills: ['React', 'TypeScript'] })
      await createTestUser(t, orgId, { name: 'Python Dev', skills: ['Python'] })

      const users = await t.run(async (ctx) => {
        return await listUsersBySkill(ctx.db, orgId, 'React')
      })

      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('React Dev')
    })
  })

  describe('listUsersByDepartment', () => {
    it('should return users in specific department', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestUser(t, orgId, { name: 'Engineer', department: 'Engineering' })
      await createTestUser(t, orgId, { name: 'Designer', department: 'Design' })

      const users = await t.run(async (ctx) => {
        return await listUsersByDepartment(ctx.db, orgId, 'Engineering')
      })

      expect(users).toHaveLength(1)
      expect(users[0].name).toBe('Engineer')
    })
  })
})

// =============================================================================
// Company Tests
// =============================================================================

describe('Companies DB Functions', () => {
  describe('insertCompany', () => {
    it('should insert a new company', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      const companyId = await t.run(async (ctx) => {
        return await insertCompany(ctx.db, {
          organizationId: orgId,
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

      expect(companyId).toBeDefined()
    })
  })

  describe('getCompany', () => {
    it('should return company by ID', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId, { name: 'Globex' })

      const company = await t.run(async (ctx) => {
        return await getCompany(ctx.db, companyId)
      })

      expect(company?.name).toBe('Globex')
    })
  })

  describe('updateCompany', () => {
    it('should update company fields', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)

      await t.run(async (ctx) => {
        await updateCompany(ctx.db, companyId, { paymentTerms: 45 })
      })

      const company = await t.run(async (ctx) => {
        return await ctx.db.get(companyId)
      })
      expect(company?.paymentTerms).toBe(45)
    })
  })

  describe('listCompaniesByOrganization', () => {
    it('should return companies for organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestCompany(t, orgId, { name: 'Company A' })
      await createTestCompany(t, orgId, { name: 'Company B' })

      const companies = await t.run(async (ctx) => {
        return await listCompaniesByOrganization(ctx.db, orgId)
      })

      expect(companies).toHaveLength(2)
    })
  })
})

// =============================================================================
// Contact Tests
// =============================================================================

describe('Contacts DB Functions', () => {
  describe('insertContact', () => {
    it('should insert a new contact', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)

      const contactId = await t.run(async (ctx) => {
        return await insertContact(ctx.db, {
          organizationId: orgId,
          companyId,
          name: 'Jane Doe',
          email: 'jane@acme.com',
          phone: '+1-555-0102',
          isPrimary: true,
        })
      })

      expect(contactId).toBeDefined()
    })
  })

  describe('getContact', () => {
    it('should return contact by ID', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      const { id: contactId } = await createTestContact(t, orgId, companyId, { name: 'Jane' })

      const contact = await t.run(async (ctx) => {
        return await getContact(ctx.db, contactId)
      })

      expect(contact?.name).toBe('Jane')
    })
  })

  describe('listContactsByCompany', () => {
    it('should return contacts for a company', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      await createTestContact(t, orgId, companyId, { name: 'Contact 1' })
      await createTestContact(t, orgId, companyId, { name: 'Contact 2' })

      const contacts = await t.run(async (ctx) => {
        return await listContactsByCompany(ctx.db, companyId)
      })

      expect(contacts).toHaveLength(2)
    })
  })

  describe('updateContact', () => {
    it('should update contact fields', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      const { id: contactId } = await createTestContact(t, orgId, companyId, {
        name: 'Original Name',
        email: 'original@example.com',
        phone: '+1-555-0100',
        isPrimary: false,
      })

      // Update multiple fields
      await t.run(async (ctx) => {
        await updateContact(ctx.db, contactId, {
          name: 'Updated Name',
          email: 'updated@example.com',
          isPrimary: true,
        })
      })

      // Verify updates
      const updated = await t.run(async (ctx) => {
        return await getContact(ctx.db, contactId)
      })

      expect(updated?.name).toBe('Updated Name')
      expect(updated?.email).toBe('updated@example.com')
      expect(updated?.isPrimary).toBe(true)
      expect(updated?.phone).toBe('+1-555-0100') // Unchanged
    })

    it('should throw EntityNotFoundError for non-existent contact', async () => {
      const t = setup()
      const fakeContactId = 'invalid_id' as Id<'contacts'>

      await expect(
        t.run(async (ctx) => {
          await updateContact(ctx.db, fakeContactId, { name: 'New Name' })
        })
      ).rejects.toThrow(EntityNotFoundError)
    })
  })

  describe('listContactsByOrganization', () => {
    it('should return all contacts for an organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: company1 } = await createTestCompany(t, orgId, { name: 'Company 1' })
      const { id: company2 } = await createTestCompany(t, orgId, { name: 'Company 2' })

      // Create contacts across multiple companies
      await createTestContact(t, orgId, company1, { name: 'Contact A' })
      await createTestContact(t, orgId, company1, { name: 'Contact B' })
      await createTestContact(t, orgId, company2, { name: 'Contact C' })

      const contacts = await t.run(async (ctx) => {
        return await listContactsByOrganization(ctx.db, orgId)
      })

      expect(contacts).toHaveLength(3)
      const names = contacts.map((c) => c.name)
      expect(names).toContain('Contact A')
      expect(names).toContain('Contact B')
      expect(names).toContain('Contact C')
    })

    it('should not return contacts from other organizations', async () => {
      const t = setup()
      const { id: org1 } = await createTestOrganization(t, { name: 'Org 1' })
      const { id: org2 } = await createTestOrganization(t, { name: 'Org 2' })
      const { id: company1 } = await createTestCompany(t, org1)
      const { id: company2 } = await createTestCompany(t, org2)

      await createTestContact(t, org1, company1, { name: 'Org1 Contact' })
      await createTestContact(t, org2, company2, { name: 'Org2 Contact' })

      const org1Contacts = await t.run(async (ctx) => {
        return await listContactsByOrganization(ctx.db, org1)
      })

      expect(org1Contacts).toHaveLength(1)
      expect(org1Contacts[0].name).toBe('Org1 Contact')
    })
  })

  describe('getPrimaryContactForCompany', () => {
    it('should return primary contact', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      await createTestContact(t, orgId, companyId, { name: 'Secondary', isPrimary: false })
      await createTestContact(t, orgId, companyId, { name: 'Primary', isPrimary: true })

      const contact = await t.run(async (ctx) => {
        return await getPrimaryContactForCompany(ctx.db, companyId)
      })

      expect(contact?.name).toBe('Primary')
    })

    it('should return first contact if no primary', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      await createTestContact(t, orgId, companyId, { name: 'First', isPrimary: false })

      const contact = await t.run(async (ctx) => {
        return await getPrimaryContactForCompany(ctx.db, companyId)
      })

      expect(contact?.name).toBe('First')
    })
  })
})

// =============================================================================
// Deal Tests
// =============================================================================

describe('Deals DB Functions', () => {
  describe('insertDeal', () => {
    it('should insert a new deal', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)

      const dealId = await t.run(async (ctx) => {
        return await insertDeal(ctx.db, {
          organizationId: orgId,
          companyId,
          contactId,
          ownerId: userId,
          name: 'Big Deal',
          value: 5000000,
          stage: 'Lead',
          probability: 10,
          createdAt: Date.now(),
        })
      })

      expect(dealId).toBeDefined()
    })
  })

  describe('getDeal', () => {
    it('should return deal by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId, { name: 'My Deal' })

      const deal = await t.run(async (ctx) => {
        return await getDeal(ctx.db, dealId)
      })

      expect(deal?.name).toBe('My Deal')
    })
  })

  describe('updateDealStage', () => {
    it('should update deal stage', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId, { stage: 'Lead' })

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, 'Qualified')
      })

      const deal = await t.run(async (ctx) => {
        return await ctx.db.get(dealId)
      })
      expect(deal?.stage).toBe('Qualified')
    })
  })

  describe('listDealsByOrganization', () => {
    it('should return deals for organization', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      await createTestDeal(t, orgId, companyId, userId, contactId, { name: 'Deal 1' })
      await createTestDeal(t, orgId, companyId, userId, contactId, { name: 'Deal 2' })

      const deals = await t.run(async (ctx) => {
        return await listDealsByOrganization(ctx.db, orgId)
      })

      expect(deals).toHaveLength(2)
    })
  })

  describe('listDealsByStage', () => {
    it('should return deals by stage', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      await createTestDeal(t, orgId, companyId, userId, contactId, { stage: 'Lead' })
      await createTestDeal(t, orgId, companyId, userId, contactId, { stage: 'Qualified' })
      await createTestDeal(t, orgId, companyId, userId, contactId, { stage: 'Lead' })

      const leads = await t.run(async (ctx) => {
        return await listDealsByStage(ctx.db, orgId, 'Lead')
      })

      expect(leads).toHaveLength(2)
    })
  })

  describe('listDealsByOwner', () => {
    it('should return deals by owner', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      const { id: contactId } = await createTestContact(t, orgId, companyId)
      const { id: user1 } = await createTestUser(t, orgId, { name: 'User 1' })
      const { id: user2 } = await createTestUser(t, orgId, { name: 'User 2' })
      await createTestDeal(t, orgId, companyId, user1, contactId, { name: 'Deal 1' })
      await createTestDeal(t, orgId, companyId, user1, contactId, { name: 'Deal 2' })
      await createTestDeal(t, orgId, companyId, user2, contactId, { name: 'Deal 3' })

      const user1Deals = await t.run(async (ctx) => {
        return await listDealsByOwner(ctx.db, user1)
      })

      expect(user1Deals).toHaveLength(2)
    })
  })
})

// =============================================================================
// Project Tests
// =============================================================================

describe('Projects DB Functions', () => {
  describe('insertProject', () => {
    it('should insert a new project', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const projectId = await t.run(async (ctx) => {
        return await insertProject(ctx.db, {
          organizationId: orgId,
          companyId,
          dealId,
          managerId: userId,
          name: 'New Project',
          status: 'Planning',
          startDate: Date.now(),
          endDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        })
      })

      expect(projectId).toBeDefined()
    })
  })

  describe('getProject', () => {
    it('should return project by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId, {
        name: 'My Project',
      })

      const project = await t.run(async (ctx) => {
        return await getProject(ctx.db, projectId)
      })

      expect(project?.name).toBe('My Project')
    })
  })

  describe('getProjectByDealId', () => {
    it('should return project by deal ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      await createTestProject(t, orgId, companyId, dealId, userId, { name: 'Project from Deal' })

      const project = await t.run(async (ctx) => {
        return await getProjectByDealId(ctx.db, dealId)
      })

      expect(project?.name).toBe('Project from Deal')
    })
  })

  describe('updateProjectStatus', () => {
    it('should update project status', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId, {
        status: 'Planning',
      })

      await t.run(async (ctx) => {
        await updateProjectStatus(ctx.db, projectId, 'Active')
      })

      const project = await t.run(async (ctx) => {
        return await ctx.db.get(projectId)
      })
      expect(project?.status).toBe('Active')
    })
  })

  describe('listProjectsByOrganization', () => {
    it('should return projects for organization', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      await createTestProject(t, orgId, companyId, dealId, userId, { name: 'Project 1' })
      await createTestProject(t, orgId, companyId, dealId, userId, { name: 'Project 2' })

      const projects = await t.run(async (ctx) => {
        return await listProjectsByOrganization(ctx.db, orgId)
      })

      expect(projects).toHaveLength(2)
    })
  })

  describe('listProjectsByStatus', () => {
    it('should return projects by status', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      await createTestProject(t, orgId, companyId, dealId, userId, { status: 'Planning' })
      await createTestProject(t, orgId, companyId, dealId, userId, { status: 'Active' })
      await createTestProject(t, orgId, companyId, dealId, userId, { status: 'Planning' })

      const planningProjects = await t.run(async (ctx) => {
        return await listProjectsByStatus(ctx.db, orgId, 'Planning')
      })

      expect(planningProjects).toHaveLength(2)
    })
  })

  describe('listProjectsByManager', () => {
    it('should return projects by manager', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: companyId } = await createTestCompany(t, orgId)
      const { id: contactId } = await createTestContact(t, orgId, companyId)
      const { id: manager1 } = await createTestUser(t, orgId, { name: 'Manager 1' })
      const { id: manager2 } = await createTestUser(t, orgId, { name: 'Manager 2' })
      const { id: dealId } = await createTestDeal(t, orgId, companyId, manager1, contactId)
      await createTestProject(t, orgId, companyId, dealId, manager1, { name: 'Project 1' })
      await createTestProject(t, orgId, companyId, dealId, manager1, { name: 'Project 2' })
      await createTestProject(t, orgId, companyId, dealId, manager2, { name: 'Project 3' })

      const manager1Projects = await t.run(async (ctx) => {
        return await listProjectsByManager(ctx.db, manager1)
      })

      expect(manager1Projects).toHaveLength(2)
    })
  })

  describe('listProjectsByCompany', () => {
    it('should return projects by company', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: company1 } = await createTestCompany(t, orgId, { name: 'Company 1' })
      const { id: company2 } = await createTestCompany(t, orgId, { name: 'Company 2' })
      const { id: contact1 } = await createTestContact(t, orgId, company1)
      const { id: contact2 } = await createTestContact(t, orgId, company2)
      const { id: userId } = await createTestUser(t, orgId)
      const { id: deal1 } = await createTestDeal(t, orgId, company1, userId, contact1)
      const { id: deal2 } = await createTestDeal(t, orgId, company2, userId, contact2)
      await createTestProject(t, orgId, company1, deal1, userId, { name: 'Project 1' })
      await createTestProject(t, orgId, company2, deal2, userId, { name: 'Project 2' })

      const company1Projects = await t.run(async (ctx) => {
        return await listProjectsByCompany(ctx.db, company1)
      })

      expect(company1Projects).toHaveLength(1)
    })
  })
})

// =============================================================================
// Booking Tests
// =============================================================================

describe('Bookings DB Functions', () => {
  describe('insertBooking', () => {
    it('should insert a new booking', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const bookingId = await t.run(async (ctx) => {
        return await insertBooking(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          type: 'Confirmed',
          startDate: Date.now(),
          endDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
          hoursPerDay: 8,
          createdAt: Date.now(),
        })
      })

      expect(bookingId).toBeDefined()
    })
  })

  describe('getBooking', () => {
    it('should return booking by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: bookingId } = await createTestBooking(t, orgId, userId, projectId, {
        notes: 'Test booking',
      })

      const booking = await t.run(async (ctx) => {
        return await getBooking(ctx.db, bookingId)
      })

      expect(booking?.notes).toBe('Test booking')
    })
  })

  describe('updateBookingType', () => {
    it('should update booking type', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: bookingId } = await createTestBooking(t, orgId, userId, projectId, {
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
  })

  describe('deleteBooking', () => {
    it('should delete booking', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: bookingId } = await createTestBooking(t, orgId, userId, projectId)

      await t.run(async (ctx) => {
        await deleteBooking(ctx.db, bookingId)
      })

      const booking = await t.run(async (ctx) => {
        return await ctx.db.get(bookingId)
      })
      expect(booking).toBeNull()
    })
  })

  describe('listBookingsByProject', () => {
    it('should return bookings for project', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      await createTestBooking(t, orgId, userId, projectId)
      await createTestBooking(t, orgId, userId, projectId)

      const bookings = await t.run(async (ctx) => {
        return await listBookingsByProject(ctx.db, projectId)
      })

      expect(bookings).toHaveLength(2)
    })
  })

  describe('listTentativeBookingsByProject', () => {
    it('should return only tentative bookings', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      await createTestBooking(t, orgId, userId, projectId, { type: 'Tentative' })
      await createTestBooking(t, orgId, userId, projectId, { type: 'Confirmed' })
      await createTestBooking(t, orgId, userId, projectId, { type: 'Tentative' })

      const tentative = await t.run(async (ctx) => {
        return await listTentativeBookingsByProject(ctx.db, projectId)
      })

      expect(tentative).toHaveLength(2)
    })
  })

  describe('confirmAllTentativeBookings', () => {
    it('should confirm all tentative bookings', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      await createTestBooking(t, orgId, userId, projectId, { type: 'Tentative' })
      await createTestBooking(t, orgId, userId, projectId, { type: 'Tentative' })

      const count = await t.run(async (ctx) => {
        return await confirmAllTentativeBookings(ctx.db, projectId)
      })

      expect(count).toBe(2)

      const tentative = await t.run(async (ctx) => {
        return await listTentativeBookingsByProject(ctx.db, projectId)
      })
      expect(tentative).toHaveLength(0)
    })
  })
})

// =============================================================================
// Time Entry Tests
// =============================================================================

describe('TimeEntries DB Functions', () => {
  describe('insertTimeEntry', () => {
    it('should insert a new time entry', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const entryId = await t.run(async (ctx) => {
        return await insertTimeEntry(ctx.db, {
          organizationId: orgId,
          userId,
          projectId,
          date: Date.now(),
          hours: 8,
          notes: 'Development',
          billable: true,
          status: 'Draft',
          createdAt: Date.now(),
        })
      })

      expect(entryId).toBeDefined()
    })
  })

  describe('updateTimeEntryStatus', () => {
    it('should update time entry status', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: entryId } = await createTestTimeEntry(t, orgId, userId, projectId, {
        status: 'Draft',
      })

      await t.run(async (ctx) => {
        await updateTimeEntryStatus(ctx.db, entryId, 'Submitted')
      })

      const entry = await t.run(async (ctx) => {
        return await ctx.db.get(entryId)
      })
      expect(entry?.status).toBe('Submitted')
    })
  })

  describe('approveTimeEntry', () => {
    it('should approve time entry with approver', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: approverId } = await createTestUser(t, orgId, { name: 'Approver' })
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: entryId } = await createTestTimeEntry(t, orgId, userId, projectId, {
        status: 'Submitted',
      })

      await t.run(async (ctx) => {
        await approveTimeEntry(ctx.db, entryId, approverId)
      })

      const entry = await t.run(async (ctx) => {
        return await ctx.db.get(entryId)
      })
      expect(entry?.status).toBe('Approved')
      expect(entry?.approvedBy).toBe(approverId)
      expect(entry?.approvedAt).toBeDefined()
    })
  })

  describe('rejectTimeEntry', () => {
    it('should reject time entry with comments', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: entryId } = await createTestTimeEntry(t, orgId, userId, projectId, {
        status: 'Submitted',
      })

      await t.run(async (ctx) => {
        await rejectTimeEntry(ctx.db, entryId, 'Needs more detail')
      })

      const entry = await t.run(async (ctx) => {
        return await ctx.db.get(entryId)
      })
      expect(entry?.status).toBe('Rejected')
      expect(entry?.rejectionComments).toBe('Needs more detail')
    })
  })

  describe('listBillableUninvoicedTimeEntries', () => {
    it('should return only billable approved uninvoiced entries', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create various entries
      await createTestTimeEntry(t, orgId, userId, projectId, {
        billable: true,
        status: 'Approved',
      }) // Should match
      await createTestTimeEntry(t, orgId, userId, projectId, {
        billable: false,
        status: 'Approved',
      }) // Non-billable
      await createTestTimeEntry(t, orgId, userId, projectId, {
        billable: true,
        status: 'Draft',
      }) // Not approved

      const entries = await t.run(async (ctx) => {
        return await listBillableUninvoicedTimeEntries(ctx.db, projectId)
      })

      expect(entries).toHaveLength(1)
      expect(entries[0].billable).toBe(true)
      expect(entries[0].status).toBe('Approved')
    })
  })

  describe('calculateProjectHours', () => {
    it('should calculate project hours correctly', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      await createTestTimeEntry(t, orgId, userId, projectId, {
        hours: 8,
        billable: true,
        status: 'Approved',
      })
      await createTestTimeEntry(t, orgId, userId, projectId, {
        hours: 4,
        billable: false,
        status: 'Approved',
      })
      await createTestTimeEntry(t, orgId, userId, projectId, {
        hours: 6,
        billable: true,
        status: 'Draft',
      })

      const result = await t.run(async (ctx) => {
        return await calculateProjectHours(ctx.db, projectId)
      })

      expect(result.total).toBe(18) // 8 + 4 + 6
      expect(result.billable).toBe(14) // 8 + 6
      expect(result.approved).toBe(12) // 8 + 4
    })
  })
})

// =============================================================================
// Invoice Tests
// =============================================================================

describe('Invoices DB Functions', () => {
  describe('insertInvoice', () => {
    it('should insert a new invoice', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const invoiceId = await t.run(async (ctx) => {
        return await insertInvoice(ctx.db, {
          organizationId: orgId,
          projectId,
          companyId,
          status: 'Draft',
          method: 'TimeAndMaterials',
          subtotal: 100000,
          tax: 10000,
          total: 110000,
          dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
        })
      })

      expect(invoiceId).toBeDefined()
    })
  })

  describe('updateInvoiceStatus', () => {
    it('should update invoice status', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      await t.run(async (ctx) => {
        await updateInvoiceStatus(ctx.db, invoiceId, 'Sent')
      })

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice?.status).toBe('Sent')
    })
  })

  describe('finalizeInvoice', () => {
    it('should finalize invoice and assign number', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      const invoiceNumber = await t.run(async (ctx) => {
        return await finalizeInvoice(ctx.db, invoiceId, userId)
      })

      // Invoice number format: INV-{YEAR}-{5-digit-sequence} per spec 11 line 408-409
      expect(invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/)

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice?.status).toBe('Finalized')
      expect(invoice?.number).toBe(invoiceNumber)
      expect(invoice?.finalizedBy).toBe(userId)
    })
  })

  describe('markInvoiceSent', () => {
    it('should mark finalized invoice as sent', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      // First finalize the invoice
      await t.run(async (ctx) => {
        await finalizeInvoice(ctx.db, invoiceId, userId)
      })

      // Then mark as sent
      await t.run(async (ctx) => {
        await markInvoiceSent(ctx.db, invoiceId)
      })

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice?.status).toBe('Sent')
      expect(invoice?.sentAt).toBeDefined()
    })

    // Send-once rule per spec 12-workflow-billing-phase.md line 397
    it('should reject re-sending already sent invoice (send-once rule)', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      // Finalize and send once
      await t.run(async (ctx) => {
        await finalizeInvoice(ctx.db, invoiceId, userId)
        await markInvoiceSent(ctx.db, invoiceId)
      })

      // Try to send again - should fail
      await expect(
        t.run(async (ctx) => {
          await markInvoiceSent(ctx.db, invoiceId)
        })
      ).rejects.toThrow(/already been sent/)
    })

    it('should reject sending Draft invoice', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      // Try to send without finalizing - should fail
      await expect(
        t.run(async (ctx) => {
          await markInvoiceSent(ctx.db, invoiceId)
        })
      ).rejects.toThrow(/Invoice must be finalized first/)
    })

    it('should throw EntityNotFoundError for non-existent invoice', async () => {
      const t = setup()
      const fakeInvoiceId = 'jd77k1a1111111111111111' as Id<'invoices'>

      await expect(
        t.run(async (ctx) => {
          await markInvoiceSent(ctx.db, fakeInvoiceId)
        })
      ).rejects.toThrow(/Invoice/)
    })
  })

  describe('Invoice Line Items', () => {
    it('should manage invoice line items', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId)

      // Insert line items
      const lineItemId = await t.run(async (ctx) => {
        return await insertInvoiceLineItem(ctx.db, {
          invoiceId,
          description: 'Development Services',
          quantity: 40,
          rate: 15000, // $150/hr in cents
          amount: 600000, // $6,000 in cents
          sortOrder: 0,
        })
      })

      expect(lineItemId).toBeDefined()

      // List line items
      const lineItems = await t.run(async (ctx) => {
        return await listLineItemsByInvoice(ctx.db, invoiceId)
      })
      expect(lineItems).toHaveLength(1)
      expect(lineItems[0].description).toBe('Development Services')
    })

    it('should recalculate invoice totals', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        subtotal: 0,
        tax: 0,
        total: 0,
      })

      // Add line items
      await t.run(async (ctx) => {
        await insertInvoiceLineItem(ctx.db, {
          invoiceId,
          description: 'Service 1',
          quantity: 1,
          rate: 100000,
          amount: 100000,
          sortOrder: 0,
        })
        await insertInvoiceLineItem(ctx.db, {
          invoiceId,
          description: 'Service 2',
          quantity: 1,
          rate: 50000,
          amount: 50000,
          sortOrder: 1,
        })
      })

      // Recalculate with 10% tax
      const result = await t.run(async (ctx) => {
        return await recalculateInvoiceTotals(ctx.db, invoiceId, 0.1)
      })

      expect(result.subtotal).toBe(150000) // $1,500
      expect(result.tax).toBe(15000) // $150 (10%)
      expect(result.total).toBe(165000) // $1,650
    })
  })

  describe('Payments', () => {
    it('should record payment and track balance', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        total: 100000,
      })

      // Record partial payment
      const paymentId = await t.run(async (ctx) => {
        return await insertPayment(ctx.db, {
          organizationId: orgId,
          invoiceId,
          amount: 50000,
          date: Date.now(),
          method: 'CreditCard',
          reference: 'CC-001',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
      })

      expect(paymentId).toBeDefined()

      // Check payment total
      const totalPaid = await t.run(async (ctx) => {
        return await calculateInvoicePayments(ctx.db, invoiceId)
      })
      expect(totalPaid).toBe(50000)
    })

    it('should mark invoice paid when fully paid', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        total: 100000,
      })

      // Record full payment
      const result = await t.run(async (ctx) => {
        return await recordPaymentAndCheckPaid(ctx.db, {
          organizationId: orgId,
          invoiceId,
          amount: 100000,
          date: Date.now(),
          method: 'BankTransfer',
          reference: 'TXN-001',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
      })

      expect(result.isPaid).toBe(true)

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice?.status).toBe('Paid')
    })

    it('should not mark invoice paid for partial payment', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: invoiceId } = await createTestInvoice(t, orgId, projectId, companyId, {
        total: 100000,
        status: 'Sent',
      })

      // Record partial payment
      const result = await t.run(async (ctx) => {
        return await recordPaymentAndCheckPaid(ctx.db, {
          organizationId: orgId,
          invoiceId,
          amount: 50000,
          date: Date.now(),
          method: 'BankTransfer',
          reference: 'TXN-001',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
      })

      expect(result.isPaid).toBe(false)

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice?.status).toBe('Sent') // Status unchanged
    })
  })
})

// =============================================================================
// Budget Tests
// =============================================================================

describe('Budgets DB Functions', () => {
  describe('insertBudget', () => {
    it('should insert a new budget', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      expect(budgetId).toBeDefined()
    })
  })

  describe('getBudget', () => {
    it('should return budget by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'FixedFee',
          totalAmount: 500000,
          createdAt: Date.now(),
        })
      })

      const budget = await t.run(async (ctx) => {
        return await getBudget(ctx.db, budgetId)
      })

      expect(budget).toBeDefined()
      expect(budget?.type).toBe('FixedFee')
      expect(budget?.totalAmount).toBe(500000)
    })
  })

  describe('getBudgetByProjectId', () => {
    it('should return budget by project ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'Retainer',
          totalAmount: 300000,
          createdAt: Date.now(),
        })
      })

      const budget = await t.run(async (ctx) => {
        return await getBudgetByProjectId(ctx.db, projectId)
      })

      expect(budget).toBeDefined()
      expect(budget?.type).toBe('Retainer')
    })
  })

  describe('updateBudget', () => {
    it('should update budget type', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await updateBudget(ctx.db, budgetId, { type: 'FixedFee' })
      })

      const budget = await t.run(async (ctx) => {
        return await ctx.db.get(budgetId)
      })
      expect(budget?.type).toBe('FixedFee')
    })
  })

  describe('Budget Services', () => {
    it('should insert and list services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      // Insert services
      await t.run(async (ctx) => {
        await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Design',
          rate: 15000, // $150/hr
          estimatedHours: 40,
          totalAmount: 600000,
        })
        await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Development',
          rate: 20000, // $200/hr
          estimatedHours: 80,
          totalAmount: 1600000,
        })
      })

      const services = await t.run(async (ctx) => {
        return await listServicesByBudget(ctx.db, budgetId)
      })

      expect(services).toHaveLength(2)
      expect(services.map(s => s.name).sort()).toEqual(['Design', 'Development'])
    })

    it('should update service details', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      const serviceId = await t.run(async (ctx) => {
        return await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Design',
          rate: 15000,
          estimatedHours: 40,
          totalAmount: 600000,
        })
      })

      await t.run(async (ctx) => {
        await updateService(ctx.db, serviceId, {
          rate: 17500,
          estimatedHours: 50,
          totalAmount: 875000,
        })
      })

      const service = await t.run(async (ctx) => {
        return await getService(ctx.db, serviceId)
      })

      expect(service?.rate).toBe(17500)
      expect(service?.estimatedHours).toBe(50)
      expect(service?.totalAmount).toBe(875000)
    })

    it('should delete service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      const serviceId = await t.run(async (ctx) => {
        return await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Design',
          rate: 15000,
          estimatedHours: 40,
          totalAmount: 600000,
        })
      })

      await t.run(async (ctx) => {
        await deleteService(ctx.db, serviceId)
      })

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })
      expect(service).toBeNull()
    })

    it('should recalculate budget total from services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)

      const budgetId = await t.run(async (ctx) => {
        return await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 0,
          createdAt: Date.now(),
        })
      })

      // Insert services with totals
      await t.run(async (ctx) => {
        await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Design',
          rate: 15000,
          estimatedHours: 40,
          totalAmount: 600000, // $6,000
        })
        await insertService(ctx.db, {
          budgetId,
          organizationId: orgId,
          name: 'Development',
          rate: 20000,
          estimatedHours: 80,
          totalAmount: 1600000, // $16,000
        })
      })

      const total = await t.run(async (ctx) => {
        return await recalculateBudgetTotal(ctx.db, budgetId)
      })

      expect(total).toBe(2200000) // $22,000

      const budget = await t.run(async (ctx) => {
        return await ctx.db.get(budgetId)
      })
      expect(budget?.totalAmount).toBe(2200000)
    })
  })
})

// =============================================================================
// Estimate Tests
// =============================================================================

describe('Estimates DB Functions', () => {
  describe('insertEstimate', () => {
    it('should insert a new estimate', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const estimateId = await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 0,
          createdAt: Date.now(),
        })
      })

      expect(estimateId).toBeDefined()
    })
  })

  describe('getEstimate', () => {
    it('should return estimate by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const estimateId = await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 500000,
          createdAt: Date.now(),
        })
      })

      const estimate = await t.run(async (ctx) => {
        return await getEstimate(ctx.db, estimateId)
      })

      expect(estimate).toBeDefined()
      expect(estimate?.total).toBe(500000)
    })
  })

  describe('getEstimateByDealId', () => {
    it('should return estimate by deal ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 750000,
          createdAt: Date.now(),
        })
      })

      const estimate = await t.run(async (ctx) => {
        return await getEstimateByDealId(ctx.db, dealId)
      })

      expect(estimate).toBeDefined()
      expect(estimate?.total).toBe(750000)
    })

    it('should return most recent estimate for deal', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      // Insert older estimate
      await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 500000,
          createdAt: Date.now() - 1000,
        })
      })

      // Insert newer estimate
      await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 800000,
          createdAt: Date.now(),
        })
      })

      const estimate = await t.run(async (ctx) => {
        return await getEstimateByDealId(ctx.db, dealId)
      })

      expect(estimate?.total).toBe(800000)
    })
  })

  describe('Estimate Services', () => {
    it('should insert and list estimate services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const estimateId = await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 0,
          createdAt: Date.now(),
        })
      })

      // Insert services
      await t.run(async (ctx) => {
        await insertEstimateService(ctx.db, {
          estimateId,
          name: 'Design',
          rate: 15000,
          hours: 40,
          total: 600000,
        })
        await insertEstimateService(ctx.db, {
          estimateId,
          name: 'Development',
          rate: 20000,
          hours: 80,
          total: 1600000,
        })
      })

      const services = await t.run(async (ctx) => {
        return await listEstimateServices(ctx.db, estimateId)
      })

      expect(services).toHaveLength(2)
      expect(services.map(s => s.name).sort()).toEqual(['Design', 'Development'])
    })

    it('should recalculate estimate total from services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const estimateId = await t.run(async (ctx) => {
        return await insertEstimate(ctx.db, {
          organizationId: orgId,
          dealId,
          total: 0,
          createdAt: Date.now(),
        })
      })

      // Insert services
      await t.run(async (ctx) => {
        await insertEstimateService(ctx.db, {
          estimateId,
          name: 'Design',
          rate: 15000,
          hours: 40,
          total: 600000, // $6,000
        })
        await insertEstimateService(ctx.db, {
          estimateId,
          name: 'Development',
          rate: 20000,
          hours: 80,
          total: 1600000, // $16,000
        })
      })

      const total = await t.run(async (ctx) => {
        return await recalculateEstimateTotal(ctx.db, estimateId)
      })

      expect(total).toBe(2200000) // $22,000

      const estimate = await t.run(async (ctx) => {
        return await ctx.db.get(estimateId)
      })
      expect(estimate?.total).toBe(2200000)
    })
  })
})

// =============================================================================
// Proposal DB Function Imports (for proposal tests)
// =============================================================================

import {
  insertProposal,
  getProposal,
  listProposalsByDeal,
  getLatestProposalForDeal,
  getNextProposalVersion,
  markProposalSent,
  markProposalViewed,
  markProposalSigned,
  markProposalRejected,
} from '../workflows/dealToDelivery/db/proposals'

// =============================================================================
// Proposal Tests
// =============================================================================

/**
 * Create a test proposal
 */
async function createTestProposal(
  t: TestContext,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'proposals'>>> = {}
): Promise<{ id: Id<'proposals'>; data: OmitIdAndCreationTime<Doc<'proposals'>> }> {
  const data: OmitIdAndCreationTime<Doc<'proposals'>> = {
    organizationId: orgId,
    dealId,
    version: 1,
    status: 'Draft',
    documentUrl: 'https://example.com/proposal.pdf',
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await insertProposal(ctx.db, data)
  })
  return { id, data }
}

describe('Proposals DB Functions', () => {
  describe('insertProposal', () => {
    it('should insert a new proposal', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const proposalId = await t.run(async (ctx) => {
        return await insertProposal(ctx.db, {
          organizationId: orgId,
          dealId,
          version: 1,
          status: 'Draft',
          documentUrl: 'https://example.com/proposal.pdf',
          createdAt: Date.now(),
        })
      })

      expect(proposalId).toBeDefined()
    })
  })

  describe('getProposal', () => {
    it('should return proposal by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: proposalId } = await createTestProposal(t, orgId, dealId)

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      expect(proposal?.version).toBe(1)
      expect(proposal?.status).toBe('Draft')
    })
  })

  describe('listProposalsByDeal', () => {
    it('should return proposals for a deal ordered by descending creation', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      // Create multiple proposals
      await createTestProposal(t, orgId, dealId, { version: 1 })
      await createTestProposal(t, orgId, dealId, { version: 2 })
      await createTestProposal(t, orgId, dealId, { version: 3 })

      const proposals = await t.run(async (ctx) => {
        return await listProposalsByDeal(ctx.db, dealId)
      })

      expect(proposals).toHaveLength(3)
      // Should be ordered descending
      expect(proposals[0].version).toBe(3)
      expect(proposals[1].version).toBe(2)
      expect(proposals[2].version).toBe(1)
    })
  })

  describe('getLatestProposalForDeal', () => {
    it('should return the most recent proposal', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      await createTestProposal(t, orgId, dealId, { version: 1 })
      await createTestProposal(t, orgId, dealId, { version: 2 })

      const latest = await t.run(async (ctx) => {
        return await getLatestProposalForDeal(ctx.db, dealId)
      })

      expect(latest?.version).toBe(2)
    })

    it('should return null if no proposals exist', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const latest = await t.run(async (ctx) => {
        return await getLatestProposalForDeal(ctx.db, dealId)
      })

      expect(latest).toBeNull()
    })
  })

  describe('getNextProposalVersion', () => {
    it('should return 1 for first proposal', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      const nextVersion = await t.run(async (ctx) => {
        return await getNextProposalVersion(ctx.db, dealId)
      })

      expect(nextVersion).toBe(1)
    })

    it('should return next sequential version number', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      // Create 3 proposals
      await createTestProposal(t, orgId, dealId, { version: 1 })
      await createTestProposal(t, orgId, dealId, { version: 2 })
      await createTestProposal(t, orgId, dealId, { version: 3 })

      const nextVersion = await t.run(async (ctx) => {
        return await getNextProposalVersion(ctx.db, dealId)
      })

      expect(nextVersion).toBe(4)
    })

    it('should handle gaps in version numbers', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      // Create proposals with gaps (simulating deleted versions)
      await createTestProposal(t, orgId, dealId, { version: 1 })
      await createTestProposal(t, orgId, dealId, { version: 5 })

      const nextVersion = await t.run(async (ctx) => {
        return await getNextProposalVersion(ctx.db, dealId)
      })

      expect(nextVersion).toBe(6)
    })

    it('should correctly track version count for revision limit enforcement', async () => {
      // This test verifies the version counting that the reviseProposal work item
      // uses to enforce the maximum 5 revisions rule (spec 03-workflow-sales-phase.md line 390)
      // Version 1 = original proposal, Versions 2-6 = 5 allowed revisions
      // Version 7+ requires manager approval
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)

      // Create 6 proposals (original + 5 revisions = the limit)
      for (let i = 1; i <= 6; i++) {
        await createTestProposal(t, orgId, dealId, { version: i })
      }

      const nextVersion = await t.run(async (ctx) => {
        return await getNextProposalVersion(ctx.db, dealId)
      })

      // Next version would be 7, which exceeds the MAX_REVISION_VERSION of 6
      // The reviseProposal.workItem.ts enforces: if (version > 6) throw Error
      expect(nextVersion).toBe(7)
      expect(nextVersion > 6).toBe(true) // Would trigger revision limit error
    })
  })

  describe('markProposalSent', () => {
    it('should update proposal status to Sent', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: proposalId } = await createTestProposal(t, orgId, dealId)

      await t.run(async (ctx) => {
        await markProposalSent(ctx.db, proposalId)
      })

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      expect(proposal?.status).toBe('Sent')
      expect(proposal?.sentAt).toBeDefined()
    })
  })

  describe('markProposalViewed', () => {
    it('should update proposal status to Viewed', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: proposalId } = await createTestProposal(t, orgId, dealId, { status: 'Sent' })

      await t.run(async (ctx) => {
        await markProposalViewed(ctx.db, proposalId)
      })

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      expect(proposal?.status).toBe('Viewed')
      expect(proposal?.viewedAt).toBeDefined()
    })

    it('should be idempotent - does not update if already viewed', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      // Create proposal with viewedAt already set
      const existingViewedAt = Date.now() - 100000 // Set in the past
      const { id: proposalId } = await createTestProposal(t, orgId, dealId, {
        status: 'Viewed',
        viewedAt: existingViewedAt,
      })

      // Call markProposalViewed on already-viewed proposal
      await t.run(async (ctx) => {
        await markProposalViewed(ctx.db, proposalId)
      })

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      // viewedAt should remain unchanged (idempotent behavior)
      expect(proposal?.viewedAt).toBe(existingViewedAt)
      expect(proposal?.status).toBe('Viewed')
    })
  })

  describe('markProposalSigned', () => {
    it('should update proposal status to Signed', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: proposalId } = await createTestProposal(t, orgId, dealId)

      await t.run(async (ctx) => {
        await markProposalSigned(ctx.db, proposalId)
      })

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      expect(proposal?.status).toBe('Signed')
      expect(proposal?.signedAt).toBeDefined()
    })
  })

  describe('markProposalRejected', () => {
    it('should update proposal status to Rejected', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: proposalId } = await createTestProposal(t, orgId, dealId)

      await t.run(async (ctx) => {
        await markProposalRejected(ctx.db, proposalId)
      })

      const proposal = await t.run(async (ctx) => {
        return await getProposal(ctx.db, proposalId)
      })

      expect(proposal?.status).toBe('Rejected')
      expect(proposal?.rejectedAt).toBeDefined()
    })
  })
})
