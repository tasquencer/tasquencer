/**
 * SendProposal Work Item
 *
 * Sends a proposal to the client for review.
 * Marks the proposal as "Sent" and records the sent timestamp.
 *
 * Prerequisite: Proposal must exist in Draft status
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import {
  startAndClaimWorkItem,
  cleanupWorkItemOnCancel,
} from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithDealAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { markProposalSent, getLatestProposalForDeal } from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { DataIntegrityError } from "@repo/tasquencer";

// Policy: Requires 'dealToDelivery:proposals:send' scope
const proposalsSendPolicy = authService.policies.requireScope("dealToDelivery:proposals:send");

/**
 * Actions for the sendProposal work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Marks the proposal as sent
 * - fail: Marks the work item as failed
 */
const sendProposalWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    proposalsSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:proposals:send",
        dealId: payload.dealId,
        payload: {
          type: "sendProposal",
          taskName: "Send Proposal",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), proposalsSendPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      proposalId: z.optional(zid("proposals")),
    }),
    proposalsSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Get the proposal to send (either specified or latest)
      let proposalId = payload.proposalId;
      if (!proposalId) {
        const latestProposal = await getLatestProposalForDeal(mutationCtx.db, payload.dealId);
        if (!latestProposal) {
          throw new DataIntegrityError("NO_PROPOSAL_TO_SEND", {
            dealId: payload.dealId,
          });
        }
        proposalId = latestProposal._id;
      }

      // Mark the proposal as sent
      await markProposalSent(mutationCtx.db, proposalId);

      // Complete the work item
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), proposalsSendPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The sendProposal work item with actions and lifecycle activities.
 */
export const sendProposalWorkItem = Builder.workItem("sendProposal")
  .withActions(sendProposalWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The sendProposal task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const sendProposalTask = Builder.task(sendProposalWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
