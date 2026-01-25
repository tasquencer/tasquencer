/**
 * CompleteTask Work Item
 *
 * Marks a task as completed.
 * Part of the sequential execution workflow pattern.
 *
 * Entry condition: Task in progress
 * Exit condition: Task status = "Done"
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
import { assertTaskExists, assertProjectExists, assertDealExists } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:tasks:edit:own' scope
const tasksEditPolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:edit:own"
);

/**
 * Actions for the completeTask work item.
 *
 * - initialize: Sets up work item metadata with task context
 * - start: Claims the work item for the current user
 * - complete: Marks task as done
 * - fail: Marks the work item as failed
 */
const completeTaskWorkItemActions = authService.builders.workItemActions
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
          type: "completeTask",
          taskName: `Complete: ${task.name}`,
          priority: "normal",
          taskId: task._id,
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
      actualHours: z.number().min(0).optional(),
      notes: z.string().optional(),
    }),
    tasksEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const task = await getTask(mutationCtx.db, payload.taskId);
      assertTaskExists(task, { taskId: payload.taskId });

      // Mark task as done
      await updateTask(mutationCtx.db, task._id, {
        status: "Done",
        ...(payload.actualHours !== undefined && { actualHours: payload.actualHours }),
      });

      // Update metadata with completion info for routing decisions
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await mutationCtx.db.patch(metadata._id, {
          payload: {
            type: "completeTask" as const,
            taskName: `Complete: ${task.name}`,
            priority: "normal" as const,
            taskId: task._id,
            completed: true,
          } as any,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The completeTask work item with actions and lifecycle activities.
 */
export const completeTaskWorkItem = Builder.workItem("completeTask")
  .withActions(completeTaskWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The completeTask task.
 */
export const completeTaskTask = Builder.task(completeTaskWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const project = await getProjectByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertProjectExists(project, { workflowId: parent.workflow.id });

    const tasks = await listTasksByProject(mutationCtx.db, project._id);
    const inProgressTasks = tasks
      .filter((task) => task.status === "InProgress")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    let taskId: Id<"tasks"> | undefined = inProgressTasks[0]?._id;

    if (!taskId) {
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
    }

    if (!taskId) {
      console.warn(
        `[completeTask] No in-progress task found for project ${project._id}.`
      );
      return;
    }

    await workItem.initialize({ taskId });
  },
});
