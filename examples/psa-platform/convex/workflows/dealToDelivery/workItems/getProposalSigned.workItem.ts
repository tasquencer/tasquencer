/**
 * GetProposalSigned Work Item
 *
 * Finalizes the deal when the client signs the proposal.
 * Transitions the deal from Negotiation to Won stage.
 *
 * Stage transition: Negotiation -> Won
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
import { markProposalSigned, getLatestProposalForDeal } from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { DataIntegrityError } from "@repo/tasquencer";

// Policy: Requires 'dealToDelivery:deals:close' scope
const dealsClosePolicy = authService.policies.requireScope("dealToDelivery:deals:close");

/**
 * Actions for the getProposalSigned work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Marks proposal as signed and transitions deal to Won
 * - fail: Marks the work item as failed
 */
const getProposalSignedWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    dealsClosePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:deals:close",
        dealId: payload.dealId,
        payload: {
          type: "getProposalSigned",
          taskName: "Get Proposal Signed",
          priority: "high",
        },
      });
    }
  )
  .start(z.never(), dealsClosePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      proposalId: z.optional(zid("proposals")),
      signedAt: z.number().optional(),
    }),
    dealsClosePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Get the proposal to mark as signed (either specified or latest)
      let proposalId = payload.proposalId;
      if (!proposalId) {
        const latestProposal = await getLatestProposalForDeal(mutationCtx.db, payload.dealId);
        if (!latestProposal) {
          throw new DataIntegrityError("NO_PROPOSAL_TO_SIGN", {
            dealId: payload.dealId,
          });
        }
        proposalId = latestProposal._id;
      }

      // Mark the proposal as signed
      await markProposalSigned(mutationCtx.db, proposalId);

      // Transition deal stage to Won (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        "Won"
      );

      // Update deal with closed status
      await updateDeal(mutationCtx.db, payload.dealId, {
        probability: 100, // 100% probability for Won deals
        closedAt: payload.signedAt ?? Date.now(),
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsClosePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The getProposalSigned work item with actions and lifecycle activities.
 */
export const getProposalSignedWorkItem = Builder.workItem("getProposalSigned")
  .withActions(getProposalSignedWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The getProposalSigned task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const getProposalSignedTask = Builder.task(getProposalSignedWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
