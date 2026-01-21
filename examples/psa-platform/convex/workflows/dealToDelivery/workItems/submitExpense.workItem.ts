/**
 * SubmitExpense Work Item
 *
 * Submit expense for manager approval.
 *
 * Entry condition: Expense in Draft status with billable status set
 * Exit condition: Expense status changed to "Submitted", manager notified
 *
 * Reference: .review/recipes/psa-platform/specs/08-workflow-expense-tracking.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getExpense, updateExpenseStatus } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkExpenseDateLimits } from "../db/dateLimits";
import { getUser } from "../db/users";
import {
  insertNotification,
  generateExpenseSubmittedContent,
} from "../db/notifications";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Receipt requirement threshold (in cents) - per spec 08-workflow-expense-tracking.md line 374
const RECEIPT_REQUIRED_THRESHOLD = 2500; // $25

// Policy: Requires 'dealToDelivery:expenses:submit' scope
const expensesSubmitPolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:submit"
);

/**
 * Actions for the submitExpense work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the current user
 * - complete: Submits expense for approval
 * - fail: Marks the work item as failed
 */
const submitExpenseWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      expenseId: zid("expenses"),
    }),
    expensesSubmitPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate expense exists and is in Draft status
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      if (expense.status !== "Draft") {
        throw new Error(
          `Expense must be in Draft status to submit. Current status: ${expense.status}`
        );
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:submit",
        dealId: deal._id,
        payload: {
          type: "submitExpense",
          taskName: "Submit Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        },
      });
    }
  )
  .start(z.never(), expensesSubmitPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      expenseId: zid("expenses"),
    }),
    expensesSubmitPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "submitExpense:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      // Validate expense belongs to current user
      if (expense.userId !== userId) {
        throw new Error("Cannot submit expenses belonging to other users");
      }

      // Validate expense is in Draft status
      if (expense.status !== "Draft") {
        throw new Error(
          `Expense must be in Draft status to submit. Current status: ${expense.status}`
        );
      }

      // Validate receipt requirement per spec 08-workflow-expense-tracking.md line 374
      // Receipt is required for expenses > $25
      const receiptRequired = expense.amount > RECEIPT_REQUIRED_THRESHOLD ||
        expense.type === "Subcontractor";

      if (receiptRequired && !expense.receiptUrl) {
        throw new Error(
          `Receipt is required for expenses over $${RECEIPT_REQUIRED_THRESHOLD / 100}. ` +
          `Please attach a receipt before submitting.`
        );
      }

      // Check expense date limits (90-day rule)
      // Per spec 08-workflow-expense-tracking.md line 427: "Expenses older than 90 days require approval exception"
      const dateCheck = checkExpenseDateLimits(expense.date);

      if (dateCheck.requiresAdminApproval) {
        // Block submission of expenses older than 90 days without admin approval
        throw new Error(dateCheck.message ?? "Expense is too old and requires admin approval exception");
      }

      if (dateCheck.hasWarning) {
        // Log warning for expenses 30-90 days old
        console.warn(
          `[submitExpense] Date warning for expense ${payload.expenseId}: ${dateCheck.message}`
        );
      }

      // Update status to "Submitted"
      await updateExpenseStatus(mutationCtx.db, payload.expenseId, "Submitted");

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "submitExpense",
          taskName: "Submit Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        });
      }

      // Notify project manager about submitted expense
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );
      const submittingUser = await getUser(mutationCtx.db, userId);
      const userName = submittingUser?.name ?? "Team member";
      const content = generateExpenseSubmittedContent(userName, expense.amount);

      await insertNotification(mutationCtx.db, {
        organizationId: deal.organizationId,
        userId: deal.ownerId, // Project manager / deal owner
        type: "expense_submitted",
        resourceType: "expense",
        resourceId: payload.expenseId,
        title: content.title,
        message: content.message,
        data: {
          submittedBy: userId,
          submittedByName: userName,
          amount: expense.amount,
          type: expense.type,
          date: expense.date,
          dealId: deal._id,
        },
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesSubmitPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The submitExpense work item with actions and lifecycle activities.
 */
export const submitExpenseWorkItem = Builder.workItem("submitExpense")
  .withActions(submitExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The submitExpense task.
 */
export const submitExpenseTask = Builder.task(submitExpenseWorkItem);
