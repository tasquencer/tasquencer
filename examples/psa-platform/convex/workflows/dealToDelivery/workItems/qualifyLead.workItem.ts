/**
 * QualifyLead Work Item
 *
 * Sales rep evaluates the lead using BANT (Budget, Authority, Need, Timeline) criteria.
 * Transitions the deal from Lead to Qualified or Disqualified based on the assessment.
 *
 * Stage transition: Lead -> Qualified | Disqualified
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import {
  startAndClaimWorkItem,
  cleanupWorkItemOnCancel,
  transitionDealStageForWorkItem,
} from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithDealAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { updateDeal } from "../db/deals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:deals:qualify' scope
const dealsQualifyPolicy = authService.policies.requireScope("dealToDelivery:deals:qualify");

/**
 * Actions for the qualifyLead work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Updates deal with qualification status and notes
 * - fail: Marks the work item as failed
 */
const qualifyLeadWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    dealsQualifyPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Initialize work item metadata with deal reference
      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:deals:qualify",
        dealId: payload.dealId,
        payload: {
          type: "qualifyLead",
          taskName: "Qualify Lead",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), dealsQualifyPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      qualified: z.boolean(),
      qualificationNotes: z.string().optional(),
      // BANT criteria fields
      budget: z.boolean().optional(), // Has budget allocated
      authority: z.boolean().optional(), // Is decision maker
      need: z.boolean().optional(), // Has clear need
      timeline: z.boolean().optional(), // Has clear timeline
    }),
    dealsQualifyPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Determine the new stage and probability
      const newStage = payload.qualified ? "Qualified" : "Disqualified";
      const newProbability = payload.qualified ? 25 : 0;

      // Transition deal stage (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        newStage
      );

      // Update deal with qualification info
      await updateDeal(mutationCtx.db, payload.dealId, {
        probability: newProbability,
        qualificationNotes: payload.qualificationNotes,
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsQualifyPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The qualifyLead work item with actions and lifecycle activities.
 */
export const qualifyLeadWorkItem = Builder.workItem("qualifyLead")
  .withActions(qualifyLeadWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The qualifyLead task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const qualifyLeadTask = Builder.task(qualifyLeadWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
