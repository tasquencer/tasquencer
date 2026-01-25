/**
 * SendViaPortal Work Item
 *
 * Make invoice available in client portal and notify client.
 *
 * Entry condition: sendInvoice completed with method = "portal"
 * Exit condition: Invoice visible in portal, notification sent, status = "Sent"
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
import { getInvoice, markInvoiceSent } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:send' scope
const invoicesSendPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:send"
);

/**
 * Actions for the sendViaPortal work item.
 */
const sendViaPortalWorkItemActions = authService.builders.workItemActions
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

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:invoices:send",
        dealId: deal._id,
        payload: {
          type: "sendViaPortal",
          taskName: "Publish Invoice to Portal",
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
      clientUserId: zid("users").optional(),
      notifyAllContacts: z.boolean().default(false),
      portalMessage: z.string().optional(),
    }),
    invoicesSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "sendViaPortal:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // In a real implementation, this would:
      // 1. Create portal invoice view link
      // 2. Set invoice visible in client portal
      // 3. Send portal notification email to client contacts
      // For now, we just mark the invoice as sent

      await markInvoiceSent(mutationCtx.db, payload.invoiceId);

      // Update metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "sendViaPortal",
        taskName: "Publish Invoice to Portal",
        priority: "normal",
        invoiceId: payload.invoiceId,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesSendPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The sendViaPortal work item with actions and lifecycle activities.
 */
export const sendViaPortalWorkItem = Builder.workItem("sendViaPortal")
  .withActions(sendViaPortalWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The sendViaPortal task.
 */
export const sendViaPortalTask = Builder.task(sendViaPortalWorkItem);
