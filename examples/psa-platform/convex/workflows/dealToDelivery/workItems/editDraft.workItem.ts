/**
 * EditDraft Work Item
 *
 * Edit a draft invoice to correct errors or make adjustments.
 *
 * Entry condition: reviewDraft completed with approved = false
 * Exit condition: Draft invoice updated, returns to review
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
  getInvoiceLineItem,
  updateInvoice,
  listLineItemsByInvoice,
  insertInvoiceLineItem,
  updateInvoiceLineItem,
  deleteInvoiceLineItem,
  recalculateInvoiceTotals,
} from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertInvoiceExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:edit' scope
const invoicesEditPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:edit"
);

const lineItemChangeSchema = z.object({
  id: zid("invoiceLineItems").optional(),
  action: z.enum(["add", "update", "remove"]),
  description: z.string().optional(),
  quantity: z.number().min(0).optional(),
  rate: z.number().min(0).optional(),
});

/**
 * Actions for the editDraft work item.
 */
const editDraftWorkItemActions = authService.builders.workItemActions
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
          type: "editDraft",
          taskName: "Edit Draft Invoice",
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
      changes: z.object({
        lineItems: z.array(lineItemChangeSchema).optional(),
        dueDate: z.number().optional(),
        notes: z.string().max(2000).optional(),
        discount: z.object({
          type: z.enum(["percentage", "fixed"]),
          value: z.number().min(0),
        }).optional(),
      }),
    }),
    invoicesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "editDraft:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists and is in Draft status
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      assertInvoiceExists(invoice, { invoiceId: payload.invoiceId });

      if (invoice.status !== "Draft") {
        throw new Error(
          `Only Draft invoices can be edited. Current status: ${invoice.status}`
        );
      }

      // Process line item changes
      if (payload.changes.lineItems) {
        for (const change of payload.changes.lineItems) {
          switch (change.action) {
            case "add": {
              if (!change.description || change.quantity === undefined || change.rate === undefined) {
                throw new Error("Add action requires description, quantity, and rate");
              }
              const amount = Math.round(change.quantity * change.rate);
              // Get current max sort order for new line items
              const existingLineItems = await listLineItemsByInvoice(mutationCtx.db, payload.invoiceId);
              const maxSortOrder = existingLineItems.length > 0
                ? Math.max(...existingLineItems.map(li => li.sortOrder))
                : -1;
              await insertInvoiceLineItem(mutationCtx.db, {
                invoiceId: payload.invoiceId,
                description: change.description,
                quantity: change.quantity,
                rate: change.rate,
                amount,
                sortOrder: maxSortOrder + 1,
              });
              break;
            }
            case "update": {
              if (!change.id) {
                throw new Error("Update action requires line item id");
              }
              const updates: Record<string, unknown> = {};
              if (change.description !== undefined) updates.description = change.description;
              if (change.quantity !== undefined) updates.quantity = change.quantity;
              if (change.rate !== undefined) updates.rate = change.rate;
              if (change.quantity !== undefined || change.rate !== undefined) {
                // Use domain layer function (TENET-DOMAIN-BOUNDARY)
                const lineItem = await getInvoiceLineItem(mutationCtx.db, change.id);
                if (lineItem) {
                  const newQuantity = change.quantity ?? lineItem.quantity;
                  const newRate = change.rate ?? lineItem.rate;
                  updates.amount = Math.round(newQuantity * newRate);
                }
              }
              await updateInvoiceLineItem(mutationCtx.db, change.id, updates);
              break;
            }
            case "remove": {
              if (!change.id) {
                throw new Error("Remove action requires line item id");
              }
              await deleteInvoiceLineItem(mutationCtx.db, change.id);
              break;
            }
          }
        }
      }

      // Update invoice-level fields
      const invoiceUpdates: Record<string, unknown> = {};
      if (payload.changes.dueDate !== undefined) {
        invoiceUpdates.dueDate = payload.changes.dueDate;
      }
      if (payload.changes.notes !== undefined) {
        invoiceUpdates.notes = payload.changes.notes;
      }

      // Apply discount if specified
      if (payload.changes.discount) {
        const lineItems = await listLineItemsByInvoice(mutationCtx.db, payload.invoiceId);
        const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

        let discountAmount: number;
        if (payload.changes.discount.type === "percentage") {
          discountAmount = Math.round(subtotal * (payload.changes.discount.value / 100));
        } else {
          discountAmount = payload.changes.discount.value;
        }

        invoiceUpdates.discount = discountAmount;
      }

      if (Object.keys(invoiceUpdates).length > 0) {
        await updateInvoice(mutationCtx.db, payload.invoiceId, invoiceUpdates);
      }

      // Recalculate totals
      await recalculateInvoiceTotals(mutationCtx.db, payload.invoiceId);

      // Update work item metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "editDraft",
        taskName: "Edit Draft Invoice",
        priority: "normal",
        invoiceId: payload.invoiceId,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The editDraft work item with actions and lifecycle activities.
 */
export const editDraftWorkItem = Builder.workItem("editDraft")
  .withActions(editDraftWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The editDraft task.
 */
export const editDraftTask = Builder.task(editDraftWorkItem);
