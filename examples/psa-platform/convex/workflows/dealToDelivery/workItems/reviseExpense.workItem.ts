/**
 * ReviseExpense Work Item
 *
 * Team member revises rejected expense based on feedback.
 *
 * Entry condition: rejectExpense completed, expense in Rejected status
 * Exit condition: Expense revised and optionally resubmitted
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
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:edit:own' scope
const expensesEditOwnPolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:edit:own"
);

/**
 * Actions for the reviseExpense work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the team member
 * - complete: Applies revisions and optionally resubmits
 * - fail: Marks the work item as failed
 */
const reviseExpenseWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      expenseId: zid("expenses"),
    }),
    expensesEditOwnPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate expense exists and is in Rejected status
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      if (expense.status !== "Rejected") {
        throw new Error(
          `Expense must be in Rejected status to revise. Current status: ${expense.status}`
        );
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:edit:own",
        dealId: deal._id,
        payload: {
          type: "reviseExpense",
          taskName: "Revise Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        },
      });
    }
  )
  .start(z.never(), expensesEditOwnPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      expenseId: zid("expenses"),
      revisions: z.object({
        description: z.string().min(1).optional(),
        amount: z.number().positive().optional(),
        date: z.number().optional(),
        type: z.enum(["Travel", "Materials", "Software", "Subcontractor", "Other"]).optional(),
        receiptUrl: z.string().url().optional(),
        vendorInfo: z.object({
          name: z.string(),
          company: z.string().optional(),
          taxId: z.string().optional(),
        }).optional(),
        billable: z.boolean().optional(),
        markupRate: z.number().min(1.0).max(1.5).optional(),
        notes: z.string().optional(),
      }),
      resubmit: z.boolean(),
    }),
    expensesEditOwnPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "reviseExpense:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      // Validate expense belongs to current user
      if (expense.userId !== userId) {
        throw new Error("Cannot revise expenses belonging to other users");
      }

      // Validate expense is in Rejected status
      if (expense.status !== "Rejected") {
        throw new Error(
          `Expense must be in Rejected status to revise. Current status: ${expense.status}`
        );
      }

      // Build updates from revisions
      const updates: Record<string, unknown> = {};

      if (payload.revisions.description !== undefined) {
        updates.description = payload.revisions.description;
      }
      if (payload.revisions.amount !== undefined) {
        updates.amount = payload.revisions.amount;
      }
      if (payload.revisions.date !== undefined) {
        updates.date = payload.revisions.date;
      }
      if (payload.revisions.type !== undefined) {
        updates.type = payload.revisions.type;
      }
      if (payload.revisions.receiptUrl !== undefined) {
        updates.receiptUrl = payload.revisions.receiptUrl;
      }
      if (payload.revisions.vendorInfo !== undefined) {
        updates.vendorInfo = payload.revisions.vendorInfo;
      }
      if (payload.revisions.billable !== undefined) {
        updates.billable = payload.revisions.billable;
      }
      if (payload.revisions.markupRate !== undefined) {
        updates.markupRate = payload.revisions.markupRate;
      }
      if (payload.revisions.notes !== undefined) {
        updates.notes = payload.revisions.notes;
      }

      // Clear rejection comments on revision
      updates.rejectionComments = undefined;

      // Set status based on resubmit flag
      if (payload.resubmit) {
        updates.status = "Submitted";
      } else {
        updates.status = "Draft";
      }

      // Apply updates
      await updateExpense(mutationCtx.db, payload.expenseId, updates);

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "reviseExpense",
          taskName: "Revise Expense",
          priority: "normal",
          expenseId: payload.expenseId,
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesEditOwnPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviseExpense work item with actions and lifecycle activities.
 */
export const reviseExpenseWorkItem = Builder.workItem("reviseExpense")
  .withActions(reviseExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviseExpense task.
 */
export const reviseExpenseTask = Builder.task(reviseExpenseWorkItem);
