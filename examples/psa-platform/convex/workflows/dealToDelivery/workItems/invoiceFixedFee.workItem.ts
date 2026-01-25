/**
 * InvoiceFixedFee Work Item
 *
 * Create a draft invoice for a fixed fee amount or percentage of budget.
 *
 * Entry condition: selectInvoicingMethod completed with method = "FixedFee"
 * Exit condition: Draft invoice created with fixed fee line item
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
import { listBillableUninvoicedExpenses } from "../db/expenses";
import { insertInvoice, insertInvoiceLineItem, recalculateInvoiceTotals, calculateProjectInvoicedAmount } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:create' scope
const invoicesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:create"
);

/**
 * Actions for the invoiceFixedFee work item.
 */
const invoiceFixedFeeWorkItemActions = authService.builders.workItemActions
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
          type: "invoiceFixedFee",
          taskName: "Create Fixed Fee Invoice",
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
      // Either amount in cents OR percentage of budget
      // Per spec task-invoicefixedfee.md line 30: "Amount must be > 0"
      invoiceAmount: z.number().min(1, "Invoice amount must be greater than 0").optional(),
      percentageOfBudget: z.number().min(1, "Percentage must be greater than 0").max(100).optional(),
      description: z.string().min(1).max(500),
      includeExpenses: z.boolean().default(false),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "invoiceFixedFee:complete",
        workItemId: workItem.id,
      });

      // Validate at least one amount method is specified
      if (!payload.invoiceAmount && !payload.percentageOfBudget) {
        throw new Error("Must specify either invoiceAmount or percentageOfBudget");
      }

      // Get project and validate
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const budget = await getBudgetByProjectId(mutationCtx.db, payload.projectId);
      if (!budget) {
        throw new Error("Project must have a budget for fixed fee invoicing");
      }

      // Calculate the invoice amount
      let amount: number;
      if (payload.invoiceAmount !== undefined) {
        amount = payload.invoiceAmount;
      } else {
        // Calculate from percentage of budget
        amount = Math.round((budget.totalAmount * (payload.percentageOfBudget! / 100)));
      }

      // Per spec task-invoicefixedfee.md line 30: "Amount must be > 0 and within remaining budget"
      if (amount <= 0) {
        throw new Error("Invoice amount must be greater than 0");
      }

      // Check remaining budget (per spec task-invoicefixedfee.md)
      const invoicedAmount = await calculateProjectInvoicedAmount(mutationCtx.db, payload.projectId);
      const remainingBudget = budget.totalAmount - invoicedAmount;
      if (amount > remainingBudget) {
        throw new Error(
          `Invoice amount ($${(amount / 100).toFixed(2)}) exceeds remaining budget ($${(remainingBudget / 100).toFixed(2)}). ` +
          `Budget: $${(budget.totalAmount / 100).toFixed(2)}, Already invoiced: $${(invoicedAmount / 100).toFixed(2)}.`
        );
      }

      // Create the draft invoice
      const invoiceId = await insertInvoice(mutationCtx.db, {
        organizationId: project.organizationId,
        projectId: payload.projectId,
        companyId: project.companyId,
        status: "Draft",
        method: "FixedFee",
        subtotal: 0,
        tax: 0,
        total: 0,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      });

      // Create the fixed fee line item
      await insertInvoiceLineItem(mutationCtx.db, {
        invoiceId,
        description: payload.description,
        quantity: 1,
        rate: amount,
        amount,
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

      // Update work item metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "invoiceFixedFee",
        taskName: "Create Fixed Fee Invoice",
        priority: "normal",
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The invoiceFixedFee work item with actions and lifecycle activities.
 */
export const invoiceFixedFeeWorkItem = Builder.workItem("invoiceFixedFee")
  .withActions(invoiceFixedFeeWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The invoiceFixedFee task.
 */
export const invoiceFixedFeeTask = Builder.task(invoiceFixedFeeWorkItem);
