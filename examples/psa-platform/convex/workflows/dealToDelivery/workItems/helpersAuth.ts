/**
 * Authorization-specific work item helpers for the deal-to-delivery workflow.
 * Provides typed metadata initialization for work items with scope-based authorization.
 *
 * IMPORTANT: All work item metadata operations should go through these domain-layer functions,
 * NOT direct mutationCtx.db.* calls in work item files. This enforces TENET-DOMAIN-BOUNDARY.
 */
import type { MutationCtx } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { assertDealExists, assertProjectExists } from "../exceptions";
import { getDealByWorkflowId } from "../db/deals";
import { getProjectByWorkflowId } from "../db/projects";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { DataIntegrityError } from "@repo/tasquencer";

/**
 * Initializes typed deal-to-delivery work item metadata using auth scope-based authorization.
 * This provides full type safety with discriminated union payloads.
 *
 * Use this for work items that have a dealId at initialization time (most work items).
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The ID of the work item to initialize metadata for
 * @param config - Configuration object containing scope, optional group, deal ID, and typed payload
 */
export async function initializeDealWorkItemAuth(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  config: {
    scope: string;
    groupId?: string;
    dealId: Id<"deals">;
    payload: Doc<"dealToDeliveryWorkItems">["payload"];
  }
): Promise<Id<"dealToDeliveryWorkItems">> {
  return await mutationCtx.db.insert("dealToDeliveryWorkItems", {
    workItemId,
    workflowName: "dealToDelivery",
    offer: {
      type: "human" as const,
      requiredScope: config.scope,
      ...(config.groupId !== undefined && { requiredGroupId: config.groupId }),
    } as any,
    aggregateTableId: config.dealId,
    payload: config.payload,
  });
}

/**
 * Initializes work item metadata for root work items that create the aggregate (e.g., createDeal).
 * The aggregateTableId is set to a placeholder and should be updated after the aggregate is created.
 *
 * Use this for work items that don't have a dealId at initialization time (e.g., createDeal).
 * After creating the deal, call updateWorkItemAggregateTableId to set the dealId.
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The ID of the work item to initialize metadata for
 * @param config - Configuration object containing scope, optional group, and typed payload
 */
export async function initializeRootWorkItemAuth(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  config: {
    scope: string;
    groupId?: string;
    payload: Doc<"dealToDeliveryWorkItems">["payload"];
  }
): Promise<Id<"dealToDeliveryWorkItems">> {
  return await mutationCtx.db.insert("dealToDeliveryWorkItems", {
    workItemId,
    workflowName: "dealToDelivery",
    offer: {
      type: "human" as const,
      requiredScope: config.scope,
      ...(config.groupId !== undefined && { requiredGroupId: config.groupId }),
    } as any,
    aggregateTableId: "" as any, // Placeholder - will be updated after aggregate creation
    payload: config.payload,
  });
}

/**
 * Updates the aggregateTableId for a work item metadata record.
 * This is typically called after a root work item creates its aggregate (e.g., createDeal creates a deal).
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The work item ID whose metadata should be updated
 * @param aggregateTableId - The ID of the created aggregate (e.g., dealId)
 */
export async function updateWorkItemAggregateTableId(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  aggregateTableId: Id<"deals">
): Promise<void> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    throw new DataIntegrityError("WORK_ITEM_METADATA_MISSING", {
      workItemId,
      operation: "updateWorkItemAggregateTableId",
    });
  }
  await mutationCtx.db.patch(metadata._id, {
    aggregateTableId,
  });
}

/**
 * Updates the payload of a work item metadata record.
 * This allows enriching or modifying the payload after initialization.
 *
 * @param mutationCtx - The mutation context
 * @param workItemId - The work item ID whose metadata payload should be updated
 * @param payload - The new payload (fully replaces the old payload)
 */
export async function updateWorkItemMetadataPayload(
  mutationCtx: MutationCtx,
  workItemId: Id<"tasquencerWorkItems">,
  payload: Doc<"dealToDeliveryWorkItems">["payload"]
): Promise<void> {
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    mutationCtx.db,
    workItemId
  );
  if (!metadata) {
    throw new DataIntegrityError("WORK_ITEM_METADATA_MISSING", {
      workItemId,
      operation: "updateWorkItemMetadataPayload",
    });
  }
  await mutationCtx.db.patch(metadata._id, {
    payload,
  });
}

/**
 * Common pattern: Fetch deal from parent workflow and initialize work item.
 * Auth version that includes scope-based authorization.
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
export async function initializeWorkItemWithDealAuth(
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

/**
 * Common pattern: Fetch project from parent workflow and initialize work item.
 * Auth version that includes scope-based authorization.
 *
 * This is used by resource planning work items in their onEnabled handlers to:
 * 1. Get the project associated with the parent workflow
 * 2. Verify the project exists
 * 3. Initialize the work item with the project ID
 *
 * @param mutationCtx - The mutation context
 * @param parentWorkflow - The parent workflow containing the workflow ID
 * @param workItem - The work item to initialize
 * @returns The project document and work item ID
 */
export async function initializeWorkItemWithProjectAuth(
  mutationCtx: MutationCtx,
  parentWorkflow: { id: Id<"tasquencerWorkflows"> },
  workItem: {
    initialize: (payload: {
      projectId: Id<"projects">;
    }) => Promise<Id<"tasquencerWorkItems">>;
  }
): Promise<{
  project: Doc<"projects">;
  workItemId: Id<"tasquencerWorkItems">;
}> {
  const project = await getProjectByWorkflowId(
    mutationCtx.db,
    parentWorkflow.id
  );
  assertProjectExists(project, { workflowId: parentWorkflow.id });

  const workItemId = await workItem.initialize({ projectId: project._id });

  return { project, workItemId };
}
