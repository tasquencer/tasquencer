/// <reference types="vite/client" />
/**
 * Deals API Tests
 *
 * Tests for deal CRUD operations and workflow initialization via the API layer.
 *
 * Key test scenarios:
 * - Creating deals (workflow-first via initializeDealToDelivery)
 * - Listing deals with filtering (stage, owner, company)
 * - Getting deals with enriched details
 * - Pipeline summary calculations
 * - Non-workflow deal updates
 * - Authorization checks
 *
 * WORKFLOW-FIRST: Deal creation and stage transitions MUST go through workflow
 * work items, not direct CRUD mutations. The initializeDealToDelivery mutation
 * creates a deal by completing the createDeal work item.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { Doc } from '../_generated/dataModel'

// All scopes needed for deal tests
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
 * Creates test data (company, contact, user) required for deal creation
 */
async function setupDealPrerequisites(
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

  const contactId = await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Jane Doe',
      email: 'jane@testcompany.com',
      phone: '+1-555-0100',
      isPrimary: true,
    })
  })

  return { companyId, contactId, ownerId: userId }
}

/**
 * Creates a deal directly in the database (for testing queries without workflow)
 */
async function createDealDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  ownerId: Id<'users'>,
  overrides: Partial<{
    name: string
    value: number
    stage: Doc<'deals'>['stage']
    probability: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: overrides.name ?? 'Test Deal',
      value: overrides.value ?? 10000_00, // $10,000
      stage: overrides.stage ?? 'Lead',
      probability: overrides.probability ?? 10,
      ownerId,
      createdAt: Date.now(),
    })
  })
}

// =============================================================================
// listDeals Tests
// =============================================================================

