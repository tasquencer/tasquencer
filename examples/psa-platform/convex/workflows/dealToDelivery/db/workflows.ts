/**
 * Workflow database access layer for the deal-to-delivery workflow.
 *
 * TENET-DOMAIN-BOUNDARY: Provides domain layer functions for accessing
 * workflow and task data from Tasquencer tables. API layer and workflow
 * activities should use these functions instead of direct db access.
 *
 * These helpers centralize invariants around workflow resolution, making
 * it easier to update query logic across the application.
 */
import type { DatabaseReader } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

/**
 * Gets the sales phase workflow for a root deal-to-delivery workflow.
 *
 * This resolves the nested salesPhase workflow that is created as a child
 * of the 'sales' composite task when the root workflow is initialized.
 *
 * @param db - Database reader
 * @param rootWorkflowId - The root deal-to-delivery workflow ID
 * @returns The sales phase workflow document
 * @throws EntityNotFoundError if the sales task or workflow is not found
 */
export async function getSalesPhaseWorkflow(
  db: DatabaseReader,
  rootWorkflowId: Id<"tasquencerWorkflows">
): Promise<Doc<"tasquencerWorkflows">> {
  // Step 1: Find the sales task for this workflow
  const salesTask = await db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q.eq("workflowId", rootWorkflowId).eq("name", "sales")
    )
    .order("desc")
    .first();

  if (!salesTask) {
    throw new EntityNotFoundError("Sales task", { rootWorkflowId });
  }

  // Step 2: Find the salesPhase workflow created by the sales composite task
  const salesWorkflow = await db
    .query("tasquencerWorkflows")
    .withIndex(
      "by_parent_workflow_id_task_name_task_generation_and_name",
      (q) =>
        q
          .eq("parent.workflowId", rootWorkflowId)
          .eq("parent.taskName", "sales")
          .eq("parent.taskGeneration", salesTask.generation)
          .eq("name", "salesPhase")
    )
    .first();

  if (!salesWorkflow) {
    throw new EntityNotFoundError("Sales phase workflow", {
      rootWorkflowId,
      salesTaskGeneration: salesTask.generation,
    });
  }

  return salesWorkflow;
}

/**
 * Lists work items by their parent workflow and task name.
 *
 * This is used to find work items associated with a specific task
 * in a workflow, useful for reading metadata from completed work items.
 *
 * TENET-ROUTING-DETERMINISM: Results are not sorted; callers should
 * sort by _creationTime descending when making routing decisions.
 *
 * @param db - Database reader
 * @param parentWorkflowId - The parent workflow ID
 * @param taskName - The task name to filter by
 * @returns Array of work item documents
 */
export async function listWorkItemsByParentTask(
  db: DatabaseReader,
  parentWorkflowId: Id<"tasquencerWorkflows">,
  taskName: string
): Promise<Doc<"tasquencerWorkItems">[]> {
  return await db
    .query("tasquencerWorkItems")
    .withIndex("by_parent_workflow_id_task_name_task_generation_and_state")
    .filter((q) =>
      q.and(
        q.eq(q.field("parent.workflowId"), parentWorkflowId),
        q.eq(q.field("parent.taskName"), taskName)
      )
    )
    .collect();
}

/**
 * Gets a task by workflow ID and name.
 *
 * Returns the most recent generation of the task.
 *
 * @param db - Database reader
 * @param workflowId - The workflow ID
 * @param taskName - The task name
 * @returns The task document or null if not found
 */
export async function getTaskByWorkflowAndName(
  db: DatabaseReader,
  workflowId: Id<"tasquencerWorkflows">,
  taskName: string
): Promise<Doc<"tasquencerTasks"> | null> {
  return await db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q.eq("workflowId", workflowId).eq("name", taskName)
    )
    .order("desc")
    .first();
}

/**
 * Gets a child workflow by parent workflow, task, and workflow name.
 *
 * @param db - Database reader
 * @param parentWorkflowId - The parent workflow ID
 * @param taskName - The task name
 * @param taskGeneration - The task generation
 * @param workflowName - The child workflow name
 * @returns The workflow document or null if not found
 */
export async function getChildWorkflow(
  db: DatabaseReader,
  parentWorkflowId: Id<"tasquencerWorkflows">,
  taskName: string,
  taskGeneration: number,
  workflowName: string
): Promise<Doc<"tasquencerWorkflows"> | null> {
  return await db
    .query("tasquencerWorkflows")
    .withIndex(
      "by_parent_workflow_id_task_name_task_generation_and_name",
      (q) =>
        q
          .eq("parent.workflowId", parentWorkflowId)
          .eq("parent.taskName", taskName)
          .eq("parent.taskGeneration", taskGeneration)
          .eq("name", workflowName)
    )
    .first();
}

/**
 * Gets the most recently completed work item for a specific task.
 *
 * This is used in route functions to read routing decisions stored
 * in work item metadata after task completion.
 *
 * TENET-ROUTING-DETERMINISM: Returns the most recent completed work item
 * sorted by _creationTime descending to ensure deterministic routing.
 *
 * @param db - Database reader
 * @param parentWorkflowId - The parent workflow ID
 * @param taskName - The task name to filter by
 * @returns The most recent completed work item or null if none found
 */
export async function getCompletedWorkItemByTask(
  db: DatabaseReader,
  parentWorkflowId: Id<"tasquencerWorkflows">,
  taskName: string
): Promise<Doc<"tasquencerWorkItems"> | null> {
  const workItems = await db
    .query("tasquencerWorkItems")
    .withIndex("by_parent_workflow_id_task_name_task_generation_and_state", (q) =>
      q
        .eq("parent.workflowId", parentWorkflowId)
        .eq("parent.taskName", taskName)
    )
    .filter((q) => q.eq(q.field("state"), "completed"))
    .collect();

  if (workItems.length === 0) {
    return null;
  }

  // Sort by _creationTime descending to get most recent
  workItems.sort((a, b) => b._creationTime - a._creationTime);
  return workItems[0];
}
