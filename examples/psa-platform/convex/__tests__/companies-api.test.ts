/// <reference types="vite/client" />
/**
 * Companies API Tests
 *
 * Tests for company and contact CRUD operations via the API layer.
 *
 * Key test scenarios:
 * - Creating companies with required fields
 * - Updating company information
 * - Creating contacts linked to companies
 * - Updating contact information
 * - Authorization checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

// All scopes needed for company/contact tests
const STAFF_SCOPES = ['dealToDelivery:staff']

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Company Tests
// =============================================================================

describe('Companies API', () => {
  describe('createCompany', () => {
    it('should create a new company for the organization', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.mutation(api.workflows.dealToDelivery.api.companies.createCompany, {
        name: 'New Test Company',
        billingAddress: {
          street: '456 Market St',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94105',
          country: 'USA',
        },
        paymentTerms: 45,
      })

      expect(companyId).toBeDefined()

      // Verify company was created with correct fields
      const company = await t.run(async (ctx) => {
        return await ctx.db.get(companyId)
      })

      expect(company).not.toBeNull()
      expect(company?.name).toBe('New Test Company')
      expect(company?.organizationId).toBe(orgId)
      expect(company?.billingAddress.city).toBe('San Francisco')
      expect(company?.paymentTerms).toBe(45)
    })

    it('should default payment terms to 30 if not provided', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.mutation(api.workflows.dealToDelivery.api.companies.createCompany, {
        name: 'Company With Default Terms',
        billingAddress: {
          street: '789 Main St',
          city: 'Oakland',
          state: 'CA',
          postalCode: '94601',
          country: 'USA',
        },
      })

      const company = await t.run(async (ctx) => {
        return await ctx.db.get(companyId)
      })

      expect(company?.paymentTerms).toBe(30)
    })
  })

  describe('updateCompany', () => {
    it('should update company name', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // Create a company first
      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Original Company',
          billingAddress: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TC',
            postalCode: '12345',
            country: 'Testland',
          },
          paymentTerms: 30,
        })
      })

      // Update the company
      const result = await t.mutation(api.workflows.dealToDelivery.api.companies.updateCompany, {
        companyId,
        name: 'Updated Company Name',
      })

      expect(result.success).toBe(true)

      // Verify update
      const company = await t.run(async (ctx) => {
        return await ctx.db.get(companyId)
      })

      expect(company?.name).toBe('Updated Company Name')
      expect(company?.paymentTerms).toBe(30) // Unchanged
    })

    it('should update billing address', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: {
            street: '123 Old St',
            city: 'Old City',
            state: 'OC',
            postalCode: '11111',
            country: 'OldCountry',
          },
          paymentTerms: 30,
        })
      })

      await t.mutation(api.workflows.dealToDelivery.api.companies.updateCompany, {
        companyId,
        billingAddress: {
          street: '456 New St',
          city: 'New City',
          state: 'NC',
          postalCode: '22222',
          country: 'NewCountry',
        },
      })

      const company = await t.run(async (ctx) => {
        return await ctx.db.get(companyId)
      })

      expect(company?.billingAddress.street).toBe('456 New St')
      expect(company?.billingAddress.city).toBe('New City')
    })

    it('should throw error for non-existent company', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const fakeCompanyId = 'invalid_id' as Id<'companies'>

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.companies.updateCompany, {
          companyId: fakeCompanyId,
          name: 'New Name',
        })
      ).rejects.toThrow()
    })
  })

  describe('listCompanies', () => {
    it('should return companies for the organization', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // Create test companies
      await t.run(async (ctx) => {
        await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company A',
          billingAddress: { street: '1', city: 'A', state: 'A', postalCode: '1', country: 'A' },
          paymentTerms: 30,
        })
        await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company B',
          billingAddress: { street: '2', city: 'B', state: 'B', postalCode: '2', country: 'B' },
          paymentTerms: 30,
        })
      })

      const companies = await t.query(api.workflows.dealToDelivery.api.companies.listCompanies, {})

      expect(companies).toHaveLength(2)
    })
  })

  describe('getCompany', () => {
    it('should return company with contacts', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      // Create contacts for the company
      await t.run(async (ctx) => {
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId,
          name: 'Contact 1',
          email: 'c1@test.com',
          phone: '111',
          isPrimary: true,
        })
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId,
          name: 'Contact 2',
          email: 'c2@test.com',
          phone: '222',
          isPrimary: false,
        })
      })

      const result = await t.query(api.workflows.dealToDelivery.api.companies.getCompany, {
        companyId,
      })

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Test Company')
      expect(result?.contacts).toHaveLength(2)
    })
  })
})

// =============================================================================
// Contact Tests
// =============================================================================

describe('Contacts API', () => {
  describe('createContact', () => {
    it('should create a new contact for a company', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // Create a company first
      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const contactId = await t.mutation(api.workflows.dealToDelivery.api.companies.createContact, {
        companyId,
        name: 'Jane Smith',
        email: 'jane@test.com',
        phone: '+1-555-0199',
        isPrimary: true,
      })

      expect(contactId).toBeDefined()

      // Verify contact was created
      const contact = await t.run(async (ctx) => {
        return await ctx.db.get(contactId)
      })

      expect(contact?.name).toBe('Jane Smith')
      expect(contact?.email).toBe('jane@test.com')
      expect(contact?.companyId).toBe(companyId)
      expect(contact?.organizationId).toBe(orgId)
      expect(contact?.isPrimary).toBe(true)
    })

    it('should default isPrimary to false if not provided', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const contactId = await t.mutation(api.workflows.dealToDelivery.api.companies.createContact, {
        companyId,
        name: 'John Doe',
        email: 'john@test.com',
        phone: '+1-555-0100',
      })

      const contact = await t.run(async (ctx) => {
        return await ctx.db.get(contactId)
      })

      expect(contact?.isPrimary).toBe(false)
    })

    it('should throw error for non-existent company', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const fakeCompanyId = 'invalid_id' as Id<'companies'>

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.companies.createContact, {
          companyId: fakeCompanyId,
          name: 'Test Contact',
          email: 'test@test.com',
          phone: '555-0100',
        })
      ).rejects.toThrow()
    })
  })

  describe('updateContact', () => {
    it('should update contact fields', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const contactId = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId,
          name: 'Original Name',
          email: 'original@test.com',
          phone: '111',
          isPrimary: false,
        })
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.companies.updateContact, {
        contactId,
        name: 'Updated Name',
        email: 'updated@test.com',
        isPrimary: true,
      })

      expect(result.success).toBe(true)

      // Verify updates
      const contact = await t.run(async (ctx) => {
        return await ctx.db.get(contactId)
      })

      expect(contact?.name).toBe('Updated Name')
      expect(contact?.email).toBe('updated@test.com')
      expect(contact?.isPrimary).toBe(true)
      expect(contact?.phone).toBe('111') // Unchanged
    })

    it('should throw error for non-existent contact', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const fakeContactId = 'invalid_id' as Id<'contacts'>

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.companies.updateContact, {
          contactId: fakeContactId,
          name: 'New Name',
        })
      ).rejects.toThrow()
    })
  })

  describe('getContact', () => {
    it('should return contact by ID', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const companyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Test Company',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const contactId = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId,
          name: 'Test Contact',
          email: 'test@test.com',
          phone: '555-0100',
          isPrimary: true,
        })
      })

      const contact = await t.query(api.workflows.dealToDelivery.api.companies.getContact, {
        contactId,
      })

      expect(contact).not.toBeNull()
      expect(contact?.name).toBe('Test Contact')
      expect(contact?.email).toBe('test@test.com')
    })
  })

  describe('listContacts', () => {
    it('should return contacts filtered by company', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const company1 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company 1',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company 2',
          billingAddress: { street: '2', city: 'D', state: 'D', postalCode: '2', country: 'D' },
          paymentTerms: 30,
        })
      })

      // Create contacts for both companies
      await t.run(async (ctx) => {
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company1,
          name: 'Contact A',
          email: 'a@test.com',
          phone: '111',
          isPrimary: true,
        })
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company2,
          name: 'Contact B',
          email: 'b@test.com',
          phone: '222',
          isPrimary: true,
        })
      })

      // Filter by company1
      const contacts = await t.query(api.workflows.dealToDelivery.api.companies.listContacts, {
        companyId: company1,
      })

      expect(contacts).toHaveLength(1)
      expect(contacts[0].name).toBe('Contact A')
    })

    it('should return all contacts when no company filter', async () => {
      const t = setup()
      const { organizationId: orgId } = await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const company1 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company 1',
          billingAddress: { street: '1', city: 'C', state: 'C', postalCode: '1', country: 'C' },
          paymentTerms: 30,
        })
      })

      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company 2',
          billingAddress: { street: '2', city: 'D', state: 'D', postalCode: '2', country: 'D' },
          paymentTerms: 30,
        })
      })

      await t.run(async (ctx) => {
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company1,
          name: 'Contact A',
          email: 'a@test.com',
          phone: '111',
          isPrimary: true,
        })
        await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company2,
          name: 'Contact B',
          email: 'b@test.com',
          phone: '222',
          isPrimary: true,
        })
      })

      const contacts = await t.query(api.workflows.dealToDelivery.api.companies.listContacts, {})

      expect(contacts).toHaveLength(2)
    })
  })
})
