/**
 * SendViaPdf Work Item
 *
 * Generate PDF for manual delivery (download or print).
 *
 * Entry condition: sendInvoice completed with method = "pdf"
 * Exit condition: PDF generated, optionally marked as sent
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
 * Actions for the sendViaPdf work item.
 */
const sendViaPdfWorkItemActions = authService.builders.workItemActions
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
          type: "sendViaPdf",
          taskName: "Generate Invoice PDF",
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
      markAsSent: z.boolean().default(false),
    }),
    invoicesSendPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "sendViaPdf:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // In a real implementation, this would:
      // 1. Generate invoice PDF from template
      // 2. Store PDF and provide download URL
      // For now, we just optionally mark as sent

      if (payload.markAsSent) {
        await markInvoiceSent(mutationCtx.db, payload.invoiceId);
      }

      // Update metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "sendViaPdf",
        taskName: "Generate Invoice PDF",
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
 * The sendViaPdf work item with actions and lifecycle activities.
 */
export const sendViaPdfWorkItem = Builder.workItem("sendViaPdf")
  .withActions(sendViaPdfWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The sendViaPdf task.
 */
export const sendViaPdfTask = Builder.task(sendViaPdfWorkItem);
