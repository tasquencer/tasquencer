/**
 * ApproveExpense Work Item
 *
 * Finalize approval and mark expense as approved.
 *
 * Entry condition: reviewExpense completed with decision = "approve"
 * Exit condition: Expense status = "Approved", ready for invoicing
 *
 * Reference: .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getExpense, approveExpense, updateExpense } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkExpensePolicyLimit } from "../db/expensePolicyLimits";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

/**
 * Receipt threshold in cents - expenses over this amount require receipt
 * Per spec 10-workflow-expense-approval.md line 282
 */
export const RECEIPT_REQUIRED_THRESHOLD = 2500; // $25 in cents

// Policy: Requires 'dealToDelivery:expenses:approve' scope
const expensesApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:approve"
);

/**
 * Actions for the approveExpense work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the approver
 * - complete: Marks expense as approved with timestamp
 * - fail: Marks the work item as failed
 */
const approveExpenseWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      expenseId: zid("expenses"),
    }),
    expensesApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:approve",
        dealId: deal._id,
        payload: {
          type: "approveExpense",
          taskName: "Approve Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        },
      });
    }
  )
  .start(z.never(), expensesApprovePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      expenseId: zid("expenses"),
      approvalNotes: z.string().optional(),
      finalBillable: z.boolean().optional(),
      finalMarkup: z.number().min(1.0).max(1.5).optional(),
    }),
    expensesApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "approveExpense:complete",
        workItemId: workItem.id,
      });

      const approverId = authUser.userId as Id<"users">;

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      // Prevent self-approval (business rule)
      if (expense.userId === approverId) {
        throw new Error(
          "Cannot approve your own expenses. Please request another manager to review."
        );
      }

      // Check policy limits (per spec 10-workflow-expense-approval.md lines 288-289)
      // "Policy Limits: Flag expenses exceeding policy limits for additional review"
      const policyCheck = checkExpensePolicyLimit(
        expense.type,
        expense.amount
      );

      if (policyCheck.exceeded) {
        console.warn(
          `[approveExpense] ⚠️ Policy limit exceeded for expense ${payload.expenseId}: ${policyCheck.summary}. ` +
          `Approving expense that exceeds policy limit.`
        );
      }

      // Check receipt requirement (per spec 10-workflow-expense-approval.md line 282)
      // "Receipt Threshold: Expenses > $25 require receipt"
      if (expense.amount > RECEIPT_REQUIRED_THRESHOLD && !expense.receiptUrl) {
        console.warn(
          `[approveExpense] ⚠️ Receipt missing for expense ${payload.expenseId} ($${(expense.amount / 100).toFixed(2)}). ` +
          `Expenses over $25 require receipt attachment. Approving without receipt.`
        );
      }

      // Apply any final adjustments before approval
      if (payload.finalBillable !== undefined || payload.finalMarkup !== undefined) {
        const updates: Record<string, unknown> = {};
        if (payload.finalBillable !== undefined) {
          updates.billable = payload.finalBillable;
        }
        if (payload.finalMarkup !== undefined) {
          updates.markupRate = payload.finalMarkup;
        }
        await updateExpense(mutationCtx.db, payload.expenseId, updates);
      }

      // Approve the expense
      await approveExpense(mutationCtx.db, payload.expenseId, approverId);

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "approveExpense",
          taskName: "Approve Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The approveExpense work item with actions and lifecycle activities.
 */
export const approveExpenseWorkItem = Builder.workItem("approveExpense")
  .withActions(approveExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The approveExpense task.
 */
export const approveExpenseTask = Builder.task(approveExpenseWorkItem);
