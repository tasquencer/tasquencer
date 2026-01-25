/**
 * Work Items API
 *
 * Queries and mutations for discovering, claiming, and releasing work items
 * in the Deal to Delivery workflow. These enable the work queue UI and task
 * management features.
 *
 * TENET-AUTHZ: All endpoints are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: Uses work item helpers for metadata access.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 * Pattern: examples/er/convex/workflows/er/api/workItems.ts
 */
import { v } from 'convex/values'
import { query, mutation } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember, hasAdminAccess } from '../domain/services/authorizationService'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { authComponent } from '../../../auth'
import { isHumanOffer, isHumanClaim } from '@repo/tasquencer'
import {
  getProject,
  getProjectByDealId,
  getWorkItem,
  listActiveClaimedWorkItemsForUser,
  listActiveHumanWorkItems,
  listActiveHumanWorkItemsByDeal,
} from '../db'

/**
 * Maps work item metadata to a standardized response format.
 */
function mapWorkItemToResponse(
  metadata: NonNullable<
    Awaited<
      ReturnType<typeof DealToDeliveryWorkItemHelpers.getWorkItemMetadata>
    >
  >,
  workItem: { state: string; name: string } | null,
  options: {
    includeGroupName?: boolean
    includeWorkItemState?: boolean
    projectId?: Id<'projects'>
  } = {},
) {
  const payload = metadata.payload as { type?: string; taskName?: string }
  const taskName = payload.taskName ?? workItem?.name ?? 'Task'
  const taskType = payload.type ?? 'unknown'

  const baseResponse = {
    _id: metadata._id,
    _creationTime: metadata._creationTime,
    workItemId: metadata.workItemId,
    aggregateTableId: metadata.aggregateTableId,
    taskName,
    taskType,
    status: deriveWorkItemStatus(workItem, metadata),
    requiredScope: isHumanOffer(metadata.offer)
      ? metadata.offer.requiredScope
      : undefined,
    requiredGroupId: isHumanOffer(metadata.offer)
      ? metadata.offer.requiredGroupId
      : undefined,
    claimedBy: isHumanClaim(metadata.claim) ? metadata.claim.userId : undefined,
    payload: metadata.payload,
  }

  return {
    ...baseResponse,
    ...(options.includeWorkItemState && { workItemState: workItem?.state }),
    ...(options.projectId && { projectId: options.projectId }),
  }
}

async function getProjectIdsByDealId(
  db: Parameters<typeof getProjectByDealId>[0],
  dealIds: Array<Id<'deals'>>,
): Promise<Map<Id<'deals'>, Id<'projects'>>> {
  const uniqueDealIds = Array.from(new Set(dealIds))
  const entries = await Promise.all(
    uniqueDealIds.map(
      async (dealId): Promise<[Id<'deals'>, Id<'projects'>] | null> => {
        const project = await getProjectByDealId(db, dealId)
        return project ? [dealId, project._id] : null
      },
    ),
  )

  const projectByDealId = new Map<Id<'deals'>, Id<'projects'>>()
  for (const entry of entries) {
    if (entry) {
      projectByDealId.set(entry[0], entry[1])
    }
  }
  return projectByDealId
}

/**
 * Derives work item status from state and claim.
 */
function deriveWorkItemStatus(
  workItem: { state: string } | null,
  metadata: { claim?: unknown },
): 'pending' | 'claimed' | 'completed' {
  if (workItem?.state === 'completed') return 'completed'
  if (metadata.claim) return 'claimed'
  return 'pending'
}

/**
 * Gets all available work items for the current user.
 * Filters by user's roles and scopes.
 *
 * @returns Array of work items that the user can claim
 */
export const getMyAvailableTasks = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser || !authUser.userId) {
      return []
    }

    await requirePsaStaffMember(ctx)

    const userId = authUser.userId as Id<'users'>
    const items =
      await DealToDeliveryWorkItemHelpers.getAvailableWorkItemsForUser(
        ctx,
        userId,
      )

    const projectByDealId = await getProjectIdsByDealId(
      ctx.db,
      items.map((item) => item.metadata.aggregateTableId as Id<'deals'>),
    )

    return items.map((item) =>
      mapWorkItemToResponse(item.metadata, item.workItem, {
        projectId: projectByDealId.get(
          item.metadata.aggregateTableId as Id<'deals'>,
        ),
      }),
    )
  },
})

/**
 * Gets all work items claimed by the current user.
 *
 * @returns Array of work items that the user has claimed
 */
