/**
 * Deals API
 *
 * Domain-specific mutations and queries for the deals pipeline.
 * These wrap the workflow engine APIs with business logic.
 *
 * WORKFLOW-FIRST: UI actions that advance deal lifecycle MUST use these
 * mutations which complete work items via workflow APIs. Do not create
 * direct CRUD mutations that bypass the workflow engine.
 *
 * TENET-AUTHZ: All queries are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/03-workflow-sales-phase.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import { internal, components } from '../../../_generated/api'
import type { Id } from '../../../_generated/dataModel'
import { dealToDeliveryVersionManager } from '../definition'
import {
  requirePsaStaffMember,
  requireDealsCreateAccess,
} from '../domain/services/authorizationService'
import {
  getDeal as getDealFromDb,
  getDealByWorkflowId as getDealByWorkflowIdFromDb,
  listDealsByOrganization,
  listDealsByStage,
  listDealsByOwner,
  updateDeal as updateDealFromDb,
  updateDealStage as updateDealStageFromDb,
  type DealStage,
} from '../db/deals'
import { getUser } from '../db/users'
import { getCompany } from '../db/companies'
import { getSalesPhaseWorkflow } from '../db/workflows'
import { authComponent } from '../../../auth'

/** Deal stages that appear as pipeline columns */
export const PIPELINE_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

/** Enriched deal data for pipeline display */
export type DealWithDetails = {
  _id: Id<'deals'>
  name: string
  value: number
  stage: string
  probability: number
  createdAt: number
  workflowId: Id<'tasquencerWorkflows'> | null
  company: {
    _id: Id<'companies'>
    name: string
  } | null
  owner: {
    _id: Id<'users'>
    name: string
    email: string
  } | null
}

const {
  helpers: { getWorkflowTaskStates },
} = dealToDeliveryVersionManager.apiForVersion('v1')

/** Deal stage validator for filtering */
const dealStageValidator = v.union(
  v.literal('Lead'),
  v.literal('Qualified'),
  v.literal('Proposal'),
  v.literal('Negotiation'),
  v.literal('Won'),
  v.literal('Lost'),
  v.literal('Disqualified')
)

/**
 * Lists deals for the current user's organization with optional filtering.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.stage - Optional: Filter by deal stage
 * @param args.ownerId - Optional: Filter by deal owner
 * @param args.companyId - Optional: Filter by company
 * @param args.limit - Optional: Limit results (default 50, max 200)
 * @returns Array of deals
 */
export const listDeals = query({
  args: {
    stage: v.optional(dealStageValidator),
    ownerId: v.optional(v.id('users')),
    companyId: v.optional(v.id('companies')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization (via domain layer)
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return []
    }

    // Determine limit (capped at 200 for performance)
    const limit = Math.min(args.limit ?? 50, 200)

    // Apply filters based on args
    let deals

    if (args.stage) {
      // Filter by stage (uses index)
      deals = await listDealsByStage(ctx.db, user.organizationId, args.stage, limit)
    } else if (args.ownerId) {
      // Filter by owner (uses index)
      deals = await listDealsByOwner(ctx.db, args.ownerId, limit)
      // Secondary filter for organization (owner could have deals in multiple orgs)
      deals = deals.filter((d) => d.organizationId === user.organizationId)
    } else {
      // No filter - get all deals for organization
      deals = await listDealsByOrganization(ctx.db, user.organizationId, limit)
    }

    // Apply company filter if specified (post-query since no index)
    if (args.companyId) {
      deals = deals.filter((d) => d.companyId === args.companyId)
    }

    return deals
  },
})

/**
 * Lists deals with enriched company and owner details for pipeline display.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @returns Array of deals with company and owner details
 */
