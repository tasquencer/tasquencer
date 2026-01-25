/**
 * Parallel Task Mappings Database Functions
 *
 * Maps child workflow IDs to task IDs for the parallel execution pattern.
 * Used by dynamic composite tasks to pass taskId from parent to child workflow.
 */
import type { Id } from "../../../_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../../../_generated/server";

/**
 * Create a mapping between a child workflow and its target task.
 */
export async function insertParallelTaskMapping(
  db: DatabaseWriter,
  data: {
    workflowId: Id<"tasquencerWorkflows">;
    taskId: Id<"tasks">;
  }
): Promise<Id<"parallelTaskMappings">> {
  return await db.insert("parallelTaskMappings", {
    workflowId: data.workflowId,
    taskId: data.taskId,
    createdAt: Date.now(),
  });
}

/**
 * Get the task ID for a child workflow.
 */
export async function getParallelTaskMapping(
  db: DatabaseReader,
  workflowId: Id<"tasquencerWorkflows">
): Promise<{ taskId: Id<"tasks"> } | null> {
  const mapping = await db
    .query("parallelTaskMappings")
    .withIndex("by_workflowId", (q) => q.eq("workflowId", workflowId))
    .first();

  if (!mapping) {
    return null;
  }

  return { taskId: mapping.taskId };
}

/**
 * Delete the mapping for a workflow (cleanup after completion).
 */
export async function deleteParallelTaskMapping(
  db: DatabaseWriter,
  workflowId: Id<"tasquencerWorkflows">
): Promise<void> {
  const mapping = await db
    .query("parallelTaskMappings")
    .withIndex("by_workflowId", (q) => q.eq("workflowId", workflowId))
    .first();

  if (mapping) {
    await db.delete(mapping._id);
  }
}
