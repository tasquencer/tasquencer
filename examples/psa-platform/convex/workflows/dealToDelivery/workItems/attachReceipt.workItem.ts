/**
 * AttachReceipt Work Item
 *
 * Attach receipt documentation to an expense.
 * Receipt is required for expenses > $25.
 *
 * Entry condition: Expense record created in Draft status
 * Exit condition: Receipt attached or marked as not available
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
import { getExpense, updateExpense } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:edit:own' scope
const expensesEditPolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:edit:own"
);

// Threshold for receipt requirement (in cents)
const RECEIPT_REQUIRED_THRESHOLD = 2500; // $25

/**
 * Actions for the attachReceipt work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the current user
 * - complete: Attaches receipt or records reason for no receipt
 * - fail: Marks the work item as failed
 */
const attachReceiptWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      expenseId: zid("expenses"),
    }),
    expensesEditPolicy,
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
        scope: "dealToDelivery:expenses:edit:own",
        dealId: deal._id,
        payload: {
          type: "attachReceipt",
          taskName: "Attach Receipt",
          priority: "normal",
          expenseId: payload.expenseId,
        },
      });
    }
  )
  .start(z.never(), expensesEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      expenseId: zid("expenses"),
      receiptUrl: z.string().optional(),
      noReceiptReason: z.string().optional(),
    }),
    expensesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "attachReceipt:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      // Validate expense belongs to current user
      if (expense.userId !== userId) {
        throw new Error("Cannot modify expenses belonging to other users");
      }

      // Validate expense is in Draft status
      if (expense.status !== "Draft") {
        throw new Error(
          `Expense must be in Draft status to attach receipt. Current status: ${expense.status}`
        );
      }

      // Check if receipt is required but not provided
      // Spec: Receipt required for expenses >$25 (not >=) or subcontractor expenses
      const receiptRequired = expense.amount > RECEIPT_REQUIRED_THRESHOLD ||
        expense.type === "Subcontractor";

      if (receiptRequired && !payload.receiptUrl && !payload.noReceiptReason) {
        throw new Error(
          `Receipt is required for expenses over $${RECEIPT_REQUIRED_THRESHOLD / 100} or subcontractor expenses. ` +
          `Please provide a receipt or explanation for why it's not available.`
        );
      }

      // Update expense with receipt info
      if (payload.receiptUrl || payload.noReceiptReason) {
        await updateExpense(mutationCtx.db, payload.expenseId, {
          ...(payload.receiptUrl && { receiptUrl: payload.receiptUrl }),
          ...(payload.noReceiptReason && { noReceiptReason: payload.noReceiptReason }),
        });
      }

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "attachReceipt",
          taskName: "Attach Receipt",
          priority: "normal",
          expenseId: payload.expenseId,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The attachReceipt work item with actions and lifecycle activities.
 */
export const attachReceiptWorkItem = Builder.workItem("attachReceipt")
  .withActions(attachReceiptWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The attachReceipt task.
 */
export const attachReceiptTask = Builder.task(attachReceiptWorkItem);
