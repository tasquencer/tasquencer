/**
 * SendInvoice Work Item
 *
 * Select delivery method for finalized invoice.
 * Routes to the appropriate delivery task based on selection.
 *
 * Entry condition: Invoice exists with status = "Finalized"
 * Exit condition: Delivery method selected, routing decision made
 *
 * Reference: .review/recipes/psa-platform/specs/12-workflow-billing-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getInvoice } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:send' scope
const invoicesSendPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:send"
);

/**
 * Actions for the sendInvoice work item.
 */
const sendInvoiceWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      invoiceId: zid("invoices"),
    }),
    invoicesSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate invoice exists and is finalized
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }
      if (invoice.status !== "Finalized") {
        throw new Error("Invoice must be finalized before sending");
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:invoices:send",
        dealId: deal._id,
        payload: {
          type: "sendInvoice",
          taskName: "Send Invoice",
          priority: "normal",
          invoiceId: payload.invoiceId,
        },
      });
    }
  )
  .start(z.never(), invoicesSendPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      invoiceId: zid("invoices"),
      method: z.enum(["email", "pdf", "portal"]),
    }),
    invoicesSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "sendInvoice:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // Store the selected delivery method in work item metadata for routing
      // The workflow router will read this to determine the delivery task
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "sendInvoice",
        taskName: "Send Invoice",
        priority: "normal",
        invoiceId: payload.invoiceId,
        method: payload.method,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesSendPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The sendInvoice work item with actions and lifecycle activities.
 */
export const sendInvoiceWorkItem = Builder.workItem("sendInvoice")
  .withActions(sendInvoiceWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The sendInvoice task.
 */
export const sendInvoiceTask = Builder.task(sendInvoiceWorkItem);
