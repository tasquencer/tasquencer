/**
 * ArchiveDeal Work Item
 *
 * Archives a deal when it is lost or abandoned.
 * Transitions the deal to Lost stage with a reason.
 *
 * Stage transition: Any -> Lost
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
import { markProposalRejected, getLatestProposalForDeal } from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:deals:close' scope
const dealsClosePolicy = authService.policies.requireScope("dealToDelivery:deals:close");

/**
 * Actions for the archiveDeal work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Transitions deal to Lost and records reason
 * - fail: Marks the work item as failed
 */
const archiveDealWorkItemActions = authService.builders.workItemActions
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
          type: "archiveDeal",
          taskName: "Archive Deal",
          priority: "normal",
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
      lostReason: z.string().min(1, "Lost reason is required"),
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

      // Mark any pending proposal as rejected
      const latestProposal = await getLatestProposalForDeal(mutationCtx.db, payload.dealId);
      if (latestProposal && latestProposal.status !== "Signed" && latestProposal.status !== "Rejected") {
        await markProposalRejected(mutationCtx.db, latestProposal._id);
      }

      // Transition deal stage to Lost (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        "Lost"
      );

      // Update deal with lost reason and closed timestamp
      await updateDeal(mutationCtx.db, payload.dealId, {
        probability: 0, // 0% probability for Lost deals
        lostReason: payload.lostReason,
        closedAt: Date.now(),
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsClosePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The archiveDeal work item with actions and lifecycle activities.
 */
export const archiveDealWorkItem = Builder.workItem("archiveDeal")
  .withActions(archiveDealWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The archiveDeal task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const archiveDealTask = Builder.task(archiveDealWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
