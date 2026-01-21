/**
 * ExecuteTask Work Item
 *
 * Marks a task as in progress and begins execution.
 * Part of the sequential execution workflow pattern.
 *
 * Entry condition: Task identified by getNextTask
 * Exit condition: Task status = "InProgress"
 *
 * Reference: Internal scaffolder pattern - sequential execution
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getTask, listTasksByProject, updateTask } from "../db/tasks";
import { getProject, getProjectByWorkflowId } from "../db/projects";
import { getDeal } from "../db/deals";
import { getCompletedWorkItemByTask } from "../db/workflows";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { assertTaskExists, assertProjectExists, assertDealExists } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:tasks:edit:own' scope
const tasksEditPolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:edit:own"
);

/**
 * Actions for the executeTask work item.
 *
 * - initialize: Sets up work item metadata with task context
 * - start: Claims the work item for the current user
 * - complete: Marks task as in progress
 * - fail: Marks the work item as failed
 */
const executeTaskWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      taskId: zid("tasks"),
    }),
    tasksEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const task = await getTask(mutationCtx.db, payload.taskId);
      assertTaskExists(task, { taskId: payload.taskId });

      const project = await getProject(mutationCtx.db, task.projectId);
      assertProjectExists(project, { projectId: task.projectId });

      const deal = await getDeal(mutationCtx.db, project.dealId!);
      assertDealExists(deal, { dealId: project.dealId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:tasks:edit:own",
        dealId: deal._id,
        payload: {
          type: "executeTask",
          taskName: `Execute: ${task.name}`,
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), tasksEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      taskId: zid("tasks"),
    }),
    tasksEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const task = await getTask(mutationCtx.db, payload.taskId);
      assertTaskExists(task, { taskId: payload.taskId });

      // Mark task as in progress
      if (task.status === "Todo") {
        await updateTask(mutationCtx.db, task._id, {
          status: "InProgress",
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The executeTask work item with actions and lifecycle activities.
 */
export const executeTaskWorkItem = Builder.workItem("executeTask")
  .withActions(executeTaskWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The executeTask task.
 */
export const executeTaskTask = Builder.task(executeTaskWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const project = await getProjectByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertProjectExists(project, { workflowId: parent.workflow.id });

    let taskId: Id<"tasks"> | undefined;

    const previousWorkItem = await getCompletedWorkItemByTask(
      mutationCtx.db,
      parent.workflow.id,
      "getNextTask"
    );
    if (previousWorkItem) {
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        previousWorkItem._id
      );
      if (metadata?.payload.type === "getNextTask") {
        const payload = metadata.payload as { nextTaskId?: Id<"tasks"> };
        if (payload.nextTaskId) {
          taskId = payload.nextTaskId;
        }
      }
    }

    if (!taskId) {
      const tasks = await listTasksByProject(mutationCtx.db, project._id);
      const pendingTasks = tasks
        .filter((task) => task.status === "Todo")
        .sort((a, b) => a.sortOrder - b.sortOrder);
      taskId = pendingTasks[0]?._id;
    }

    if (!taskId) {
      console.warn(
        `[executeTask] No pending task found for project ${project._id}.`
      );
      return;
    }

    await workItem.initialize({ taskId });
  },
});
