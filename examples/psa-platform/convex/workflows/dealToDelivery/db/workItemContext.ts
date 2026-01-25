/**
 * Cross-cutting workflow context helpers for work items
 */
import type { DatabaseReader } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";
import { getDealByWorkflowId } from "./deals";
import { getProjectByWorkflowId } from "./projects";
import { helpers } from "../../../tasquencer";

/**
 * Get the root workflow ID and deal for a work item.
 * This is the primary way to access the aggregate root (deal) from any work item,
 * even in nested subworkflows.
 */
export async function getRootWorkflowAndDealForWorkItem(
  db: DatabaseReader,
  workItemId: Id<"tasquencerWorkItems">
): Promise<{
  rootWorkflowId: Id<"tasquencerWorkflows">;
  deal: Doc<"deals">;
}> {
  const rootWorkflowId = await helpers.getRootWorkflowIdForWorkItem(
    db,
    workItemId
  );
  const deal = await getDealByWorkflowId(db, rootWorkflowId);
  if (!deal) {
    throw new EntityNotFoundError("Deal", { workItemId, rootWorkflowId });
  }
  return { rootWorkflowId, deal };
}

/**
 * Get both current and root workflow IDs for a work item.
 * Useful when you need to track context at both levels.
 */
export async function getWorkflowIdsForWorkItem(
  db: DatabaseReader,
  workItemId: Id<"tasquencerWorkItems">
): Promise<{
  workflowId: Id<"tasquencerWorkflows">;
  rootWorkflowId: Id<"tasquencerWorkflows">;
}> {
  const [workflowId, rootWorkflowId] = await Promise.all([
    helpers.getWorkflowIdForWorkItem(db, workItemId),
    helpers.getRootWorkflowIdForWorkItem(db, workItemId),
  ]);
  return { workflowId, rootWorkflowId };
}

/**
 * Get the root workflow ID and project for a work item.
 * This is used in resource planning, execution, and billing phases
 * where the primary aggregate is the project.
 */
export async function getRootWorkflowAndProjectForWorkItem(
  db: DatabaseReader,
  workItemId: Id<"tasquencerWorkItems">
): Promise<{
  rootWorkflowId: Id<"tasquencerWorkflows">;
  project: Doc<"projects">;
}> {
  const rootWorkflowId = await helpers.getRootWorkflowIdForWorkItem(
    db,
    workItemId
  );
  const project = await getProjectByWorkflowId(db, rootWorkflowId);
  if (!project) {
    throw new EntityNotFoundError("Project", { workItemId, rootWorkflowId });
  }
  return { rootWorkflowId, project };
}
