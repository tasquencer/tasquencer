/**
 * Work item database access layer for the deal-to-delivery workflow.
 *
 * TENET-DOMAIN-BOUNDARY: Provides domain layer functions for accessing
 * work item data. API layer should use these functions instead of direct
 * ctx.db access.
 */
import type { DatabaseReader } from '../../../_generated/server'
import type { Doc, Id } from '../../../_generated/dataModel'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { isHumanOffer } from '@repo/tasquencer'

/**
 * Gets a work item document by ID.
 * This is the domain layer wrapper for fetching tasquencer work item state.
 */
export async function getWorkItem(
  db: DatabaseReader,
  workItemId: Id<'tasquencerWorkItems'>,
): Promise<Doc<'tasquencerWorkItems'> | null> {
  return await db.get(workItemId)
}

/**
 * Gets a work item with its metadata.
 * Returns both the work item document and the dealToDelivery metadata.
 */
export async function getWorkItemWithMetadata(
  db: DatabaseReader,
  workItemId: Id<'tasquencerWorkItems'>,
): Promise<{
  workItem: Doc<'tasquencerWorkItems'> | null
  metadata: Doc<'dealToDeliveryWorkItems'> | null
}> {
  const [workItem, metadata] = await Promise.all([
    db.get(workItemId),
    DealToDeliveryWorkItemHelpers.getWorkItemMetadata(db, workItemId),
  ])
  return { workItem, metadata }
}

/**
 * Lists all work item metadata records.
 * This is used for admin views that need to see all work items.
 */
export async function listAllWorkItemMetadata(
  db: DatabaseReader,
): Promise<Doc<'dealToDeliveryWorkItems'>[]> {
  return await db.query('dealToDeliveryWorkItems').collect()
}

/**
 * Lists all work item metadata with their work item documents.
 * Loads work items in parallel for efficiency.
 */
export async function listAllWorkItemsWithMetadata(
  db: DatabaseReader,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'> | null
  }>
> {
  const allMetadata = await listAllWorkItemMetadata(db)
  const workItems = await Promise.all(
    allMetadata.map((metadata) => db.get(metadata.workItemId)),
  )
  return allMetadata.map((metadata, idx) => ({
    metadata,
    workItem: workItems[idx],
  }))
}

/**
 * Type guard to check if an item has an active work item.
 */
function isActiveWorkItem(item: {
  metadata: Doc<'dealToDeliveryWorkItems'>
  workItem: Doc<'tasquencerWorkItems'> | null
}): item is {
  metadata: Doc<'dealToDeliveryWorkItems'>
  workItem: Doc<'tasquencerWorkItems'>
} {
  return (
    item.workItem !== null &&
    (item.workItem.state === 'initialized' || item.workItem.state === 'started')
  )
}

/**
 * Lists active (initialized or started) work items.
 * Filters out completed, failed, or canceled work items.
 */
export async function listActiveWorkItems(
  db: DatabaseReader,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'>
  }>
> {
  const allItems = await listAllWorkItemsWithMetadata(db)
  return allItems.filter(isActiveWorkItem)
}

/**
 * Lists active work items that are offered to humans.
 * Used for admin work queue views.
 */
export async function listActiveHumanWorkItems(
  db: DatabaseReader,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'>
  }>
> {
  const activeItems = await listActiveWorkItems(db)
  return activeItems.filter(({ metadata }) => isHumanOffer(metadata.offer))
}

/**
 * Lists work item metadata for a specific deal (by aggregate table ID).
 */
export async function listWorkItemMetadataByDeal(
  db: DatabaseReader,
  dealId: Id<'deals'>,
): Promise<Doc<'dealToDeliveryWorkItems'>[]> {
  return await db
    .query('dealToDeliveryWorkItems')
    .withIndex('by_aggregateTableId', (q) => q.eq('aggregateTableId', dealId))
    .collect()
}

/**
 * Lists work items with metadata for a specific deal.
 */
export async function listWorkItemsWithMetadataByDeal(
  db: DatabaseReader,
  dealId: Id<'deals'>,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'> | null
  }>
> {
  const allMetadata = await listWorkItemMetadataByDeal(db, dealId)
  const workItems = await Promise.all(
    allMetadata.map((metadata) => db.get(metadata.workItemId)),
  )
  return allMetadata.map((metadata, idx) => ({
    metadata,
    workItem: workItems[idx],
  }))
}

/**
 * Type guard to check if an item has an active human work item.
 */
function isActiveHumanWorkItem(item: {
  metadata: Doc<'dealToDeliveryWorkItems'>
  workItem: Doc<'tasquencerWorkItems'> | null
}): item is {
  metadata: Doc<'dealToDeliveryWorkItems'>
  workItem: Doc<'tasquencerWorkItems'>
} {
  return (
    item.workItem !== null &&
    isHumanOffer(item.metadata.offer) &&
    (item.workItem.state === 'initialized' || item.workItem.state === 'started')
  )
}

/**
 * Lists active human work items for a specific deal.
 */
export async function listActiveHumanWorkItemsByDeal(
  db: DatabaseReader,
  dealId: Id<'deals'>,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'>
  }>
> {
  const allItems = await listWorkItemsWithMetadataByDeal(db, dealId)
  return allItems.filter(isActiveHumanWorkItem)
}

/**
 * Gets claimed work items for a user that are still active (not completed/failed/canceled).
 * Uses the DealToDeliveryWorkItemHelpers.getClaimedWorkItemsByUser() function
 * and filters for active state.
 */
export async function listActiveClaimedWorkItemsForUser(
  db: DatabaseReader,
  userId: Id<'users'>,
): Promise<
  Array<{
    metadata: Doc<'dealToDeliveryWorkItems'>
    workItem: Doc<'tasquencerWorkItems'>
  }>
> {
  const claimedItems = await DealToDeliveryWorkItemHelpers.getClaimedWorkItemsByUser(
    db,
    userId,
  )
  // Reuse the isActiveWorkItem type guard
  return claimedItems.filter(isActiveWorkItem)
}