export const listDealsWithDetails = query({
  args: {},
  handler: async (ctx): Promise<DealWithDetails[]> => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return []
    }

    // Get raw deals
    const deals = await listDealsByOrganization(ctx.db, user.organizationId)

    // Enrich deals with company and owner details in parallel
    const enrichedDeals = await Promise.all(
      deals.map(async (deal) => {
        const [company, owner] = await Promise.all([
          getCompany(ctx.db, deal.companyId),
          getUser(ctx.db, deal.ownerId),
        ])

        return {
          _id: deal._id,
          name: deal.name,
          value: deal.value,
          stage: deal.stage,
          probability: deal.probability,
          createdAt: deal.createdAt,
          workflowId: deal.workflowId ?? null,
          company: company
            ? { _id: company._id, name: company.name }
            : null,
          owner: owner
            ? { _id: owner._id, name: owner.name, email: owner.email }
            : null,
        }
      })
    )

    return enrichedDeals
  },
})

/**
 * Gets pipeline stage summaries with total values and counts.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @returns Array of stage summaries
 */
export const getPipelineSummary = query({
  args: {},
  handler: async (ctx) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return PIPELINE_STAGES.map((stage) => ({
        stage,
        totalValue: 0,
        dealCount: 0,
      }))
    }

    // Get raw deals
    const deals = await listDealsByOrganization(ctx.db, user.organizationId, 500)

    // Calculate summaries for each pipeline stage
    return PIPELINE_STAGES.map((stage) => {
      const stageDeals = deals.filter((deal) => deal.stage === stage)
      return {
        stage,
        totalValue: stageDeals.reduce((sum, deal) => sum + deal.value, 0),
        dealCount: stageDeals.length,
      }
    })
  },
})

/**
 * Gets a deal by ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @returns The deal document or null
 */
export const getDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Use domain function for data access
    return await getDealFromDb(ctx.db, args.dealId)
  },
})

/**
 * Gets a deal by workflow ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.workflowId - The workflow ID
 * @returns The deal document or null
 */
export const getDealByWorkflowId = query({
  args: { workflowId: v.id('tasquencerWorkflows') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Use domain function for data access
    return await getDealByWorkflowIdFromDb(ctx.db, args.workflowId)
  },
})

/**
 * Creates a new deal by initializing the Deal to Delivery workflow.
 * This is the entry point for creating a new deal in the sales pipeline.
 *
 * The mutation:
 * 1. Initializes the workflow
 * 2. Initializes, starts, and completes the createDeal work item
 * 3. Creates the deal record in Lead stage
 *
 * Authorization: Requires dealToDelivery:deals:create scope.
 *
 * @param args.companyId - The company associated with this deal
 * @param args.contactId - The contact at the company
 * @param args.name - Name of the deal
 * @param args.value - Deal value in cents
 * @param args.ownerId - The user who owns this deal
 * @returns The workflow ID for the new deal workflow
 */
export const initializeDealToDelivery = mutation({
  args: {
    companyId: v.id('companies'),
    contactId: v.id('contacts'),
    name: v.string(),
    value: v.number(),
    ownerId: v.id('users'),
  },

  handler: async (ctx, args): Promise<Id<'tasquencerWorkflows'>> => {
    await requireDealsCreateAccess(ctx)

    // Get the user to determine the organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      throw new Error('User not found')
    }

    // Step 1: Initialize the root workflow
    const workflowId = await ctx.runMutation(
      internal.workflows.dealToDelivery.api.workflow.internalInitializeRootWorkflow,
      {
        payload: {},
      },
    )

    // Step 1.5: Resolve the sales phase workflow created by the composite task.
    // TENET-DOMAIN-BOUNDARY: Use domain helper for workflow resolution
    const salesWorkflow = await getSalesPhaseWorkflow(ctx.db, workflowId)

    // Step 2: Initialize the createDeal work item
    const workItemId = await ctx.runMutation(
      internal.workflows.dealToDelivery.api.workflow.internalInitializeWorkItem,
      {
        target: {
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflow._id,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      },
    )

    // Step 3: Start the createDeal work item
    await ctx.runMutation(
      internal.workflows.dealToDelivery.api.workflow.internalStartWorkItem,
      {
        workItemId,
        args: { name: 'createDeal' as const },
      },
    )

    // Step 4: Complete the createDeal work item with full payload
    await ctx.runMutation(
      internal.workflows.dealToDelivery.api.workflow.internalCompleteWorkItem,
      {
        workItemId,
        args: {
          name: 'createDeal' as const,
          payload: {
            organizationId: user.organizationId,
            companyId: args.companyId,
            contactId: args.contactId,
            name: args.name,
            value: args.value,
            ownerId: args.ownerId,
          },
        },
      },
    )

    return workflowId
  },
})

