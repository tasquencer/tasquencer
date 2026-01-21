/**
 * Work item lifecycle helpers for the deal-to-delivery workflow.
 * Provides common patterns for starting, claiming, and managing work items.
 *
 * This file contains:
 * - Work item lifecycle helpers (start, claim, cleanup)
 * - Typed payload extractors for discriminated union narrowing
 * - State transition helpers for deal stage management
 * - Batch work item completion utilities
 */
import type { MutationCtx, QueryCtx, DatabaseReader } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { authComponent } from "../../../auth";
import { assertAuthenticatedUser, assertDealExists } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import {
  getDeal,
  getDealByWorkflowId,
  updateDealStage,
} from "../db/deals";
import {
  getProject,
  getProjectByWorkflowId,
  updateProjectStatus,
} from "../db/projects";
import { ConstraintViolationError, DataIntegrityError } from "@repo/tasquencer";

/**
 * Helper function to authenticate, claim, and start a work item.
 * This encapsulates the common pattern used across all deal-to-delivery work items.
 *
 * @param mutationCtx - The mutation context
 * @param workItem - The work item handle with id and start method
 * @throws Error if user is not authenticated or claiming fails
 */
export async function startAndClaimWorkItem(
  mutationCtx: MutationCtx,
  workItem: { id: Id<"tasquencerWorkItems">; start: () => Promise<void> }
): Promise<void> {
  const authUser = await authComponent.safeGetAuthUser(mutationCtx);
  let userId = authUser?.userId as Id<"users"> | undefined;

  if (!userId) {
    const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
      mutationCtx.db,
      workItem.id
    );

    if (metadata?.aggregateTableId) {
      const deal = await getDeal(
        mutationCtx.db,
        metadata.aggregateTableId as Id<"deals">
      );
      userId = deal?.ownerId;
    }

    if (!userId) {
      const workItemDoc = await mutationCtx.db.get(workItem.id);
      if (workItemDoc) {
        const deal = await getDealByWorkflowId(
          mutationCtx.db,
          workItemDoc.parent.workflowId
        );
        userId = deal?.ownerId;
      }
    }

    if (!userId) {
      const workItemDoc = await mutationCtx.db.get(workItem.id);
      if (workItemDoc) {
        const project = await getProjectByWorkflowId(
          mutationCtx.db,
          workItemDoc.parent.workflowId
        );
        userId = project?.managerId;
      }
    }
  }

  if (!userId) {
    assertAuthenticatedUser(authUser, {
      operation: "startAndClaimWorkItem",
      workItemId: workItem.id,
    });
    userId = authUser.userId as Id<"users">;
  }
  try {
    await DealToDeliveryWorkItemHelpers.claimWorkItem(
      mutationCtx,
      workItem.id,
      userId
    );
  } catch (error) {
    if (error instanceof ConstraintViolationError) {
      throw error;
    }

    throw new ConstraintViolationError("WORK_ITEM_CLAIM_FAILED", {
      workItemId: workItem.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  // Claim and start run inside the same mutation transaction, so any throw rolls back both operations.
  await workItem.start();
}

/**
 * Common pattern: Fetch deal from parent workflow and initialize work item.
 *
 * This is used by most deal-to-delivery work items in their onEnabled handlers to:
 * 1. Get the deal associated with the parent workflow
 * 2. Verify the deal exists
 * 3. Initialize the work item with the deal ID
 *
 * @param mutationCtx - The mutation context
 * @param parentWorkflow - The parent workflow containing the workflow ID
 * @param workItem - The work item to initialize
 * @returns The deal document and work item ID
 */
export async function initializeWorkItemWithDeal(
  mutationCtx: MutationCtx,
  parentWorkflow: { id: Id<"tasquencerWorkflows"> },
  workItem: {
    initialize: (payload: {
      dealId: Id<"deals">;
    }) => Promise<Id<"tasquencerWorkItems">>;
  }
): Promise<{
  deal: Doc<"deals">;
  workItemId: Id<"tasquencerWorkItems">;
}> {
  const deal = await getDealByWorkflowId(
    mutationCtx.db,
    parentWorkflow.id
  );
  assertDealExists(deal, { workflowId: parentWorkflow.id });

  const workItemId = await workItem.initialize({ dealId: deal._id });

  return { deal, workItemId };
}

type DealStage = Doc<"deals">["stage"];

/**
 * Transition deal stage for a work item, storing previous stage in metadata for rollback.
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The work item ID
 * @param dealId - The deal ID to update
 * @param nextStage - The new stage to transition to
 */
export async function transitionDealStageForWorkItem(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  dealId: Id<"deals">,
  nextStage: DealStage
): Promise<void> {
  const deal = await getDeal(mutationCtx.db, dealId);
  assertDealExists(deal, { dealId });

  if (deal.stage === nextStage) {
    return;
  }

  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    throw new DataIntegrityError("WORK_ITEM_METADATA_MISSING", {
      workItemId,
    });
  }

  // Store previous stage for rollback
  // Use type assertion since not all payload types have previousStage in their union
  const payloadWithStage = metadata.payload as Record<string, unknown>;
  if (payloadWithStage.previousStage === undefined) {
    await mutationCtx.db.patch(metadata._id, {
      payload: {
        ...metadata.payload,
        previousStage: deal.stage,
      } as any, // Type assertion needed for discriminated union
    });
  }

  await updateDealStage(mutationCtx.db, dealId, nextStage);
}

/**
 * Revert deal stage to previous value stored in work item metadata.
 * Used during cancellation or failure to restore state.
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The work item ID
 * @param dealId - The deal ID to revert
 */
export async function revertDealStageForWorkItem(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  dealId: Id<"deals">
): Promise<void> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    return;
  }

  const payloadWithStage = metadata.payload as Record<string, unknown> & {
    previousStage?: DealStage;
  };
  const previousStage = payloadWithStage.previousStage;
  if (previousStage === undefined) {
    return;
  }

  const deal = await getDeal(mutationCtx.db, dealId);
  if (deal && deal.stage !== previousStage) {
    await updateDealStage(mutationCtx.db, dealId, previousStage);
  }

  const { previousStage: _ignored, ...restPayload } = payloadWithStage;
  await mutationCtx.db.patch(metadata._id, {
    payload: restPayload as Doc<"dealToDeliveryWorkItems">["payload"],
  });
}

