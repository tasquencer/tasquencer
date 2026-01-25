/**
 * Proposals API
 *
 * Domain-specific mutations and queries for proposals.
 * These provide helper functions for work item handlers and UI queries.
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/03-workflow-sales-phase.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getProposal as getProposalFromDb,
  insertProposal,
  updateProposal as updateProposalInDb,
  listProposalsByDeal as listProposalsByDealFromDb,
  getLatestProposalForDeal,
  getNextProposalVersion,
  markProposalSent as markProposalSentInDb,
  markProposalViewed as markProposalViewedInDb,
  markProposalSigned as markProposalSignedInDb,
  markProposalRejected as markProposalRejectedInDb,
} from '../db/proposals'
import { getDeal } from '../db/deals'

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Gets a proposal by ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.proposalId - The proposal ID
 * @returns The proposal document or null
 */
export const getProposal = query({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await getProposalFromDb(ctx.db, args.proposalId)
  },
})

/**
 * Lists all proposals for a deal.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @param args.limit - Maximum number of proposals to return (default 10)
 * @returns Array of proposal documents ordered by version descending
 */
export const listProposalsByDeal = query({
  args: {
    dealId: v.id('deals'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await listProposalsByDealFromDb(ctx.db, args.dealId, args.limit)
  },
})

/**
 * Gets the latest proposal version for a deal.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @returns The latest proposal document or null if no proposals exist
 */
export const getLatestProposal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await getLatestProposalForDeal(ctx.db, args.dealId)
  },
})

// =============================================================================
// MUTATIONS (Helper mutations for work item handlers)
// =============================================================================

/**
 * Creates a proposal for a deal.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers. The proposal version
 * is automatically calculated based on existing proposals for the deal.
 *
 * @param args.dealId - The deal ID
 * @param args.documentUrl - URL to the proposal document
 * @returns The new proposal ID
 */
export const createProposal = mutation({
  args: {
    dealId: v.id('deals'),
    documentUrl: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'proposals'>> => {
    await requirePsaStaffMember(ctx)

    // Get the deal to verify it exists and get organizationId
    const deal = await getDeal(ctx.db, args.dealId)
    if (!deal) {
      throw new Error(`Deal not found: ${args.dealId}`)
    }

    // Calculate the next version number
    const version = await getNextProposalVersion(ctx.db, args.dealId)

    // Create the proposal
    return await insertProposal(ctx.db, {
      organizationId: deal.organizationId,
      dealId: args.dealId,
      version,
      status: 'Draft',
      documentUrl: args.documentUrl,
      createdAt: Date.now(),
    })
  },
})

/**
 * Updates proposal content.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers.
 *
 * @param args.proposalId - The proposal ID
 * @param args.documentUrl - Optional new document URL
 */
export const updateProposal = mutation({
  args: {
    proposalId: v.id('proposals'),
    documentUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    const updates: { documentUrl?: string } = {}
    if (args.documentUrl !== undefined) {
      updates.documentUrl = args.documentUrl
    }

    if (Object.keys(updates).length > 0) {
      await updateProposalInDb(ctx.db, args.proposalId, updates)
    }
  },
})

/**
 * Marks a proposal as sent.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers.
 * Sets the status to 'Sent' and records the sentAt timestamp.
 *
 * @param args.proposalId - The proposal ID
 */
export const markProposalSent = mutation({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    await markProposalSentInDb(ctx.db, args.proposalId)
  },
})

/**
 * Marks a proposal as viewed.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers.
 * Sets the status to 'Viewed' and records the viewedAt timestamp.
 * If the proposal has already been viewed, this is a no-op.
 *
 * @param args.proposalId - The proposal ID
 */
export const markProposalViewed = mutation({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    await markProposalViewedInDb(ctx.db, args.proposalId)
  },
})

/**
 * Marks a proposal as signed.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers.
 * Sets the status to 'Signed' and records the signedAt timestamp.
 *
 * @param args.proposalId - The proposal ID
 */
export const markProposalSigned = mutation({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    await markProposalSignedInDb(ctx.db, args.proposalId)
  },
})

/**
 * Marks a proposal as rejected.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * This is a helper mutation for work item handlers.
 * Sets the status to 'Rejected' and records the rejectedAt timestamp.
 *
 * @param args.proposalId - The proposal ID
 */
export const markProposalRejected = mutation({
  args: { proposalId: v.id('proposals') },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    await markProposalRejectedInDb(ctx.db, args.proposalId)
  },
})
