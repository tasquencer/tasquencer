/**
 * FinalizeInvoice Work Item
 *
 * Lock and finalize a draft invoice for sending to client.
 * Generates invoice number and marks linked time/expenses as invoiced.
 *
 * Entry condition: reviewDraft completed with approved = true
 * Exit condition: Invoice status = "Finalized", invoice number assigned
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
import {
  getInvoice,
  updateInvoice,
  listLineItemsByInvoice,
  finalizeInvoice as finalizeInvoiceDb,
} from "../db/invoices";
import { lockTimeEntry } from "../db/timeEntries";
import { markExpenseInvoiced } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertInvoiceExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Minimum invoice amount threshold (in cents) - per spec 11-workflow-invoice-generation.md line 441
const INVOICE_MIN_AMOUNT_WARNING = 5000; // $50

// Policy: Requires 'dealToDelivery:invoices:finalize' scope
const invoicesFinalizePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:finalize"
);

/**
 * Actions for the finalizeInvoice work item.
 */
const finalizeInvoiceWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      invoiceId: zid("invoices"),
    }),
    invoicesFinalizePolicy,
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
        scope: "dealToDelivery:invoices:finalize",
        dealId: deal._id,
        payload: {
          type: "finalizeInvoice",
          taskName: "Finalize Invoice",
          priority: "normal",
          invoiceId: payload.invoiceId,
        },
      });
    }
  )
  .start(z.never(), invoicesFinalizePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      invoiceId: zid("invoices"),
      dueDate: z.number().optional(),
      notes: z.string().max(2000).optional(),
    }),
    invoicesFinalizePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "finalizeInvoice:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Validate invoice exists and is in Draft status
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      assertInvoiceExists(invoice, { invoiceId: payload.invoiceId });

      if (invoice.status !== "Draft") {
        throw new Error(
          `Only Draft invoices can be finalized. Current status: ${invoice.status}`
        );
      }

      // Get line items to lock associated time/expenses
      const lineItems = await listLineItemsByInvoice(mutationCtx.db, payload.invoiceId);

      if (lineItems.length === 0) {
        throw new Error("Invoice must have at least one line item to finalize");
      }

      // Check for minimum invoice amount warning per spec 11-workflow-invoice-generation.md line 441
      // "Minimum Amount: Warn if invoice total < $50 (configurable)"
      if (invoice.total < INVOICE_MIN_AMOUNT_WARNING) {
        console.warn(
          `[finalizeInvoice] LOW AMOUNT WARNING: Invoice total of ${invoice.total} cents ` +
          `is below the minimum recommended amount of ${INVOICE_MIN_AMOUNT_WARNING} cents ($${INVOICE_MIN_AMOUNT_WARNING / 100}). ` +
          `Consider combining with other billable items. Invoice ID: ${payload.invoiceId}`
        );
        // Note: Per spec, we warn but still allow finalization to proceed
      }

      // Update invoice with optional fields before finalizing
      if (payload.dueDate || payload.notes) {
        const updates: Record<string, unknown> = {};
        if (payload.dueDate) updates.dueDate = payload.dueDate;
        if (payload.notes) updates.notes = payload.notes;
        await updateInvoice(mutationCtx.db, payload.invoiceId, updates);
      }

      // Finalize invoice (generates number, sets status, timestamps)
      await finalizeInvoiceDb(
        mutationCtx.db,
        payload.invoiceId,
        userId
      );

      // Lock all linked time entries
      for (const lineItem of lineItems) {
        if (lineItem.timeEntryIds) {
          for (const timeEntryId of lineItem.timeEntryIds) {
            await lockTimeEntry(mutationCtx.db, timeEntryId, payload.invoiceId);
          }
        }

        // Mark expenses as invoiced
        if (lineItem.expenseIds) {
          for (const expenseId of lineItem.expenseIds) {
            await markExpenseInvoiced(mutationCtx.db, expenseId, payload.invoiceId);
          }
        }
      }

      // Update work item metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "finalizeInvoice",
        taskName: "Finalize Invoice",
        priority: "normal",
        invoiceId: payload.invoiceId,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesFinalizePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The finalizeInvoice work item with actions and lifecycle activities.
 */
export const finalizeInvoiceWorkItem = Builder.workItem("finalizeInvoice")
  .withActions(finalizeInvoiceWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The finalizeInvoice task.
 */
export const finalizeInvoiceTask = Builder.task(finalizeInvoiceWorkItem);
