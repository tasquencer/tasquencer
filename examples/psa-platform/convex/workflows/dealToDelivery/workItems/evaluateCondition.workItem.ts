/**
 * EvaluateCondition Work Item
 *
 * Evaluates a condition to determine workflow routing.
 * Part of the conditional execution workflow pattern.
 *
 * Entry condition: Workflow reaches conditional branch point
 * Exit condition: Condition evaluated, routing decision stored
 *
 * Reference: Internal scaffolder pattern - conditional execution
 * TODO: Implement actual condition evaluation logic based on work item metadata
 * (deferred:happy-path-routing-defaults)
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import {
  initializeDealWorkItemAuth,
  initializeWorkItemWithProjectAuth,
  updateWorkItemMetadataPayload,
} from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getDeal } from "../db/deals";
import { assertProjectExists, assertDealExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:projects:view:own' scope
const projectsViewPolicy = authService.policies.requireScope(
  "dealToDelivery:projects:view:own"
);

/**
 * Actions for the evaluateCondition work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Evaluates condition and stores result in metadata for routing
 * - fail: Marks the work item as failed
 */
const evaluateConditionWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
      conditionType: z.string().optional(),
    }),
    projectsViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const deal = await getDeal(mutationCtx.db, project.dealId!);
      assertDealExists(deal, { dealId: project.dealId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:projects:view:own",
        dealId: deal._id,
        payload: {
          type: "evaluateCondition",
          taskName: "Evaluate Condition",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), projectsViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      conditionResult: z.boolean().optional().default(true), // Default to primary branch
      conditionNotes: z.string().optional(),
    }),
    projectsViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Update metadata with condition result for routing
      // The workflow's route function will read this to determine which branch to take
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "evaluateCondition",
        taskName: "Evaluate Condition",
        priority: "normal",
        conditionResult: payload.conditionResult,
        conditionNotes: payload.conditionNotes,
        evaluatedAt: Date.now(),
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), projectsViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The evaluateCondition work item with actions and lifecycle activities.
 */
export const evaluateConditionWorkItem = Builder.workItem("evaluateCondition")
  .withActions(evaluateConditionWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The evaluateCondition task.
 */
export const evaluateConditionTask = Builder.task(evaluateConditionWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