/**
 * Clean up work item metadata on cancel or failure.
 * Reverts deal stage and deletes the metadata record.
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The work item ID to clean up
 */
export async function cleanupWorkItemOnCancel(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">
): Promise<void> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );

  if (metadata) {
    // Get deal ID from metadata's aggregate table reference
    const dealId = metadata.aggregateTableId as Id<"deals">;
    if (dealId) {
      await revertDealStageForWorkItem(mutationCtx, workItemId, dealId);
    }
    await mutationCtx.db.delete(metadata._id);
  }
}

// =============================================================================
// TYPED PAYLOAD EXTRACTORS
// =============================================================================
// These functions provide type-safe extraction and narrowing of work item payloads
// from the discriminated union. They verify the payload type and return a narrowed type.

type WorkItemPayload = Doc<"dealToDeliveryWorkItems">["payload"];

/** Type guard for payload type checking */
function isPayloadType<T extends WorkItemPayload["type"]>(
  payload: WorkItemPayload,
  type: T
): payload is Extract<WorkItemPayload, { type: T }> {
  return payload.type === type;
}

/**
 * Extracts and narrows a payload to a specific work item type.
 * Throws DataIntegrityError if the payload type doesn't match.
 *
 * @param metadata - The work item metadata record
 * @param expectedType - The expected payload type literal
 * @returns The narrowed payload
 */
export function extractTypedPayload<T extends WorkItemPayload["type"]>(
  metadata: Doc<"dealToDeliveryWorkItems">,
  expectedType: T
): Extract<WorkItemPayload, { type: T }> {
  if (!isPayloadType(metadata.payload, expectedType)) {
    throw new DataIntegrityError("PAYLOAD_TYPE_MISMATCH", {
      workItemId: metadata.workItemId,
      expected: expectedType,
      actual: metadata.payload.type,
    });
  }
  return metadata.payload;
}

/**
 * Safely extracts a typed payload, returning null if type doesn't match.
 * Useful for conditional payload handling without throwing errors.
 */
export function tryExtractTypedPayload<T extends WorkItemPayload["type"]>(
  metadata: Doc<"dealToDeliveryWorkItems">,
  expectedType: T
): Extract<WorkItemPayload, { type: T }> | null {
  if (isPayloadType(metadata.payload, expectedType)) {
    return metadata.payload;
  }
  return null;
}

/**
 * Gets work item metadata and extracts typed payload in one call.
 * Useful when you need to fetch metadata and verify payload type together.
 */
export async function getWorkItemWithTypedPayload<T extends WorkItemPayload["type"]>(
  db: DatabaseReader,
  workItemId: Id<"tasquencerWorkItems">,
  expectedType: T
): Promise<{
  metadata: Doc<"dealToDeliveryWorkItems">;
  payload: Extract<WorkItemPayload, { type: T }>;
}> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(db, workItemId);
  if (!metadata) {
    throw new DataIntegrityError("WORK_ITEM_METADATA_MISSING", {
      workItemId,
      operation: "getWorkItemWithTypedPayload",
    });
  }
  const payload = extractTypedPayload(metadata, expectedType);
  return { metadata, payload };
}

// =============================================================================
// BATCH WORK ITEM UTILITIES
// =============================================================================
// These functions provide utilities for working with multiple work items at once,
// useful for bulk operations like approval flows.

