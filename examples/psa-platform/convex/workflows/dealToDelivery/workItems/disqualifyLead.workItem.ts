/**
 * DisqualifyLead Work Item
 *
 * Disqualifies a lead that doesn't meet the BANT criteria.
 * Transitions the deal from Lead to Disqualified stage.
 *
 * Stage transition: Lead -> Disqualified
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

// Policy: Requires 'dealToDelivery:deals:qualify' scope (same permission as qualifying)
const dealsQualifyPolicy = authService.policies.requireScope("dealToDelivery:deals:qualify");

/**
 * Actions for the disqualifyLead work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Transitions deal to Disqualified with reason
 * - fail: Marks the work item as failed
 */
const disqualifyLeadWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    dealsQualifyPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:deals:qualify",
        dealId: payload.dealId,
        payload: {
          type: "disqualifyLead",
          taskName: "Disqualify Lead",
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
      disqualificationReason: z.string().min(1, "Disqualification reason is required"),
      notes: z.string().optional(),
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

      // Transition deal stage to Disqualified (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        "Disqualified"
      );

      // Update deal with disqualification info
      await updateDeal(mutationCtx.db, payload.dealId, {
        probability: 0, // 0% probability for Disqualified deals
        lostReason: payload.disqualificationReason,
        qualificationNotes: payload.notes ?? deal.qualificationNotes,
        closedAt: Date.now(),
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsQualifyPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The disqualifyLead work item with actions and lifecycle activities.
 */
export const disqualifyLeadWorkItem = Builder.workItem("disqualifyLead")
  .withActions(disqualifyLeadWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The disqualifyLead task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const disqualifyLeadTask = Builder.task(disqualifyLeadWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