/**
 * Gets the workflow task states for a deal workflow.
 * Used by the UI to show workflow progress visualization.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.workflowId - The deal workflow ID
 * @returns Array of task states showing the workflow progress
 */
export const getDealWorkflowTaskStates = query({
  args: { workflowId: v.id('tasquencerWorkflows') },

  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await getWorkflowTaskStates(ctx.db, {
      workflowName: 'dealToDelivery',
      workflowId: args.workflowId,
    })
  },
})

/**
 * Updates a deal's non-workflow fields.
 * This is for updating deal metadata like name, value, notes.
 * IMPORTANT: Stage changes should go through workflow work items, not this mutation.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID to update
 * @param args.name - Optional: New deal name
 * @param args.value - Optional: New deal value in cents
 * @param args.notes - Optional: New deal notes
 * @param args.contactId - Optional: New contact ID
 * @param args.ownerId - Optional: New owner ID
 * @returns Success status
 */
export const updateDeal = mutation({
  args: {
    dealId: v.id('deals'),
    name: v.optional(v.string()),
    value: v.optional(v.number()),
    notes: v.optional(v.string()),
    contactId: v.optional(v.id('contacts')),
    ownerId: v.optional(v.id('users')),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requirePsaStaffMember(ctx)

    const deal = await getDealFromDb(ctx.db, args.dealId)
    if (!deal) {
      throw new Error(`Deal not found: ${args.dealId}`)
    }

    // Build updates object
    const updates: Record<string, unknown> = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.value !== undefined) updates.value = args.value
    if (args.notes !== undefined) updates.notes = args.notes
    if (args.contactId !== undefined) updates.contactId = args.contactId
    if (args.ownerId !== undefined) updates.ownerId = args.ownerId

    if (Object.keys(updates).length > 0) {
      await updateDealFromDb(ctx.db, args.dealId, updates)
    }

    return { success: true }
  },
})

/**
 * Stage to probability mapping.
 *
 * Per spec 03-workflow-sales-phase.md line 99 and line 389:
 * "Create deal with stage = 'Lead', probability = 10"
 * "Probability auto-updates with stage changes"
 *
 * Standard PSA platform probabilities based on pipeline stage:
 * - Lead: 10% - Initial contact, low confidence
 * - Qualified: 25% - BANT qualified, higher confidence
 * - Proposal: 50% - Proposal submitted, equal chance
 * - Negotiation: 75% - Active negotiation, high confidence
 * - Won: 100% - Deal closed successfully
 * - Lost: 0% - Deal lost
 * - Disqualified: 0% - Lead disqualified
 */
const STAGE_PROBABILITY: Record<DealStage, number> = {
  Lead: 10,
  Qualified: 25,
  Proposal: 50,
  Negotiation: 75,
  Won: 100,
  Lost: 0,
  Disqualified: 0,
}

