/**
 * VoidInvoice Work Item
 *
 * Voids a finalized invoice (instead of deleting it).
 * Per spec 11-workflow-invoice-generation.md line 444: "Void not delete"
 *
 * This work item can void invoices in Finalized, Sent, or Viewed status.
 * Draft invoices should be deleted instead; Paid invoices require reversal first.
 *
 * TENET-WF-EXEC: Invoice voiding transitions are now work item-driven
 * for proper audit trail through the Tasquencer workflow system.
 *
 * NOTE: This work item is part of the standalone invoiceVoid workflow, not the
 * deal-to-delivery workflow. It doesn't use the dealToDeliveryWorkItems metadata
 * table because:
 * 1. The invoice itself captures sufficient audit information (voidedBy, voidedAt, voidReason)
 * 2. The Tasquencer workflow/workItem tables provide workflow execution audit trail
 * 3. Not all invoices are part of the deal-to-delivery workflow (e.g., test data)
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getInvoice, voidInvoice, canVoidInvoice } from "../db/invoices";
import { assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:invoices:void' scope
// Per spec 02-authorization.md, Finance role has this scope
const invoicesVoidPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:void"
);

/**
 * Actions for the voidInvoice work item.
 *
 * - initialize: Validates invoice exists and can be voided
 * - start: Claims the work item for the current user
 * - complete: Voids the invoice with reason and audit trail
 * - fail: Marks the work item as failed
 */
const voidInvoiceWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      invoiceId: zid("invoices"),
    }),
    invoicesVoidPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Validate invoice exists before initializing work item
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${payload.invoiceId}`);
      }

      // Just initialize the work item - no additional metadata needed
      // The invoice table captures audit info (voidedBy, voidedAt, voidReason)
      await workItem.initialize();
    }
  )
  .start(z.never(), invoicesVoidPolicy, async ({ mutationCtx, workItem }) => {
    // Get authenticated user for audit purposes
    const authUser = await authComponent.safeGetAuthUser(mutationCtx);
    assertAuthenticatedUser(authUser, {
      operation: "voidInvoice:start",
      workItemId: workItem.id,
    });

    await workItem.start();
  })
  .complete(
    z.object({
      invoiceId: zid("invoices"),
      reason: z.string().optional(),
    }),
    invoicesVoidPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "voidInvoice:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${payload.invoiceId}`);
      }

      // Check if invoice can be voided
      if (!canVoidInvoice(invoice)) {
        if (invoice.status === "Draft") {
          throw new Error("Draft invoices should be deleted, not voided");
        }
        if (invoice.status === "Paid") {
          throw new Error(
            "Cannot void a paid invoice. Record a refund or reversal first."
          );
        }
        if (invoice.status === "Void") {
          // Already voided - complete silently (idempotent)
          await workItem.complete();
          return;
        }
        throw new Error(`Invoice in ${invoice.status} status cannot be voided`);
      }

      // Void the invoice - this updates voidedBy, voidedAt, voidReason fields
      await voidInvoice(mutationCtx.db, payload.invoiceId, userId, payload.reason);

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesVoidPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The voidInvoice work item with actions and lifecycle activities.
 * No cleanup needed on cancel/fail since we don't create separate metadata.
 */
export const voidInvoiceWorkItem = Builder.workItem("voidInvoice")
  .withActions(voidInvoiceWorkItemActions.build())
  .withActivities({
    onCanceled: async () => {
      // No cleanup needed - invoice wasn't voided yet
    },
    onFailed: async () => {
      // No cleanup needed - invoice wasn't voided yet
    },
  });

/**
 * The voidInvoice task.
 */
export const voidInvoiceTask = Builder.task(voidInvoiceWorkItem);
