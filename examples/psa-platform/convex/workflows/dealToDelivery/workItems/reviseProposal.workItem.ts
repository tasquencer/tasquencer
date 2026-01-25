/**
 * ReviseProposal Work Item
 *
 * Creates a new version of the proposal during negotiation.
 * Used when terms need to be adjusted based on client feedback.
 *
 * Tracks previous version number for audit trail.
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import {
  startAndClaimWorkItem,
  cleanupWorkItemOnCancel,
} from "./helpers";
import {
  initializeDealWorkItemAuth,
  initializeWorkItemWithDealAuth,
  updateWorkItemMetadataPayload,
} from "./helpersAuth";
import { authService } from "../../../authorization";
import {
  insertProposal,
  getNextProposalVersion,
  getLatestProposalForDeal,
} from "../db/proposals";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:proposals:create' scope (same as creating proposals)
const proposalsCreatePolicy = authService.policies.requireScope("dealToDelivery:proposals:create");

/**
 * Actions for the reviseProposal work item.
 *
 * - initialize: Sets up work item metadata with deal context and current version
 * - start: Claims the work item for the current user
 * - complete: Creates a new proposal version with updated document
 * - fail: Marks the work item as failed
 */
const reviseProposalWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    proposalsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get current proposal version to track in metadata
      const currentProposal = await getLatestProposalForDeal(mutationCtx.db, payload.dealId);
      const previousVersion = currentProposal?.version;

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:proposals:create",
        dealId: payload.dealId,
        payload: {
          type: "reviseProposal",
          taskName: "Revise Proposal",
          priority: "normal",
          previousVersion,
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
      revisionNotes: z.string().optional(),
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

      // Enforce revision limit: max 5 revisions (version 6 = 5th revision)
      // Version 1 is the original, versions 2-6 are the 5 allowed revisions
      // Version 7+ requires manager approval (per spec 03-workflow-sales-phase.md line 390)
      const MAX_REVISION_VERSION = 6;
      if (version > MAX_REVISION_VERSION) {
        throw new Error(
          `Maximum 5 proposal revisions reached (current version: ${version - 1}). ` +
          "Manager approval is required to continue revising."
        );
      }

      // Create the new proposal version
      await insertProposal(mutationCtx.db, {
        organizationId: deal.organizationId,
        dealId: payload.dealId,
        version,
        status: "Draft",
        documentUrl: payload.documentUrl,
        createdAt: Date.now(),
      });

      // Update work item metadata with new version using domain-layer function
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "reviseProposal",
        taskName: "Revise Proposal",
        priority: "normal",
        previousVersion: version - 1,
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), proposalsCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviseProposal work item with actions and lifecycle activities.
 */
export const reviseProposalWorkItem = Builder.workItem("reviseProposal")
  .withActions(reviseProposalWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviseProposal task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const reviseProposalTask = Builder.task(reviseProposalWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