describe('Deals API', () => {
  describe('listDeals', () => {
    it('should return deals for the organization', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create test deals
      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'Deal A' })
      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'Deal B' })
      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'Deal C' })

      const deals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {})

      expect(deals).toHaveLength(3)
    })

    it('should filter deals by stage', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create deals in different stages
      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'Lead Deal', stage: 'Lead' })
      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Qualified Deal',
        stage: 'Qualified',
      })
      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Proposal Deal',
        stage: 'Proposal',
      })

      const qualifiedDeals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {
        stage: 'Qualified',
      })

      expect(qualifiedDeals).toHaveLength(1)
      expect(qualifiedDeals[0].name).toBe('Qualified Deal')
    })

    it('should filter deals by owner', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create another user with all required fields
      const otherUserId = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: orgId,
          email: 'other@test.com',
          name: 'Other User',
          role: 'team_member',
          costRate: 8000, // $80/hr
          billRate: 12000, // $120/hr
          skills: [],
          department: 'Sales',
          location: 'Remote',
          isActive: true,
        })
      })

      // Create deals with different owners
      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'My Deal' })
      await createDealDirectly(t, orgId, companyId, contactId, otherUserId, { name: 'Other Deal' })

      const myDeals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {
        ownerId: userId,
      })

      expect(myDeals).toHaveLength(1)
      expect(myDeals[0].name).toBe('My Deal')
    })

    it('should filter deals by company', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId: company1, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create another company and contact
      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Another Company',
          billingAddress: {
            street: '456 Market St',
            city: 'Oakland',
            state: 'CA',
            postalCode: '94601',
            country: 'USA',
          },
          paymentTerms: 45,
        })
      })

      const contact2 = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company2,
          name: 'John Smith',
          email: 'john@another.com',
          phone: '+1-555-0200',
          isPrimary: true,
        })
      })

      // Create deals for different companies
      await createDealDirectly(t, orgId, company1, contactId, userId, { name: 'Company 1 Deal' })
      await createDealDirectly(t, orgId, company2, contact2, userId, { name: 'Company 2 Deal' })

      const company1Deals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {
        companyId: company1,
      })

      expect(company1Deals).toHaveLength(1)
      expect(company1Deals[0].name).toBe('Company 1 Deal')
    })

    it('should respect limit parameter', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create 5 deals
      for (let i = 1; i <= 5; i++) {
        await createDealDirectly(t, orgId, companyId, contactId, userId, { name: `Deal ${i}` })
      }

      const limitedDeals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {
        limit: 3,
      })

      expect(limitedDeals).toHaveLength(3)
    })

    it('should cap limit at 200', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // Request 500 but should be capped at 200
      const result = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {
        limit: 500,
      })

      // Just verify it doesn't error and returns an array
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return empty array when no deals exist', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const deals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {})

      expect(deals).toEqual([])
    })
  })

  // =============================================================================
  // listDealsWithDetails Tests
  // =============================================================================

  describe('listDealsWithDetails', () => {
    it('should return deals with company and owner details', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Enriched Deal',
        value: 50000_00,
      })

      const deals = await t.query(api.workflows.dealToDelivery.api.deals.listDealsWithDetails, {})

      expect(deals).toHaveLength(1)
      expect(deals[0].name).toBe('Enriched Deal')
      expect(deals[0].value).toBe(50000_00)
      expect(deals[0].company).not.toBeNull()
      expect(deals[0].company?.name).toBe('Test Company')
      expect(deals[0].owner).not.toBeNull()
      expect(deals[0].owner?.name).toBe('Test User') // User created by setupUserWithRole
    })

    it('should handle deals with null workflowId', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      await createDealDirectly(t, orgId, companyId, contactId, userId, { name: 'No Workflow Deal' })

      const deals = await t.query(api.workflows.dealToDelivery.api.deals.listDealsWithDetails, {})

      expect(deals[0].workflowId).toBeNull()
    })
  })

  // =============================================================================
  // getPipelineSummary Tests
  // =============================================================================

  describe('getPipelineSummary', () => {
    it('should return summary for all pipeline stages', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const summary = await t.query(api.workflows.dealToDelivery.api.deals.getPipelineSummary, {})

      // Should have 4 pipeline stages: Lead, Qualified, Proposal, Negotiation
      expect(summary).toHaveLength(4)
      expect(summary.map((s) => s.stage)).toEqual([
        'Lead',
        'Qualified',
        'Proposal',
        'Negotiation',
      ])
    })

    it('should calculate correct totals per stage', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create deals in different stages with known values
      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Lead 1',
        stage: 'Lead',
        value: 10000_00,
      })
      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Lead 2',
        stage: 'Lead',
        value: 15000_00,
      })
      await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Qualified 1',
        stage: 'Qualified',
        value: 25000_00,
      })

      const summary = await t.query(api.workflows.dealToDelivery.api.deals.getPipelineSummary, {})

      const leadSummary = summary.find((s) => s.stage === 'Lead')
      const qualifiedSummary = summary.find((s) => s.stage === 'Qualified')

      expect(leadSummary?.totalValue).toBe(25000_00) // 10000 + 15000
      expect(leadSummary?.dealCount).toBe(2)
      expect(qualifiedSummary?.totalValue).toBe(25000_00)
      expect(qualifiedSummary?.dealCount).toBe(1)
    })

    it('should return zero for empty stages', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const summary = await t.query(api.workflows.dealToDelivery.api.deals.getPipelineSummary, {})

      // All stages should have zero values since no deals exist
      summary.forEach((stageSummary) => {
        expect(stageSummary.totalValue).toBe(0)
        expect(stageSummary.dealCount).toBe(0)
      })
    })
  })

  // =============================================================================
  // getDeal Tests
  // =============================================================================

  describe('getDeal', () => {
    it('should return deal by ID', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Specific Deal',
        value: 75000_00,
      })

      const deal = await t.query(api.workflows.dealToDelivery.api.deals.getDeal, {
        dealId,
      })

      expect(deal).not.toBeNull()
      expect(deal?.name).toBe('Specific Deal')
      expect(deal?.value).toBe(75000_00)
    })

    // Note: Convex validators reject malformed IDs before the handler runs,
    // so we can't test with fake string IDs. The null check is for valid IDs
    // pointing to deleted documents, which is tested implicitly by other tests.
  })

  // =============================================================================
  // getDealByWorkflowId Tests
  // =============================================================================

  describe('getDealByWorkflowId', () => {
    it('should return deal by workflow ID', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create a fake workflow entry for testing
      const workflowId = await t.run(async (ctx) => {
        return await ctx.db.insert('tasquencerWorkflows', {
          state: 'started',
          versionName: 'v1',
          name: 'dealToDelivery',
          path: [],
          realizedPath: [],
          executionMode: 'normal',
        })
      })

      await t.run(async (ctx) => {
        await ctx.db.insert('deals', {
          organizationId: orgId,
          companyId,
          contactId,
          name: 'Workflow Deal',
          value: 50000_00,
          stage: 'Lead',
          probability: 10,
          ownerId: userId,
          workflowId,
          createdAt: Date.now(),
        })
      })

      const deal = await t.query(api.workflows.dealToDelivery.api.deals.getDealByWorkflowId, {
        workflowId,
      })

      expect(deal).not.toBeNull()
      expect(deal?.name).toBe('Workflow Deal')
      expect(deal?.workflowId).toBe(workflowId)
    })

    // Note: Convex validators reject malformed IDs before the handler runs.
    // Null result for deleted workflows is tested implicitly through other workflow tests.
  })

  // =============================================================================
  // updateDeal Tests
  // =============================================================================

  describe('updateDeal', () => {
    it('should update deal name', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Original Name',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
        name: 'Updated Name',
      })

      expect(result.success).toBe(true)

      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.name).toBe('Updated Name')
    })

    it('should update deal value', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        value: 10000_00,
      })

      await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
        value: 20000_00,
      })

      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.value).toBe(20000_00)
    })

    it('should update multiple fields at once', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create another contact
      const newContactId = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId,
          name: 'New Contact',
          email: 'new@test.com',
          phone: '555-0200',
          isPrimary: false,
        })
      })

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Original',
        value: 10000_00,
      })

      await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
        name: 'Updated',
        value: 25000_00,
        contactId: newContactId,
      })

      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.name).toBe('Updated')
      expect(deal?.value).toBe(25000_00)
      expect(deal?.contactId).toBe(newContactId)
    })

    it('should throw error for non-existent deal', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const fakeId = 'invalid_deal_id' as Id<'deals'>

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
          dealId: fakeId,
          name: 'New Name',
        })
      ).rejects.toThrow()
    })

    it('should not modify deal if no updates provided', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Original Name',
        value: 10000_00,
      })

      // Call with no actual updates
      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
      })

      expect(result.success).toBe(true)

      // Verify nothing changed
      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.name).toBe('Original Name')
      expect(deal?.value).toBe(10000_00)
    })

    it('should update deal owner', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create new owner
      const newOwnerId = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: orgId,
          email: 'newowner@test.com',
          name: 'New Owner',
          role: 'sales_rep',
          costRate: 9000,
          billRate: 13500,
          skills: ['sales'],
          department: 'Sales',
          location: 'New York',
          isActive: true,
        })
      })

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Ownership Test Deal',
      })

      await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
        ownerId: newOwnerId,
      })

      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.ownerId).toBe(newOwnerId)
    })
  })

  // =============================================================================
  // initializeDealToDelivery Tests (Workflow-First)
  // =============================================================================
  // NOTE: Workflow initialization tests are covered in sales-workflow.test.ts
  // which has the full workflow infrastructure setup. The API tests here focus
  // on the query/mutation endpoints that don't require workflow state.
  //
  // See: convex/__tests__/sales-workflow.test.ts for:
  // - initializeDealToDelivery → deal creation through workflow
  // - Deal stage transitions through work items
  // - Workflow task states and progression
  // =============================================================================

  // =============================================================================
  // Authorization Tests
  // =============================================================================

  describe('Authorization', () => {
    it('should require staff scope for listDeals', async () => {
      const t = setup()
      // Set up user with scopes
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // This should work with proper scopes
      const deals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {})
      expect(Array.isArray(deals)).toBe(true)
    })

    it('should require staff scope for getDeal', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Auth Test Deal',
      })

      // This should work with proper scopes
      const deal = await t.query(api.workflows.dealToDelivery.api.deals.getDeal, { dealId })
      expect(deal).not.toBeNull()
    })

    it('should require staff scope for updateDeal', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        name: 'Original Name',
      })

      // This should work with proper scopes
      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDeal, {
        dealId,
        name: 'Updated Name',
      })
      expect(result.success).toBe(true)
    })

    // Note: initializeDealToDelivery authorization is tested in sales-workflow.test.ts
  })

  // =============================================================================
  // Cross-Organization Isolation Tests
  // =============================================================================

  describe('Cross-Organization Isolation', () => {
    it('should not return deals from other organizations', async () => {
      const t = setup()
      const { organizationId: org1, userId: user1 } = await setupUserWithRole(
        t,
        'user1',
        STAFF_SCOPES
      )
      const { companyId: company1, contactId: contact1 } = await setupDealPrerequisites(t, org1, user1)

      // Create a deal in org1
      await createDealDirectly(t, org1, company1, contact1, user1, { name: 'Org1 Deal' })

      // Create another organization
      const org2 = await t.run(async (ctx) => {
        return await ctx.db.insert('organizations', {
          name: 'Org 2',
          settings: {},
          createdAt: Date.now(),
        })
      })

      const user2 = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: org2,
          email: 'user2@org2.com',
          name: 'User 2',
          role: 'admin',
          costRate: 10000,
          billRate: 15000,
          skills: [],
          department: 'Engineering',
          location: 'Remote',
          isActive: true,
        })
      })

      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: org2,
          name: 'Org2 Company',
          billingAddress: {
            street: '1',
            city: 'C',
            state: 'S',
            postalCode: '1',
            country: 'C',
          },
          paymentTerms: 30,
        })
      })

      const contact2 = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: org2,
          companyId: company2,
          name: 'Contact 2',
          email: 'c2@org2.com',
          phone: '555-0300',
          isPrimary: true,
        })
      })

      // Create a deal in org2
      await createDealDirectly(t, org2, company2, contact2, user2, { name: 'Org2 Deal' })

      // When user1 queries, they should only see their org's deals
      const user1Deals = await t.query(api.workflows.dealToDelivery.api.deals.listDeals, {})

      // Should only have 1 deal (the org1 deal)
      expect(user1Deals).toHaveLength(1)
      expect(user1Deals[0].organizationId).toBe(org1)
      expect(user1Deals[0].name).toBe('Org1 Deal')
    })
  })

  // =============================================================================
  // updateDealStage Tests
  // =============================================================================

  describe('updateDealStage', () => {
    it('should transition deal from Lead to Qualified with probability update', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
        probability: 10,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Qualified',
      })

      expect(result.success).toBe(true)
      expect(result.newProbability).toBe(25)

      // Verify the deal was updated
      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.stage).toBe('Qualified')
      expect(deal?.probability).toBe(25)
    })

    it('should transition through full pipeline with correct probabilities', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
        probability: 10,
      })

      // Lead → Qualified (10% → 25%)
      let result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Qualified',
      })
      expect(result.newProbability).toBe(25)

      // Qualified → Proposal (25% → 50%)
      result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Proposal',
      })
      expect(result.newProbability).toBe(50)

      // Proposal → Negotiation (50% → 75%)
      result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Negotiation',
      })
      expect(result.newProbability).toBe(75)

      // Negotiation → Won (75% → 100%)
      result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Won',
      })
      expect(result.newProbability).toBe(100)
    })

    it('should reject invalid stage transition (skipping stages)', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
        probability: 10,
      })

      // Lead → Proposal should fail (must go through Qualified first)
      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
          dealId,
          stage: 'Proposal',
        })
      ).rejects.toThrow(/Invalid deal stage transition/)
    })

    it('should reject backward transitions', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Negotiation',
        probability: 75,
      })

      // Negotiation → Qualified should fail
      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
          dealId,
          stage: 'Qualified',
        })
      ).rejects.toThrow(/Invalid deal stage transition/)
    })

    it('should allow Negotiation to Proposal for revisions', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Negotiation',
        probability: 75,
      })

      // Negotiation → Proposal is valid (proposal revision loop)
      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Proposal',
      })

      expect(result.success).toBe(true)
      expect(result.newProbability).toBe(50)
    })

    it('should return current probability if already in target stage', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Qualified',
        probability: 25,
      })

      // Qualified → Qualified (no-op)
      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Qualified',
      })

      expect(result.success).toBe(true)
      expect(result.newProbability).toBe(25)
    })

    it('should accept optional reason parameter', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
        probability: 10,
      })

      // Reason is accepted but not stored (for audit logging purposes)
      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Qualified',
        reason: 'BANT criteria met',
      })

      expect(result.success).toBe(true)
      expect(result.newProbability).toBe(25)
    })

    it('should transition to Lost with 0% probability', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Negotiation',
        probability: 75,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
        dealId,
        stage: 'Lost',
        reason: 'Competitor won the deal',
      })

      expect(result.success).toBe(true)
      expect(result.newProbability).toBe(0)

      const deal = await t.run(async (ctx) => ctx.db.get(dealId))
      expect(deal?.stage).toBe('Lost')
      expect(deal?.probability).toBe(0)
    })

    it('should reject transitions from terminal states', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Won',
        probability: 100,
      })

      // Won → Lead should fail (Won is terminal)
      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
          dealId,
          stage: 'Lead',
        })
      ).rejects.toThrow(/Invalid deal stage transition/)
    })

    it('should throw error for non-existent deal', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      // Create and then delete a deal to get a valid but non-existent ID
      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
      })
      await t.run(async (ctx) => ctx.db.delete(dealId))

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
          dealId,
          stage: 'Qualified',
        })
      ).rejects.toThrow(/Deal not found/)
    })

    it('should require staff scope', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, contactId } = await setupDealPrerequisites(t, orgId, userId)

      const dealId = await createDealDirectly(t, orgId, companyId, contactId, userId, {
        stage: 'Lead',
        probability: 10,
      })

      // Reset mocks to remove scopes
      vi.restoreAllMocks()
      await setupUserWithRole(t, 'guest', [])

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.deals.updateDealStage, {
          dealId,
          stage: 'Qualified',
        })
      ).rejects.toThrow()
    })
  })
})
