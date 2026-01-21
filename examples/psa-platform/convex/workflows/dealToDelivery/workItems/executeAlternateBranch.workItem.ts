/**
 * ExecuteAlternateBranch Work Item
 *
 * Executes the alternate branch of a conditional workflow.
 * Part of the conditional execution workflow pattern.
 *
 * Entry condition: Condition evaluated to false (alternate path)
 * Exit condition: Alternate branch work completed
 *
 * Reference: Internal scaffolder pattern - conditional execution
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getDeal } from "../db/deals";
import { assertProjectExists, assertDealExists } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";

// Policy: Requires 'dealToDelivery:projects:edit:own' scope
const projectsEditPolicy = authService.policies.requireScope(
  "dealToDelivery:projects:edit:own"
);

/**
 * Actions for the executeAlternateBranch work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Executes alternate branch work
 * - fail: Marks the work item as failed
 */
const executeAlternateBranchWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    projectsEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const deal = await getDeal(mutationCtx.db, project.dealId!);
      assertDealExists(deal, { dealId: project.dealId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:projects:edit:own",
        dealId: deal._id,
        payload: {
          type: "executeAlternateBranch",
          taskName: "Execute Alternate Branch",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), projectsEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      branchResult: z.string().optional(),
    }),
    projectsEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Update metadata with branch execution result
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await mutationCtx.db.patch(metadata._id, {
          payload: {
            type: "executeAlternateBranch" as const,
            taskName: "Execute Alternate Branch",
            priority: "normal" as const,
            branchExecuted: "alternate" as const,
            branchResult: payload.branchResult,
            completedAt: Date.now(),
          },
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), projectsEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The executeAlternateBranch work item with actions and lifecycle activities.
 */
export const executeAlternateBranchWorkItem = Builder.workItem("executeAlternateBranch")
  .withActions(executeAlternateBranchWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The executeAlternateBranch task.
 */
export const executeAlternateBranchTask = Builder.task(executeAlternateBranchWorkItem);
