/**
 * InvoiceMilestone Work Item
 *
 * Create a draft invoice for a completed project milestone.
 *
 * Entry condition: selectInvoicingMethod completed with method = "Milestone"
 * Exit condition: Draft invoice created for milestone amount
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
import { getMilestone, markMilestoneInvoiced, updateMilestone } from "../db/milestones";
import { listBillableUninvoicedExpenses } from "../db/expenses";
import { insertInvoice, insertInvoiceLineItem, recalculateInvoiceTotals } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertMilestoneExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:create' scope
const invoicesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:create"
);

/**
 * Actions for the invoiceMilestone work item.
 */
const invoiceMilestoneWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
      milestoneId: zid("milestones").optional(),
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
          type: "invoiceMilestone",
          taskName: "Create Milestone Invoice",
          priority: "normal",
          milestoneId: payload.milestoneId,
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
      milestoneId: zid("milestones"),
      completionDate: z.number().optional(),
      includeExpenses: z.boolean().default(false),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "invoiceMilestone:complete",
        workItemId: workItem.id,
      });

      // Get project and validate
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Get and validate milestone
      const milestone = await getMilestone(mutationCtx.db, payload.milestoneId);
      assertMilestoneExists(milestone, { milestoneId: payload.milestoneId });

      // Validate milestone belongs to project
      if (milestone.projectId !== payload.projectId) {
        throw new Error("Milestone does not belong to this project");
      }

      // Validate milestone hasn't been invoiced already
      if (milestone.invoiceId) {
        throw new Error("This milestone has already been invoiced");
      }

      // Mark milestone as completed if not already (per spec task-invoicemilestone.md: use completionDate if provided)
      if (!milestone.completedAt) {
        // Use provided completionDate if specified, otherwise use current time
        const completionDate = payload.completionDate ?? Date.now();
        await updateMilestone(mutationCtx.db, payload.milestoneId, { completedAt: completionDate });
      }

      // Create the draft invoice
      const invoiceId = await insertInvoice(mutationCtx.db, {
        organizationId: project.organizationId,
        projectId: payload.projectId,
        companyId: project.companyId,
        status: "Draft",
        method: "Milestone",
        subtotal: 0,
        tax: 0,
        total: 0,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      });

      // Create the milestone line item
      await insertInvoiceLineItem(mutationCtx.db, {
        invoiceId,
        description: `Milestone: ${milestone.name}`,
        quantity: 1,
        rate: milestone.amount,
        amount: milestone.amount,
        sortOrder: 0,
      });

      // Add expenses if requested
      if (payload.includeExpenses) {
        const expenses = await listBillableUninvoicedExpenses(
          mutationCtx.db,
          payload.projectId
        );

        for (const expense of expenses) {
          const markupRate = expense.markupRate ?? 1.0;
          const expenseAmount = Math.round(expense.amount * markupRate);

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: `Expense: ${expense.description}`,
            quantity: 1,
            rate: expense.amount,
            amount: expenseAmount,
            sortOrder: 0,
            expenseIds: [expense._id],
          });
        }
      }

      // Recalculate totals
      await recalculateInvoiceTotals(mutationCtx.db, invoiceId);

      // Link the milestone to the invoice (prevents double-invoicing per spec 11 line 444 "Milestone Once" rule)
      await markMilestoneInvoiced(mutationCtx.db, payload.milestoneId, invoiceId);

      // Update work item metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "invoiceMilestone",
        taskName: "Create Milestone Invoice",
        priority: "normal",
        milestoneId: payload.milestoneId,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The invoiceMilestone work item with actions and lifecycle activities.
 */
export const invoiceMilestoneWorkItem = Builder.workItem("invoiceMilestone")
  .withActions(invoiceMilestoneWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The invoiceMilestone task.
 */
export const invoiceMilestoneTask = Builder.task(invoiceMilestoneWorkItem);
