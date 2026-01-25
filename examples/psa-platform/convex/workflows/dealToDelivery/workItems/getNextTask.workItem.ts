/**
 * GetNextTask Work Item
 *
 * Finds the next pending task in the project to execute.
 * Part of the sequential execution workflow pattern.
 *
 * Entry condition: Project has tasks
 * Exit condition: Next task identified or no more tasks
 *
 * Reference: Internal scaffolder pattern - sequential execution
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
 * Actions for the getNextTask work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Identifies next task and stores in metadata
 * - fail: Marks the work item as failed
 */
const getNextTaskWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    tasksViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Get the deal for this project
      const deal = await getDeal(mutationCtx.db, project.dealId!);
      assertDealExists(deal, { dealId: project.dealId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:tasks:view:own",
        dealId: deal._id,
        payload: {
          type: "getNextTask",
          taskName: "Get Next Task",
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

      // Find next pending task using deterministic selection (TENET-ROUTING-DETERMINISM)
      const tasks = await listTasksByProject(mutationCtx.db, project._id);
      const pendingTasks = tasks
        .filter(t => t.status === "Todo")
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const nextTask = pendingTasks[0] || null;

      // Update metadata with next task info for routing
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await mutationCtx.db.patch(metadata._id, {
          payload: {
            type: "getNextTask" as const,
            taskName: "Get Next Task",
            priority: "normal" as const,
            nextTaskId: nextTask?._id,
            hasMoreTasks: pendingTasks.length > 0,
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
 * The getNextTask work item with actions and lifecycle activities.
 */
export const getNextTaskWorkItem = Builder.workItem("getNextTask")
  .withActions(getNextTaskWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The getNextTask task.
 */
export const getNextTaskTask = Builder.task(getNextTaskWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