/**
 * Gets all work items for a deal by aggregate table ID.
 * Useful for finding all work items associated with a specific deal.
 */
export async function getWorkItemsForDeal(
  ctx: QueryCtx,
  dealId: Id<"deals">
): Promise<Doc<"dealToDeliveryWorkItems">[]> {
  return await ctx.db
    .query("dealToDeliveryWorkItems")
    .withIndex("by_aggregateTableId", (q) => q.eq("aggregateTableId", dealId))
    .collect();
}

/**
 * Gets all active (initialized or started) work items for a deal.
 * Filters out completed/failed/canceled work items.
 */
export async function getActiveWorkItemsForDeal(
  ctx: QueryCtx,
  dealId: Id<"deals">
): Promise<Array<{ metadata: Doc<"dealToDeliveryWorkItems">; workItem: Doc<"tasquencerWorkItems"> | null }>> {
  const allMetadata = await getWorkItemsForDeal(ctx, dealId);

  // Load work items in parallel
  const results = await Promise.all(
    allMetadata.map(async (metadata) => {
      const workItem = await ctx.db.get(metadata.workItemId);
      return { metadata, workItem };
    })
  );

  // Filter to active items (initialized or started)
  return results.filter(
    ({ workItem }) =>
      workItem?.state === "initialized" || workItem?.state === "started"
  );
}

/**
 * Gets work items by type for a deal.
 * Useful for finding specific types of work items (e.g., all timesheet approvals).
 */
export async function getWorkItemsByTypeForDeal<T extends WorkItemPayload["type"]>(
  ctx: QueryCtx,
  dealId: Id<"deals">,
  workItemType: T
): Promise<Array<{
  metadata: Doc<"dealToDeliveryWorkItems">;
  payload: Extract<WorkItemPayload, { type: T }>;
}>> {
  const allMetadata = await getWorkItemsForDeal(ctx, dealId);

  return allMetadata
    .filter((metadata) => metadata.payload.type === workItemType)
    .map((metadata) => ({
      metadata,
      payload: metadata.payload as Extract<WorkItemPayload, { type: T }>,
    }));
}

/**
 * Cleanup multiple work items at once.
 * Useful for bulk cancellation scenarios.
 */
export async function cleanupMultipleWorkItems(
  mutationCtx: MutationCtx,
  workItemIds: Id<"tasquencerWorkItems">[]
): Promise<{ cleaned: number; errors: Array<{ workItemId: Id<"tasquencerWorkItems">; error: string }> }> {
  const errors: Array<{ workItemId: Id<"tasquencerWorkItems">; error: string }> = [];
  let cleaned = 0;

  for (const workItemId of workItemIds) {
    try {
      await cleanupWorkItemOnCancel(mutationCtx, workItemId);
      cleaned++;
    } catch (error) {
      errors.push({
        workItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { cleaned, errors };
}

// =============================================================================
// PROJECT STATUS TRANSITION HELPERS
// =============================================================================
// Similar to deal stage helpers, but for project status transitions.

type ProjectStatus = Doc<"projects">["status"];

/**
 * Transition project status for a work item, storing previous status for rollback.
 */
export async function transitionProjectStatusForWorkItem(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  projectId: Id<"projects">,
  nextStatus: ProjectStatus
): Promise<void> {
  const project = await getProject(mutationCtx.db, projectId);
  if (!project) {
    throw new DataIntegrityError("PROJECT_NOT_FOUND", { projectId });
  }

  if (project.status === nextStatus) {
    return;
  }

  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    throw new DataIntegrityError("WORK_ITEM_METADATA_MISSING", {
      workItemId,
    });
  }

  // Store previous status for rollback if not already stored
  const payloadWithStatus = metadata.payload as Record<string, unknown>;
  if (payloadWithStatus.previousStatus === undefined) {
    await mutationCtx.db.patch(metadata._id, {
      payload: {
        ...metadata.payload,
        previousStatus: project.status,
      } as any,
    });
  }

  await updateProjectStatus(mutationCtx.db, projectId, nextStatus);
}

/**
 * Revert project status to previous value stored in work item metadata.
 */
export async function revertProjectStatusForWorkItem(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  projectId: Id<"projects">
): Promise<void> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    return;
  }

  const payloadWithStatus = metadata.payload as Record<string, unknown> & {
    previousStatus?: ProjectStatus;
  };
  const previousStatus = payloadWithStatus.previousStatus;
  if (previousStatus === undefined) {
    return;
  }

  const project = await getProject(mutationCtx.db, projectId);
  if (project && project.status !== previousStatus) {
    await updateProjectStatus(mutationCtx.db, projectId, previousStatus);
  }

  const { previousStatus: _ignored, ...restPayload } = payloadWithStatus;
  await mutationCtx.db.patch(metadata._id, {
    payload: restPayload as Doc<"dealToDeliveryWorkItems">["payload"],
  });
}
