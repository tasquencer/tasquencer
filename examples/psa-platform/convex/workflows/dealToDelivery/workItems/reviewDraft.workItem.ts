/**
 * ReviewDraft Work Item
 *
 * Review a draft invoice for accuracy before finalizing.
 * Can approve for finalization or request edits.
 *
 * Entry condition: Invoice generation completed (any method)
 * Exit condition: Draft approved for finalization OR routed to editing
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getInvoice, listLineItemsByInvoice } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertInvoiceExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:edit' scope
const invoicesEditPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:edit"
);

/**
 * Actions for the reviewDraft work item.
 */
const reviewDraftWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      invoiceId: zid("invoices"),
    }),
    invoicesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      assertInvoiceExists(invoice, { invoiceId: payload.invoiceId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:invoices:edit",
        dealId: deal._id,
        payload: {
          type: "reviewDraft",
          taskName: "Review Draft Invoice",
          priority: "normal",
          invoiceId: payload.invoiceId,
        },
      });
    }
  )
  .start(z.never(), invoicesEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      invoiceId: zid("invoices"),
      approved: z.boolean(),
      comments: z.string().optional(),
    }),
    invoicesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "reviewDraft:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists and is in Draft status
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      assertInvoiceExists(invoice, { invoiceId: payload.invoiceId });

      if (invoice.status !== "Draft") {
        throw new Error(
          `Invoice must be in Draft status to review. Current status: ${invoice.status}`
        );
      }

      // Get line items for validation
      const lineItems = await listLineItemsByInvoice(mutationCtx.db, payload.invoiceId);

      if (lineItems.length === 0) {
        throw new Error("Invoice must have at least one line item");
      }

      // Validate invoice total is reasonable
      if (invoice.total <= 0) {
        throw new Error("Invoice total must be greater than zero");
      }

      // Store the approval decision and comments in work item metadata for routing and audit trail
      // The workflow router will read this to determine next task (editDraft vs finalizeInvoice)
      // Per spec task-reviewdraft.md: comments are optional but should be persisted
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "reviewDraft",
        taskName: "Review Draft Invoice",
        priority: "normal",
        invoiceId: payload.invoiceId,
        approved: payload.approved, // Store decision for workflow routing
        comments: payload.comments, // Store comments for audit trail (per spec)
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviewDraft work item with actions and lifecycle activities.
 */
export const reviewDraftWorkItem = Builder.workItem("reviewDraft")
  .withActions(reviewDraftWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviewDraft task.
 */
export const reviewDraftTask = Builder.task(reviewDraftWorkItem);
