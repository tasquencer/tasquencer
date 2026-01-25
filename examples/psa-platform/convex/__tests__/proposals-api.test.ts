/// <reference types="vite/client" />
/**
 * Proposals API Tests
 *
 * Tests for proposal CRUD operations and status lifecycle
 * via the API layer.
 *
 * Key test scenarios:
 * - Getting proposals by ID
 * - Listing proposals for a deal
 * - Getting latest proposal for a deal
 * - Creating proposals with auto-versioning
 * - Updating proposal content
 * - Status transitions: Draft → Sent → Viewed → Signed/Rejected
 * - Authorization checks
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 * Reference: .review/recipes/psa-platform/specs/03-workflow-sales-phase.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for proposal tests
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
 * Creates a contact (required for deal creation)
 */
async function createContact(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Test Contact',
      email: 'contact@example.com',
      phone: '555-1234',
      isPrimary: true,
    })
  })
}

/**
 * Creates a deal (required for proposal creation)
 */
async function createDeal(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Test Deal',
      value: 50000_00, // $50,000
      stage: 'Proposal',
      probability: 50,
      ownerId: userId,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates a company (required for deal creation)
 */
async function createCompany(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>
) {
  return await t.run(async (ctx) => {
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
}

/**
 * Creates company, contact, and deal in one helper (simplifies test setup)
 */
async function createTestDeal(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>
) {
  const companyId = await createCompany(t, orgId)
  const contactId = await createContact(t, orgId, companyId)
  const dealId = await createDeal(t, orgId, userId, companyId, contactId)
  return { companyId, contactId, dealId }
}

/**
 * Creates a proposal directly in the database (for testing queries)
 */
async function createProposalDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
  overrides: Partial<{
    version: number
    status: Doc<'proposals'>['status']
    documentUrl: string
    sentAt: number
    viewedAt: number
    signedAt: number
    rejectedAt: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('proposals', {
      organizationId: orgId,
      dealId,
      version: overrides.version ?? 1,
      status: overrides.status ?? 'Draft',
      documentUrl: overrides.documentUrl ?? 'https://example.com/proposal.pdf',
      sentAt: overrides.sentAt,
      viewedAt: overrides.viewedAt,
      signedAt: overrides.signedAt,
      rejectedAt: overrides.rejectedAt,
      createdAt: Date.now(),
    })
  })
}

/**
 * Gets a proposal directly from the database
 */
async function getProposalDirectly(
  t: ReturnType<typeof setup>,
  proposalId: Id<'proposals'>
) {
  return await t.run(async (ctx) => {
    return await ctx.db.get(proposalId)
  })
}

// =============================================================================
// getProposal Tests
// =============================================================================

describe('Proposals API', () => {
  describe('getProposal', () => {
    it('returns proposal by ID', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        version: 1,
        status: 'Draft',
        documentUrl: 'https://example.com/proposal-v1.pdf',
      })

      const proposal = await t.query(api.workflows.dealToDelivery.api.proposals.getProposal, {
        proposalId,
      })

      expect(proposal).not.toBeNull()
      expect(proposal!._id).toBe(proposalId)
      expect(proposal!.dealId).toBe(dealId)
      expect(proposal!.version).toBe(1)
      expect(proposal!.status).toBe('Draft')
      expect(proposal!.documentUrl).toBe('https://example.com/proposal-v1.pdf')
    })

    it('returns null for non-existent proposal', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      // Delete the proposal
      await t.run(async (ctx) => {
        await ctx.db.delete(proposalId)
      })

      const proposal = await t.query(api.workflows.dealToDelivery.api.proposals.getProposal, {
        proposalId,
      })

      expect(proposal).toBeNull()
    })

    it('returns proposal with all status timestamps', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      const now = Date.now()
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Signed',
        sentAt: now - 3 * 24 * 60 * 60 * 1000, // 3 days ago
        viewedAt: now - 2 * 24 * 60 * 60 * 1000, // 2 days ago
        signedAt: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
      })

      const proposal = await t.query(api.workflows.dealToDelivery.api.proposals.getProposal, {
        proposalId,
      })

      expect(proposal!.status).toBe('Signed')
      expect(proposal!.sentAt).toBeDefined()
      expect(proposal!.viewedAt).toBeDefined()
      expect(proposal!.signedAt).toBeDefined()
    })
  })

  // =============================================================================
  // listProposalsByDeal Tests
  // =============================================================================

  describe('listProposalsByDeal', () => {
    it('returns all proposals for a deal ordered by version', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Create multiple proposal versions
      await createProposalDirectly(t, organizationId, dealId, { version: 1, status: 'Rejected' })
      await createProposalDirectly(t, organizationId, dealId, { version: 2, status: 'Rejected' })
      await createProposalDirectly(t, organizationId, dealId, { version: 3, status: 'Draft' })

      const proposals = await t.query(api.workflows.dealToDelivery.api.proposals.listProposalsByDeal, {
        dealId,
      })

      expect(proposals).toHaveLength(3)
      // Should be ordered by version descending (newest first)
      expect(proposals[0].version).toBe(3)
      expect(proposals[1].version).toBe(2)
      expect(proposals[2].version).toBe(1)
    })

    it('respects limit parameter', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Create multiple proposals
      await createProposalDirectly(t, organizationId, dealId, { version: 1 })
      await createProposalDirectly(t, organizationId, dealId, { version: 2 })
      await createProposalDirectly(t, organizationId, dealId, { version: 3 })
      await createProposalDirectly(t, organizationId, dealId, { version: 4 })

      const proposals = await t.query(api.workflows.dealToDelivery.api.proposals.listProposalsByDeal, {
        dealId,
        limit: 2,
      })

      expect(proposals).toHaveLength(2)
      // Should return the 2 most recent
      expect(proposals[0].version).toBe(4)
      expect(proposals[1].version).toBe(3)
    })

    it('returns empty array when deal has no proposals', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      const proposals = await t.query(api.workflows.dealToDelivery.api.proposals.listProposalsByDeal, {
        dealId,
      })

      expect(proposals).toEqual([])
    })
  })

  // =============================================================================
  // getLatestProposal Tests
  // =============================================================================

  describe('getLatestProposal', () => {
    it('returns the highest version proposal for a deal', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      await createProposalDirectly(t, organizationId, dealId, { version: 1 })
      await createProposalDirectly(t, organizationId, dealId, { version: 2 })
      const latestId = await createProposalDirectly(t, organizationId, dealId, { version: 3 })

      const latest = await t.query(api.workflows.dealToDelivery.api.proposals.getLatestProposal, {
        dealId,
      })

      expect(latest).not.toBeNull()
      expect(latest!._id).toBe(latestId)
      expect(latest!.version).toBe(3)
    })

    it('returns null when deal has no proposals', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      const latest = await t.query(api.workflows.dealToDelivery.api.proposals.getLatestProposal, {
        dealId,
      })

      expect(latest).toBeNull()
    })
  })

  // =============================================================================
  // createProposal Tests
  // =============================================================================

  describe('createProposal', () => {
    it('creates proposal with version 1 for new deal', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      const proposalId = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/new-proposal.pdf',
      })

      expect(proposalId).toBeDefined()

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal).not.toBeNull()
      expect(proposal!.version).toBe(1)
      expect(proposal!.status).toBe('Draft')
      expect(proposal!.documentUrl).toBe('https://example.com/new-proposal.pdf')
    })

    it('auto-increments version for subsequent proposals', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Create first proposal
      await createProposalDirectly(t, organizationId, dealId, { version: 1 })

      // Create second proposal via API
      const proposalId = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/proposal-v2.pdf',
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.version).toBe(2)
    })

    it('creates proposals with correct version sequence', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Create multiple proposals
      const p1 = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/v1.pdf',
      })
      const p2 = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/v2.pdf',
      })
      const p3 = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/v3.pdf',
      })

      const proposal1 = await getProposalDirectly(t, p1)
      const proposal2 = await getProposalDirectly(t, p2)
      const proposal3 = await getProposalDirectly(t, p3)

      expect(proposal1!.version).toBe(1)
      expect(proposal2!.version).toBe(2)
      expect(proposal3!.version).toBe(3)
    })

    it('throws error for non-existent deal', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Delete the deal
      await t.run(async (ctx) => {
        await ctx.db.delete(dealId)
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
          dealId,
          documentUrl: 'https://example.com/proposal.pdf',
        })
      ).rejects.toThrow(/Deal not found/)
    })
  })

  // =============================================================================
  // updateProposal Tests
  // =============================================================================

  describe('updateProposal', () => {
    it('updates document URL', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        documentUrl: 'https://example.com/old-url.pdf',
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.updateProposal, {
        proposalId,
        documentUrl: 'https://example.com/new-url.pdf',
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.documentUrl).toBe('https://example.com/new-url.pdf')
    })

    it('does nothing when no updates provided', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        documentUrl: 'https://example.com/original.pdf',
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.updateProposal, {
        proposalId,
        // No documentUrl provided
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.documentUrl).toBe('https://example.com/original.pdf')
    })
  })

  // =============================================================================
  // markProposalSent Tests
  // =============================================================================

  describe('markProposalSent', () => {
    it('transitions status from Draft to Sent', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Draft',
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, {
        proposalId,
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Sent')
      expect(proposal!.sentAt).toBeDefined()
    })

    it('sets sentAt timestamp', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      const beforeSend = Date.now()
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, {
        proposalId,
      })
      const afterSend = Date.now()

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.sentAt).toBeGreaterThanOrEqual(beforeSend)
      expect(proposal!.sentAt).toBeLessThanOrEqual(afterSend)
    })
  })

  // =============================================================================
  // markProposalViewed Tests
  // =============================================================================

  describe('markProposalViewed', () => {
    it('transitions status from Sent to Viewed', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Sent',
        sentAt: Date.now(),
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalViewed, {
        proposalId,
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Viewed')
      expect(proposal!.viewedAt).toBeDefined()
    })

    it('sets viewedAt timestamp', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Sent',
        sentAt: Date.now(),
      })

      const beforeView = Date.now()
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalViewed, {
        proposalId,
      })
      const afterView = Date.now()

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.viewedAt).toBeGreaterThanOrEqual(beforeView)
      expect(proposal!.viewedAt).toBeLessThanOrEqual(afterView)
    })

    it('is idempotent when already viewed', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const originalViewedAt = Date.now() - 1000
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Viewed',
        sentAt: Date.now() - 2000,
        viewedAt: originalViewedAt,
      })

      // Call markProposalViewed again
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalViewed, {
        proposalId,
      })

      const proposal = await getProposalDirectly(t, proposalId)
      // Status should remain Viewed
      expect(proposal!.status).toBe('Viewed')
      // viewedAt should remain the original timestamp (idempotent)
      expect(proposal!.viewedAt).toBe(originalViewedAt)
    })
  })

  // =============================================================================
  // markProposalSigned Tests
  // =============================================================================

  describe('markProposalSigned', () => {
    it('transitions status to Signed', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Viewed',
        sentAt: Date.now() - 2000,
        viewedAt: Date.now() - 1000,
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSigned, {
        proposalId,
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Signed')
      expect(proposal!.signedAt).toBeDefined()
    })

    it('sets signedAt timestamp', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Viewed',
      })

      const beforeSign = Date.now()
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSigned, {
        proposalId,
      })
      const afterSign = Date.now()

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.signedAt).toBeGreaterThanOrEqual(beforeSign)
      expect(proposal!.signedAt).toBeLessThanOrEqual(afterSign)
    })
  })

  // =============================================================================
  // markProposalRejected Tests
  // =============================================================================

  describe('markProposalRejected', () => {
    it('transitions status to Rejected', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Viewed',
        sentAt: Date.now() - 2000,
        viewedAt: Date.now() - 1000,
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalRejected, {
        proposalId,
      })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Rejected')
      expect(proposal!.rejectedAt).toBeDefined()
    })

    it('sets rejectedAt timestamp', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId, {
        status: 'Sent',
      })

      const beforeReject = Date.now()
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalRejected, {
        proposalId,
      })
      const afterReject = Date.now()

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.rejectedAt).toBeGreaterThanOrEqual(beforeReject)
      expect(proposal!.rejectedAt).toBeLessThanOrEqual(afterReject)
    })
  })

  // =============================================================================
  // Proposal Lifecycle Tests
  // =============================================================================

  describe('Proposal Lifecycle', () => {
    it('supports complete lifecycle: Draft → Sent → Viewed → Signed', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // Create draft proposal
      const proposalId = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/proposal.pdf',
      })

      let proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Draft')

      // Send proposal
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, { proposalId })
      proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Sent')

      // Client views proposal
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalViewed, { proposalId })
      proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Viewed')

      // Client signs proposal
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSigned, { proposalId })
      proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Signed')
    })

    it('supports rejection: Draft → Sent → Rejected', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      const proposalId = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/proposal.pdf',
      })

      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, { proposalId })
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalRejected, { proposalId })

      const proposal = await getProposalDirectly(t, proposalId)
      expect(proposal!.status).toBe('Rejected')
    })

    it('supports revision flow: multiple proposal versions after rejection', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'staff',
        STAFF_SCOPES
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      // First proposal gets rejected
      const p1 = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/v1.pdf',
      })
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, { proposalId: p1 })
      await t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalRejected, { proposalId: p1 })

      // Create revision
      const p2 = await t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
        dealId,
        documentUrl: 'https://example.com/v2.pdf',
      })

      const proposal1 = await getProposalDirectly(t, p1)
      const proposal2 = await getProposalDirectly(t, p2)

      expect(proposal1!.version).toBe(1)
      expect(proposal1!.status).toBe('Rejected')
      expect(proposal2!.version).toBe(2)
      expect(proposal2!.status).toBe('Draft')
    })
  })

  // =============================================================================
  // Authorization Tests
  // =============================================================================

  describe('Authorization', () => {
    it('getProposal requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      await expect(
        t.query(api.workflows.dealToDelivery.api.proposals.getProposal, {
          proposalId,
        })
      ).rejects.toThrow()
    })

    it('listProposalsByDeal requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      await expect(
        t.query(api.workflows.dealToDelivery.api.proposals.listProposalsByDeal, {
          dealId,
        })
      ).rejects.toThrow()
    })

    it('createProposal requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.proposals.createProposal, {
          dealId,
          documentUrl: 'https://example.com/proposal.pdf',
        })
      ).rejects.toThrow()
    })

    it('markProposalSent requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSent, {
          proposalId,
        })
      ).rejects.toThrow()
    })

    it('markProposalSigned requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalSigned, {
          proposalId,
        })
      ).rejects.toThrow()
    })

    it('markProposalRejected requires staff scope', async () => {
      const t = setup()
      const { userId, organizationId } = await setupUserWithRole(
        t,
        'no-scope-role',
        [] // No scopes
      )

      const { dealId } = await createTestDeal(t, organizationId, userId)
      const proposalId = await createProposalDirectly(t, organizationId, dealId)

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.proposals.markProposalRejected, {
          proposalId,
        })
      ).rejects.toThrow()
    })
  })

  // =============================================================================
  // Cross-Organization Isolation Tests
  // =============================================================================

  describe('Cross-Organization Isolation', () => {
    it('proposals are associated with correct organization', async () => {
      const t = setup()

      // Create first organization with proposal
      const { userId: user1, organizationId: org1 } = await setupUserWithRole(
        t,
        'staff1',
        STAFF_SCOPES
      )
      const company1 = await createCompany(t, org1)
      const contact1 = await createContact(t, org1, company1)
      const deal1 = await createDeal(t, org1, user1, company1, contact1)
      const proposal1 = await createProposalDirectly(t, org1, deal1)

      // Create second organization
      const { organizationId: org2 } = await setupUserWithRole(
        t,
        'staff2',
        STAFF_SCOPES
      )

      // Verify proposal belongs to org1
      const proposal = await t.query(api.workflows.dealToDelivery.api.proposals.getProposal, {
        proposalId: proposal1,
      })

      expect(proposal!.organizationId).toBe(org1)
      expect(proposal!.organizationId).not.toBe(org2)
    })
  })
})
