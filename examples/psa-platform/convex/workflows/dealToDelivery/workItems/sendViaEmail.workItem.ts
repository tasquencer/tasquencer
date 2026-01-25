/**
 * SendViaEmail Work Item
 *
 * Send invoice to client via email with PDF attachment.
 *
 * Entry condition: sendInvoice completed with method = "email"
 * Exit condition: Email sent, invoice status = "Sent"
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
 * Actions for the sendViaEmail work item.
 */
const sendViaEmailWorkItemActions = authService.builders.workItemActions
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
          type: "sendViaEmail",
          taskName: "Send Invoice via Email",
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
      recipientEmail: z.string().email(),
      recipientName: z.string().optional(),
      ccEmails: z.array(z.string().email()).optional(),
      personalMessage: z.string().optional(),
      attachPdf: z.boolean().default(true),
      includePaymentLink: z.boolean().optional(),
    }),
    invoicesSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "sendViaEmail:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // In a real implementation, this would:
      // 1. Generate invoice PDF from template
      // 2. Compose email with attachment
      // 3. Send email with tracking
      // For now, we just mark the invoice as sent

      await markInvoiceSent(mutationCtx.db, payload.invoiceId);

      // Update metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "sendViaEmail",
        taskName: "Send Invoice via Email",
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
 * The sendViaEmail work item with actions and lifecycle activities.
 */
export const sendViaEmailWorkItem = Builder.workItem("sendViaEmail")
  .withActions(sendViaEmailWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The sendViaEmail task.
 */
export const sendViaEmailTask = Builder.task(sendViaEmailWorkItem);