export const getMyClaimedTasks = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser || !authUser.userId) {
      return []
    }

    await requirePsaStaffMember(ctx)

    const userId = authUser.userId as Id<'users'>

    // Use domain layer function to get claimed work items
    const activeItems = await listActiveClaimedWorkItemsForUser(ctx.db, userId)

    const projectByDealId = await getProjectIdsByDealId(
      ctx.db,
      activeItems.map((item) => item.metadata.aggregateTableId as Id<'deals'>),
    )

    return activeItems.map(({ metadata, workItem }) =>
      mapWorkItemToResponse(metadata, workItem, {
        includeWorkItemState: true,
        projectId: projectByDealId.get(metadata.aggregateTableId as Id<'deals'>),
      }),
    )
  },
})

/**
 * Admin view: Gets ALL available work items across the system.
 * This bypasses role-based filtering for administrative dashboards.
 *
 * @returns Array of all active work items with group information
 */
export const getAllAvailableTasks = query({
  args: {},
  handler: async (ctx) => {
    await requirePsaStaffMember(ctx)

    // Use domain layer function to get active human work items
    const activeItems = await listActiveHumanWorkItems(ctx.db)

    const projectByDealId = await getProjectIdsByDealId(
      ctx.db,
      activeItems.map((item) => item.metadata.aggregateTableId as Id<'deals'>),
    )

    return activeItems.map(({ metadata, workItem }) =>
      mapWorkItemToResponse(metadata, workItem, {
        includeWorkItemState: true,
        projectId: projectByDealId.get(metadata.aggregateTableId as Id<'deals'>),
      }),
    )
  },
})

/**
 * Gets all work items for a specific deal.
 *
 * @param args.dealId - The deal to get work items for
 * @returns Array of work items associated with the deal
 */
export const getTasksByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Use domain layer function to get active human work items for the deal
    const activeItems = await listActiveHumanWorkItemsByDeal(ctx.db, args.dealId)

    return activeItems.map(({ metadata, workItem }) =>
      mapWorkItemToResponse(metadata, workItem, {
        includeWorkItemState: true,
      }),
    )
  },
})

/**
 * Gets all work items for a specific project.
 * Since work items are keyed by deal, this first looks up the project's deal.
 *
 * @param args.projectId - The project to get work items for
 * @returns Array of work items associated with the project (via its source deal)
 */
export const getTasksByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Projects are linked to deals; work items are keyed by deal
    const project = await getProject(ctx.db, args.projectId)
    if (!project || !project.dealId) {
      return []
    }

    // Use domain layer function to get active human work items for the deal
    const activeItems = await listActiveHumanWorkItemsByDeal(ctx.db, project.dealId)

    return activeItems.map(({ metadata, workItem }) =>
      mapWorkItemToResponse(metadata, workItem, {
        includeWorkItemState: true,
        projectId: args.projectId,
      }),
    )
  },
})

/**
 * Gets detailed metadata for a specific work item.
 *
 * @param args.workItemId - The work item to get metadata for
 * @returns Work item metadata with status and authorization info
 */
export const getWorkItemMetadataByWorkItemId = query({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
      ctx.db,
      args.workItemId,
    )
    if (!metadata) return null

    // Use domain layer function to get work item
    const workItem = await getWorkItem(ctx.db, args.workItemId)

    return mapWorkItemToResponse(metadata, workItem, {
      includeWorkItemState: true,
    })
  },
})

/**
 * Claims a work item for the current user.
 * The work item must be available (not already claimed) and the user must
 * have the required scope/group permissions.
 *
 * @param args.workItemId - The work item to claim
 * @returns The claimed work item metadata
 * @throws Error if work item is already claimed or user cannot claim it
 */
export const claimWorkItem = mutation({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser || !authUser.userId) {
      throw new Error('Not authenticated')
    }

    await requirePsaStaffMember(ctx)

    const userId = authUser.userId as Id<'users'>

    // Verify work item exists and is claimable
    const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
      ctx.db,
      args.workItemId,
    )
    if (!metadata) {
      throw new Error('Work item not found')
    }

    // Check if already claimed
    if (metadata.claim) {
      throw new Error('Work item is already claimed')
    }

    // Check if user can claim
    const canClaim = await DealToDeliveryWorkItemHelpers.canUserClaimWorkItem(
      ctx,
      userId,
      args.workItemId,
    )
    if (!canClaim) {
      throw new Error('You do not have permission to claim this work item')
    }

    // Claim the work item
    await DealToDeliveryWorkItemHelpers.claimWorkItem(ctx, args.workItemId, userId)

    // Return updated metadata
    const updatedMetadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
      ctx.db,
      args.workItemId,
    )
    // Use domain layer function to get work item
    const workItem = await getWorkItem(ctx.db, args.workItemId)

    return mapWorkItemToResponse(updatedMetadata!, workItem, {
      includeWorkItemState: true,
    })
  },
})

/**
 * Releases a previously claimed work item back to the available pool.
 * Only the user who claimed the work item (or an admin) can release it.
 *
 * @param args.workItemId - The work item to release
 * @returns Success status
 * @throws Error if work item is not claimed or user cannot release it
 */
