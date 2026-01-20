/**
 * NegotiateTerms Work Item
 *
 * Handles the negotiation phase after a proposal is sent.
 * Transitions the deal from Proposal to Negotiation stage.
 *
 * Stage transition: Proposal -> Negotiation
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
import {
  getLatestProposalForDeal,
  markProposalRejected,
  markProposalViewed,
} from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:deals:negotiate' scope
const dealsNegotiatePolicy = authService.policies.requireScope("dealToDelivery:deals:negotiate");

/**
 * Actions for the negotiateTerms work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item and transitions deal to Negotiation stage
 * - complete: Finalizes negotiation (deal remains in Negotiation until signed or lost)
 * - fail: Marks the work item as failed
 */
const negotiateTermsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    dealsNegotiatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:deals:negotiate",
        dealId: payload.dealId,
        payload: {
          type: "negotiateTerms",
          taskName: "Negotiate Terms",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), dealsNegotiatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      outcome: z.enum(["proceed", "revise", "lost"]),
      negotiationNotes: z.string().optional(),
      adjustedValue: z.number().min(0).optional(),
    }),
    dealsNegotiatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      const latestProposal = await getLatestProposalForDeal(
        mutationCtx.db,
        payload.dealId
      );
      if (!latestProposal) {
        throw new Error(`No proposal found for deal ${payload.dealId}`);
      }

      const nextStage = payload.outcome === "lost" ? "Lost" : "Negotiation";

      // Transition deal stage (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        nextStage
      );

      if (payload.outcome === "revise") {
        await markProposalRejected(mutationCtx.db, latestProposal._id);
      } else if (payload.outcome === "lost") {
        await markProposalRejected(mutationCtx.db, latestProposal._id);
      } else {
        await markProposalViewed(mutationCtx.db, latestProposal._id);
      }

      // Update deal with negotiation results
      const updates: {
        probability: number;
        value?: number;
        qualificationNotes?: string;
        lostReason?: string;
      } = {
        probability: payload.outcome === "lost" ? 0 : 70,
      };

      if (payload.adjustedValue !== undefined) {
        updates.value = payload.adjustedValue;
      }

      if (payload.negotiationNotes) {
        updates.qualificationNotes = payload.negotiationNotes;
        if (payload.outcome === "lost") {
          updates.lostReason = payload.negotiationNotes;
        }
      }

      await updateDeal(mutationCtx.db, payload.dealId, updates);

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsNegotiatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The negotiateTerms work item with actions and lifecycle activities.
 */
export const negotiateTermsWorkItem = Builder.workItem("negotiateTerms")
  .withActions(negotiateTermsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The negotiateTerms task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const negotiateTermsTask = Builder.task(negotiateTermsWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
