/**
 * ReviewExpense Work Item
 *
 * Manager reviews submitted expense and decides to approve or reject.
 * Routes to approveExpense or rejectExpense based on decision.
 *
 * Entry condition: Expense exists with status = "Submitted", reviewer has approval scope
 * Exit condition: Decision recorded, routed to approve or reject work item
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
import { getExpense, updateExpense } from "../db/expenses";
import type { ExpenseType } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkExpensePolicyLimit } from "../db/expensePolicyLimits";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
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
 * Actions for the reviewExpense work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the reviewer
 * - complete: Records approval decision and routes accordingly
 * - fail: Marks the work item as failed
 */
const reviewExpenseWorkItemActions = authService.builders.workItemActions
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

      // Validate expense exists and is in Submitted status
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      if (expense.status !== "Submitted") {
        throw new Error(
          `Expense must be in Submitted status to review. Current status: ${expense.status}`
        );
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:approve",
        dealId: deal._id,
        payload: {
          type: "reviewExpense",
          taskName: "Review Expense",
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
      decision: z.enum(["approve", "reject"]),
      comments: z.string().optional(),
      adjustments: z.object({
        billable: z.boolean().optional(),
        markupRate: z.number().min(1.0).max(1.5).optional(),
        category: z.string().optional(),
      }).optional(),
    }),
    expensesApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "reviewExpense:complete",
        workItemId: workItem.id,
      });

      const reviewerId = authUser.userId as Id<"users">;

      // Validate expense exists and is in Submitted status
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      if (expense.status !== "Submitted") {
        throw new Error(
          `Expense must be in Submitted status to review. Current status: ${expense.status}`
        );
      }

      // Prevent self-approval (business rule)
      if (expense.userId === reviewerId) {
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

      if (policyCheck.exceeded && payload.decision === "approve") {
        console.warn(
          `[reviewExpense] ⚠️ Policy limit exceeded for expense ${payload.expenseId}: ${policyCheck.summary}. ` +
          `Review decision: ${payload.decision}. Approving expense that exceeds policy requires acknowledgment.`
        );
      }

      // Check receipt requirement (per spec 10-workflow-expense-approval.md line 282)
      // "Receipt Threshold: Expenses > $25 require receipt"
      if (expense.amount > RECEIPT_REQUIRED_THRESHOLD && !expense.receiptUrl && payload.decision === "approve") {
        console.warn(
          `[reviewExpense] ⚠️ Receipt missing for expense ${payload.expenseId} ($${(expense.amount / 100).toFixed(2)}). ` +
          `Expenses over $25 require receipt attachment. Approving without receipt.`
        );
      }

      // Apply adjustments to the expense if provided (per spec task-reviewexpense.md)
      // Adjustments can include: billable, category (type), markupRate
      if (payload.adjustments) {
        const updates: Parameters<typeof updateExpense>[2] = {};

        if (payload.adjustments.billable !== undefined) {
          updates.billable = payload.adjustments.billable;
        }
        if (payload.adjustments.category !== undefined) {
          // Category maps to expense type (Software, Travel, etc.)
          updates.type = payload.adjustments.category as ExpenseType;
        }
        if (payload.adjustments.markupRate !== undefined) {
          updates.markupRate = payload.adjustments.markupRate;
        }

        // Only update if there are changes
        if (Object.keys(updates).length > 0) {
          await updateExpense(mutationCtx.db, payload.expenseId, updates);
          console.log(
            `[reviewExpense] Applied adjustments to expense ${payload.expenseId}:`,
            updates
          );
        }
      }

      // Store the decision and comments in work item metadata for routing and audit trail
      // The workflow router will read this to determine the next task (approve vs reject)
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "reviewExpense",
        taskName: "Review Expense",
        priority: "normal",
        expenseId: payload.expenseId,
        decision: payload.decision,
        comments: payload.comments, // Persist for audit trail (per spec task-reviewexpense.md)
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviewExpense work item with actions and lifecycle activities.
 */
export const reviewExpenseWorkItem = Builder.workItem("reviewExpense")
  .withActions(reviewExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviewExpense task.
 */
export const reviewExpenseTask = Builder.task(reviewExpenseWorkItem);
