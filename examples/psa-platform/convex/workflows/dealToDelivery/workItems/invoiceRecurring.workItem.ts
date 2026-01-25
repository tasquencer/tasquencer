/**
 * InvoiceRecurring Work Item
 *
 * Create a draft invoice for a recurring/retainer billing period.
 * Supports overage charges and rollover credits.
 *
 * Entry condition: selectInvoicingMethod completed with method = "Recurring"
 * Exit condition: Draft invoice created for retainer period with optional overage
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
import { getProject } from "../db/projects";
import { getBudgetByProjectId } from "../db/budgets";
import { listTimeEntriesByProject } from "../db/timeEntries";
import { insertInvoice, insertInvoiceLineItem, recalculateInvoiceTotals } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:create' scope
const invoicesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:create"
);

/**
 * Actions for the invoiceRecurring work item.
 */
const invoiceRecurringWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:invoices:create",
        dealId: deal._id,
        payload: {
          type: "invoiceRecurring",
          taskName: "Create Recurring Invoice",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), invoicesCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      billingPeriod: z.object({
        startDate: z.number(),
        endDate: z.number(),
      }),
      retainerAmount: z.number().min(0),
      includedHours: z.number().min(0).optional(),
      overageRate: z.number().min(0).optional(),
      includeOverage: z.boolean().default(true),
      rolloverUnused: z.boolean().default(false),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "invoiceRecurring:complete",
        workItemId: workItem.id,
      });

      // Get project and validate
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const budget = await getBudgetByProjectId(mutationCtx.db, payload.projectId);
      if (!budget) {
        throw new Error("Project must have a budget for recurring invoicing");
      }

      // Validate budget type is Retainer
      if (budget.type !== "Retainer") {
        throw new Error("Recurring invoicing is only available for Retainer budgets");
      }

      // Get time entries for the billing period
      const allTimeEntries = await listTimeEntriesByProject(
        mutationCtx.db,
        payload.projectId
      );

      const periodEntries = allTimeEntries.filter(
        (e) =>
          e.date >= payload.billingPeriod.startDate &&
          e.date <= payload.billingPeriod.endDate &&
          e.status === "Approved"
      );

      const hoursUsed = periodEntries.reduce((sum, e) => sum + e.hours, 0);
      const includedHours = payload.includedHours ?? 0;
      const overageHours = Math.max(0, hoursUsed - includedHours);

      // Create the draft invoice
      const invoiceId = await insertInvoice(mutationCtx.db, {
        organizationId: project.organizationId,
        projectId: payload.projectId,
        companyId: project.companyId,
        status: "Draft",
        method: "Recurring",
        subtotal: 0,
        tax: 0,
        total: 0,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      });

      // Format billing period description
      const startDateStr = new Date(payload.billingPeriod.startDate).toLocaleDateString();
      const endDateStr = new Date(payload.billingPeriod.endDate).toLocaleDateString();
      const periodDescription = `${startDateStr} - ${endDateStr}`;

      // Create the retainer line item
      await insertInvoiceLineItem(mutationCtx.db, {
        invoiceId,
        description: `Retainer: ${periodDescription}`,
        quantity: 1,
        rate: payload.retainerAmount,
        amount: payload.retainerAmount,
        sortOrder: 0,
      });

      // Add overage if applicable
      if (payload.includeOverage && overageHours > 0 && payload.overageRate) {
        const overageAmount = Math.round(overageHours * payload.overageRate);

        await insertInvoiceLineItem(mutationCtx.db, {
          invoiceId,
          description: `Additional hours (${overageHours.toFixed(2)} hrs beyond ${includedHours} included)`,
          quantity: overageHours,
          rate: payload.overageRate,
          amount: overageAmount,
          sortOrder: 1,
          timeEntryIds: periodEntries
            .slice(0, Math.ceil(overageHours / (hoursUsed / periodEntries.length || 1)))
            .map((e) => e._id),
        });
      }

      // Add rollover credit if unused hours and rollover enabled
      if (payload.rolloverUnused && hoursUsed < includedHours) {
        const unusedHours = includedHours - hoursUsed;
        // Create a note/credit line (negative amount or zero for tracking)
        await insertInvoiceLineItem(mutationCtx.db, {
          invoiceId,
          description: `Unused hours rollover credit: ${unusedHours.toFixed(2)} hrs`,
          quantity: unusedHours,
          rate: 0,
          amount: 0, // Credit tracked but not applied to invoice total
          sortOrder: 2,
        });
      }

      // Recalculate totals
      await recalculateInvoiceTotals(mutationCtx.db, invoiceId);

      // Update work item metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "invoiceRecurring",
        taskName: "Create Recurring Invoice",
        priority: "normal",
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The invoiceRecurring work item with actions and lifecycle activities.
 */
export const invoiceRecurringWorkItem = Builder.workItem("invoiceRecurring")
  .withActions(invoiceRecurringWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The invoiceRecurring task.
 */
export const invoiceRecurringTask = Builder.task(invoiceRecurringWorkItem);
