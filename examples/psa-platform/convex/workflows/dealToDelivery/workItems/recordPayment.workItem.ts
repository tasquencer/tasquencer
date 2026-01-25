/**
 * RecordPayment Work Item
 *
 * Record payment received against invoice.
 *
 * Entry condition: Invoice has been sent (status = "Sent" or "Viewed")
 * Exit condition: Payment recorded, invoice status updated if fully paid
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
import { getInvoice, recordPaymentAndCheckPaid } from "../db/invoices";
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:payments:record' scope
const paymentsRecordPolicy = authService.policies.requireScope(
  "dealToDelivery:payments:record"
);

/**
 * Actions for the recordPayment work item.
 */
const recordPaymentWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      invoiceId: zid("invoices"),
    }),
    paymentsRecordPolicy,
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
        scope: "dealToDelivery:payments:record",
        dealId: deal._id,
        payload: {
          type: "recordPayment",
          taskName: "Record Payment",
          priority: "normal",
          invoiceId: payload.invoiceId,
        },
      });
    }
  )
  .start(z.never(), paymentsRecordPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      invoiceId: zid("invoices"),
      amount: z.number().positive(),
      date: z.number(),
      method: z.enum(["Check", "ACH", "Wire", "CreditCard", "Cash", "Other"]),
      reference: z.string().optional(),
      notes: z.string().optional(),
    }),
    paymentsRecordPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "recordPayment:complete",
        workItemId: workItem.id,
      });

      // Validate invoice exists
      const invoice = await getInvoice(mutationCtx.db, payload.invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }

      // Validate invoice status per spec task-recordpayment.md:
      // "Select invoice (Sent or Viewed)" - only allow payments on invoices that have been sent
      if (invoice.status !== "Sent" && invoice.status !== "Viewed") {
        throw new Error(
          `Cannot record payment for invoice in ${invoice.status} status. ` +
          `Invoice must be in Sent or Viewed status.`
        );
      }

      // Get project for organizationId
      const project = await getProject(mutationCtx.db, invoice.projectId);
      assertProjectExists(project, { projectId: invoice.projectId });

      // Record the payment (includes overpayment calculation)
      const { overpaymentAmount } = await recordPaymentAndCheckPaid(mutationCtx.db, {
        organizationId: project!.organizationId,
        invoiceId: payload.invoiceId,
        amount: payload.amount,
        date: payload.date,
        method: payload.method,
        reference: payload.reference,
        notes: payload.notes, // Per spec task-recordpayment.md: persist notes
        syncedToAccounting: false,
        createdAt: Date.now(),
      });

      // Log overpayment warning if applicable per spec 12-workflow-billing-phase.md line 399
      if (overpaymentAmount > 0) {
        console.warn(
          `[recordPayment] OVERPAYMENT WARNING: Payment of ${payload.amount} cents ` +
          `exceeds remaining balance by ${overpaymentAmount} cents. ` +
          `Invoice ID: ${payload.invoiceId}`
        );
      }

      // Update metadata with overpayment info for UI display (per spec task-recordpayment.md)
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "recordPayment",
        taskName: "Record Payment",
        priority: "normal",
        invoiceId: payload.invoiceId,
        overpaymentAmount: overpaymentAmount > 0 ? overpaymentAmount : undefined,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), paymentsRecordPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The recordPayment work item with actions and lifecycle activities.
 */
export const recordPaymentWorkItem = Builder.workItem("recordPayment")
  .withActions(recordPaymentWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The recordPayment task.
 */
export const recordPaymentTask = Builder.task(recordPaymentWorkItem);