export const releaseWorkItem = mutation({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser || !authUser.userId) {
      throw new Error('Not authenticated')
    }

    await requirePsaStaffMember(ctx)

    const userId = authUser.userId as Id<'users'>

    // Verify work item exists
    const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
      ctx.db,
      args.workItemId,
    )
    if (!metadata) {
      throw new Error('Work item not found')
    }

    // Check if claimed
    if (!metadata.claim) {
      throw new Error('Work item is not claimed')
    }

    // Check if claimed by current user or user has admin access
    const isClaimingUser = isHumanClaim(metadata.claim) && metadata.claim.userId === userId
    const isAdmin = await hasAdminAccess(ctx)

    if (!isClaimingUser && !isAdmin) {
      throw new Error('You can only release work items you have claimed (unless you are an admin)')
    }

    // Release the work item
    await DealToDeliveryWorkItemHelpers.releaseWorkItem(ctx.db, args.workItemId)

    return { success: true }
  },
})

/**
 * Checks if the current user can claim a specific work item.
 *
 * @param args.workItemId - The work item to check
 * @returns Boolean indicating if the user can claim
 */
export const canClaimWorkItem = query({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser || !authUser.userId) {
      return false
    }

    await requirePsaStaffMember(ctx)

    const userId = authUser.userId as Id<'users'>

    return DealToDeliveryWorkItemHelpers.canUserClaimWorkItem(
      ctx,
      userId,
      args.workItemId,
    )
  },
})

/**
 * Gets work item metadata by domain ID and task type.
 * Used for domain-first UI routing where routes use deal/project IDs
 * instead of workflow work item IDs.
 *
 * TENET-UI-DOMAIN: Supports domain-first UI navigation while keeping
 * workflow-driven execution via workItemId.
 *
 * TENET-ROUTING-DETERMINISM: When multiple work items of the same type exist
 * (e.g., in looped workflows), this selects the most recently created one
 * to avoid routing to stale work items.
 *
 * @param args.dealId - The deal ID (domain aggregate)
 * @param args.taskType - The work item type (e.g., "qualifyLead", "setBudget")
 * @returns Work item metadata if found and active, null otherwise
 */
export const getWorkItemByDealAndType = query({
  args: {
    dealId: v.id('deals'),
    taskType: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get all active human work items for this deal
    const activeItems = await listActiveHumanWorkItemsByDeal(ctx.db, args.dealId)

    // TENET-ROUTING-DETERMINISM: Filter matching items and sort by _creationTime
    // to select the most recently created one (for looped workflows with multiple
    // work items of the same type)
    const matchingItems = activeItems
      .filter(({ metadata }) => {
        const payload = metadata.payload as { type?: string }
        return payload.type === args.taskType
      })
      .sort((a, b) => b.metadata._creationTime - a.metadata._creationTime)

    const matchingItem = matchingItems[0]

    if (!matchingItem) return null

    const project = await getProjectByDealId(ctx.db, args.dealId)

    return mapWorkItemToResponse(matchingItem.metadata, matchingItem.workItem, {
      includeWorkItemState: true,
      projectId: project?._id,
    })
  },
})

/**
 * Gets work item metadata by project ID and task type.
 * Projects are linked to deals; this looks up the deal first then finds the task.
 *
 * TENET-UI-DOMAIN: Supports domain-first UI navigation for project-scoped tasks.
 *
 * TENET-ROUTING-DETERMINISM: When multiple work items of the same type exist
 * (e.g., in looped workflows), this selects the most recently created one
 * to avoid routing to stale work items.
 *
 * @param args.projectId - The project ID (domain aggregate)
 * @param args.taskType - The work item type (e.g., "setBudget", "closeProject")
 * @returns Work item metadata if found and active, null otherwise
 */
export const getWorkItemByProjectAndType = query({
  args: {
    projectId: v.id('projects'),
    taskType: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Projects are linked to deals; work items are keyed by deal
    const project = await getProject(ctx.db, args.projectId)
    if (!project || !project.dealId) {
      return null
    }

    // Get all active human work items for this project's deal
    const activeItems = await listActiveHumanWorkItemsByDeal(ctx.db, project.dealId)

    // TENET-ROUTING-DETERMINISM: Filter matching items and sort by _creationTime
    // to select the most recently created one (for looped workflows with multiple
    // work items of the same type)
    const matchingItems = activeItems
      .filter(({ metadata }) => {
        const payload = metadata.payload as { type?: string }
        return payload.type === args.taskType
      })
      .sort((a, b) => b.metadata._creationTime - a.metadata._creationTime)

    const matchingItem = matchingItems[0]

    if (!matchingItem) return null

    return mapWorkItemToResponse(matchingItem.metadata, matchingItem.workItem, {
      includeWorkItemState: true,
      projectId: args.projectId,
    })
  },
})
