/**
 * InitParallelTasks Work Item
 *
 * Identifies tasks that can be executed in parallel for a project.
 * Part of the parallel execution workflow pattern.
 *
 * Entry condition: Project has tasks with no blocking dependencies
 * Exit condition: Parallel task set identified
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
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:tasks:view:own' scope
const tasksViewPolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:view:own"
);

/**
 * Actions for the initParallelTasks work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Identifies parallel tasks and stores in metadata
 * - fail: Marks the work item as failed
 */
const initParallelTasksWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
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
          type: "initParallelTasks",
          taskName: "Initialize Parallel Tasks",
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

      // Find tasks that can run in parallel (no unsatisfied dependencies)
      const tasks = await listTasksByProject(mutationCtx.db, project._id);
      const completedTaskIds = new Set(
        tasks.filter(t => t.status === "Done").map(t => t._id)
      );

      // A task can run in parallel if it's pending and all its dependencies are complete
      const parallelTasks = tasks
        .filter(t => t.status === "Todo")
        .filter(t => {
          // If task has no dependencies, it can run
          if (!t.dependencies || t.dependencies.length === 0) return true;
          // Otherwise, check all dependencies are complete
          return t.dependencies.every(depId => completedTaskIds.has(depId as Id<"tasks">));
        })
        .sort((a, b) => a.sortOrder - b.sortOrder);

      // Update metadata with parallel task info
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await mutationCtx.db.patch(metadata._id, {
          payload: {
            type: "initParallelTasks" as const,
            taskName: "Initialize Parallel Tasks",
            priority: "normal" as const,
            parallelTaskIds: parallelTasks.map(t => t._id),
            taskCount: parallelTasks.length,
          },
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The initParallelTasks work item with actions and lifecycle activities.
 */
export const initParallelTasksWorkItem = Builder.workItem("initParallelTasks")
  .withActions(initParallelTasksWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The initParallelTasks task.
 */
export const initParallelTasksTask = Builder.task(initParallelTasksWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
