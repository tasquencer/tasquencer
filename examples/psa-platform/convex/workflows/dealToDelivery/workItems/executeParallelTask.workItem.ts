/**
 * ExecuteParallelTask Work Item
 *
 * Executes a task as part of a parallel execution batch.
 * Part of the parallel execution workflow pattern.
 *
 * Entry condition: Task identified for parallel execution
 * Exit condition: Task completed or in progress
 *
 * Reference: Internal scaffolder pattern - parallel execution
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getTask, updateTask } from "../db/tasks";
import { getProject } from "../db/projects";
import { getDeal } from "../db/deals";
import { assertTaskExists, assertProjectExists, assertDealExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:tasks:edit:own' scope
const tasksEditPolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:edit:own"
);

/**
 * Actions for the executeParallelTask work item.
 *
 * - initialize: Sets up work item metadata with task context
 * - start: Claims the work item for the current user
 * - complete: Executes the task (marks as in progress or done)
 * - fail: Marks the work item as failed
 */
const executeParallelTaskWorkItemActions = authService.builders.workItemActions
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
          type: "executeParallelTask",
          taskName: `Parallel: ${task.name}`,
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
      markAsDone: z.boolean().optional().default(false),
    }),
    tasksEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const task = await getTask(mutationCtx.db, payload.taskId);
      assertTaskExists(task, { taskId: payload.taskId });

      // Mark task as in progress or done based on flag
      const newStatus = payload.markAsDone ? "Done" : "InProgress";
      if (task.status !== newStatus && task.status !== "Done") {
        await updateTask(mutationCtx.db, task._id, {
          status: newStatus,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The executeParallelTask work item with actions and lifecycle activities.
 */
export const executeParallelTaskWorkItem = Builder.workItem("executeParallelTask")
  .withActions(executeParallelTaskWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The executeParallelTask task.
 */
export const executeParallelTaskTask = Builder.task(executeParallelTaskWorkItem);
