/**
 * CreateProposal Work Item
 *
 * Sales rep generates a proposal document from the estimate.
 * Transitions the deal from Qualified to Proposal stage.
 *
 * Stage transition: Qualified -> Proposal
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
import { insertProposal, getNextProposalVersion } from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:proposals:create' scope
const proposalsCreatePolicy = authService.policies.requireScope("dealToDelivery:proposals:create");

/**
 * Actions for the createProposal work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Creates the proposal record and transitions deal to Proposal stage
 * - fail: Marks the work item as failed
 */
const createProposalWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    proposalsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Initialize work item metadata with deal reference
      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:proposals:create",
        dealId: payload.dealId,
        payload: {
          type: "createProposal",
          taskName: "Create Proposal",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), proposalsCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      documentUrl: z.string().url("Valid document URL is required"),
    }),
    proposalsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Get next version number for this deal
      const version = await getNextProposalVersion(mutationCtx.db, payload.dealId);

      // Create the proposal record
      await insertProposal(mutationCtx.db, {
        organizationId: deal.organizationId,
        dealId: payload.dealId,
        version,
        status: "Draft",
        documentUrl: payload.documentUrl,
        createdAt: Date.now(),
      });

      // Transition deal stage to Proposal (stores previous stage for potential rollback)
      await transitionDealStageForWorkItem(
        mutationCtx,
        workItem.id,
        payload.dealId,
        "Proposal"
      );

      // Update deal probability (50% at Proposal stage)
      await updateDeal(mutationCtx.db, payload.dealId, {
        probability: 50,
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), proposalsCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createProposal work item with actions and lifecycle activities.
 */
export const createProposalWorkItem = Builder.workItem("createProposal")
  .withActions(createProposalWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createProposal task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const createProposalTask = Builder.task(createProposalWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