/**
 * Updates a deal's stage with validation and auto-updates probability.
 *
 * This mutation validates stage transitions per spec 03-workflow-sales-phase.md lines 388-389:
 * - Stage progression must be sequential (Lead → Qualified → Proposal → Negotiation → Won/Lost)
 * - Probability auto-updates with stage changes
 *
 * TENET-WF-EXEC: For deals with active workflows, stage transitions should happen
 * through workflow work items (qualifyLead, createProposal, negotiateTerms, getProposalSigned).
 * This mutation enforces this by requiring `bypassWorkflowCheck: true` for deals with workflows.
 * See spec 03-workflow-sales-phase.md line 393: "Stage updates happen via work item completion."
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md lines 81-88
 *
 * @param args.dealId - The deal ID to update
 * @param args.stage - The new stage (must be a valid transition from current stage)
 * @param args.reason - Optional reason for stage change (useful for audit/notes)
 * @param args.bypassWorkflowCheck - Set to true to allow stage updates on deals with active workflows
 *                                   (admin override, use with caution - bypasses audit trail)
 * @returns Success status and the new probability
 */
export const updateDealStage = mutation({
  args: {
    dealId: v.id('deals'),
    stage: dealStageValidator,
    reason: v.optional(v.string()),
    bypassWorkflowCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; newProbability: number }> => {
    await requirePsaStaffMember(ctx)

    // Get the deal to validate it exists
    const deal = await getDealFromDb(ctx.db, args.dealId)
    if (!deal) {
      throw new Error(`Deal not found: ${args.dealId}`)
    }

    // TENET-WF-EXEC: Enforce workflow-driven stage transitions for deals with active workflows
    // Per spec 03-workflow-sales-phase.md line 393: "Stage updates happen via work item completion."
    if (deal.workflowId && !args.bypassWorkflowCheck) {
      throw new Error(
        `Deal ${args.dealId} has an active workflow (${deal.workflowId}). ` +
        `Stage transitions must happen through workflow work items (e.g., qualifyLead, createProposal, negotiateTerms, getProposalSigned) ` +
        `to maintain audit trail. Set bypassWorkflowCheck=true only for admin overrides.`
      )
    }

    // Get the new probability based on the target stage
    const newProbability = STAGE_PROBABILITY[args.stage as DealStage]

    // If already in the target stage, just return current state
    if (deal.stage === args.stage) {
      return { success: true, newProbability }
    }

    // Update the stage (this will validate the transition)
    await updateDealStageFromDb(ctx.db, args.dealId, args.stage as DealStage)

    // Update the probability to match the new stage
    await updateDealFromDb(ctx.db, args.dealId, {
      probability: newProbability,
    })

    return { success: true, newProbability }
  },
})

/** Work item history event type */
export type WorkItemHistoryEvent = {
  type: string
  description: string
  spanId: string
  timestamp: number
  workflowName?: string
}

/**
 * Gets work item history events for a deal's workflow.
 * Returns a timeline of all work item lifecycle events (initialized, started, completed, etc.).
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID to get history for
 * @param args.limit - Optional: Limit results (default 50, max 200)
 * @returns Array of work item history events sorted by timestamp (newest first)
 */
export const getWorkItemHistory = query({
  args: {
    dealId: v.id('deals'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<WorkItemHistoryEvent[]> => {
    await requirePsaStaffMember(ctx)

    // Get the deal to get its workflow ID
    const deal = await getDealFromDb(ctx.db, args.dealId)
    if (!deal?.workflowId) {
      return []
    }

    // Get all key events from the audit system
    const keyEvents = await ctx.runQuery(
      components.tasquencerAudit.api.getKeyEvents,
      { traceId: deal.workflowId },
    )

    // Filter to work item events only and map to our return type
    const workItemEvents = keyEvents
      .filter((event) => event.category === 'workItem')
      .map((event) => ({
        type: event.type,
        description: event.description,
        spanId: event.spanId,
        timestamp: event.timestamp,
        workflowName: event.workflowName,
      }))
      .sort((a, b) => b.timestamp - a.timestamp) // Newest first

    // Apply limit
    const limit = Math.min(args.limit ?? 50, 200)
    return workItemEvents.slice(0, limit)
  },
})
