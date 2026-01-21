/**
 * SyncParallelTasks Work Item
 *
 * Synchronizes results from parallel task execution.
 * Part of the parallel execution workflow pattern.
 *
 * Entry condition: Parallel tasks have been executed
 * Exit condition: All parallel tasks synchronized
 *
 * Reference: Internal scaffolder pattern - parallel execution
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getDeal } from "../db/deals";
import { listTasksByProject } from "../db/tasks";
import { assertProjectExists, assertDealExists } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";

// Policy: Requires 'dealToDelivery:tasks:view:own' scope
const tasksViewPolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:view:own"
);

/**
 * Actions for the syncParallelTasks work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Calculates sync status and stores in metadata
 * - fail: Marks the work item as failed
 */
const syncParallelTasksWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
      taskIds: z.array(zid("tasks")).optional(),
    }),
    tasksViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const deal = await getDeal(mutationCtx.db, project.dealId!);
      assertDealExists(deal, { dealId: project.dealId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:tasks:view:own",
        dealId: deal._id,
        payload: {
          type: "syncParallelTasks",
          taskName: "Sync Parallel Tasks",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), tasksViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
    }),
    tasksViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Calculate sync status
      const tasks = await listTasksByProject(mutationCtx.db, project._id);
      const todoTasks = tasks.filter(t => t.status === "Todo");
      const inProgressTasks = tasks.filter(t => t.status === "InProgress");
      const doneTasks = tasks.filter(t => t.status === "Done");

      const allComplete = todoTasks.length === 0 && inProgressTasks.length === 0;
      const hasMoreWork = todoTasks.length > 0 || inProgressTasks.length > 0;

      // Update metadata with sync status
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await mutationCtx.db.patch(metadata._id, {
          payload: {
            type: "syncParallelTasks" as const,
            taskName: "Sync Parallel Tasks",
            priority: "normal" as const,
            allComplete,
            hasMoreWork,
            completedCount: doneTasks.length,
            pendingCount: todoTasks.length,
            inProgressCount: inProgressTasks.length,
          } as any,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The syncParallelTasks work item with actions and lifecycle activities.
 */
export const syncParallelTasksWorkItem = Builder.workItem("syncParallelTasks")
  .withActions(syncParallelTasksWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The syncParallelTasks task.
 */
export const syncParallelTasksTask = Builder.task(syncParallelTasksWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
