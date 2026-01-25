/**
 * Work item metadata helpers for the deal-to-delivery workflow.
 * Provides type-safe access to work item metadata operations for the dealToDeliveryWorkItems table.
 */
import { Authorization } from "../../tasquencer";

/**
 * Authorization helpers for DealToDelivery workflow work items.
 * Provides methods for:
 * - getWorkItemMetadata(db, workItemId) - Get typed metadata for a work item
 * - claimWorkItem(ctx, workItemId, userId) - Claim a work item for a user
 * - releaseWorkItem(ctx, workItemId) - Release a claimed work item
 * - listAvailableWorkItems(ctx, userId) - List unclaimed work items for a user
 * - listClaimedWorkItems(ctx, userId) - List work items claimed by a user
 */
export const DealToDeliveryWorkItemHelpers =
  Authorization.workItemMetadataHelpersForTable("dealToDeliveryWorkItems");
