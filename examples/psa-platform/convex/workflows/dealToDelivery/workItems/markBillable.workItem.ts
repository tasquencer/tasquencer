/**
 * MarkBillable Work Item
 *
 * Set whether expense should be billed to client.
 * Routes to setBillableRate if billable, or skips to submitExpense if not.
 *
 * Entry condition: Receipt attached or marked as not available
 * Exit condition: Billable status set, routed to appropriate next step
 *
 * Reference: .review/recipes/psa-platform/specs/08-workflow-expense-tracking.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import {
  initializeDealWorkItemAuth,
  initializeWorkItemWithProjectAuth,
  updateWorkItemMetadataPayload,
} from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getExpense, updateExpense } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:edit:own' scope
const expensesEditPolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:edit:own"
);

/**
 * Actions for the markBillable work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the current user
 * - complete: Sets billable status and routes accordingly
 * - fail: Marks the work item as failed
 */
const markBillableWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      expenseId: zid("expenses").optional(),
      projectId: zid("projects").optional(),
    }),
    expensesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      if (payload.expenseId) {
        // Validate expense exists
        const expense = await getExpense(mutationCtx.db, payload.expenseId);
        assertExpenseExists(expense, { expenseId: payload.expenseId });
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:edit:own",
        dealId: deal._id,
        payload: {
          type: "markBillable",
          taskName: "Mark Billable Status",
          priority: "normal",
          ...(payload.expenseId ? { expenseId: payload.expenseId } : {}),
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
      billable: z.boolean(),
      billableReason: z.string().optional(),
    }),
    expensesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "markBillable:complete",
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
          `Expense must be in Draft status to mark billable. Current status: ${expense.status}`
        );
      }

      // Update expense with billable status
      await updateExpense(mutationCtx.db, payload.expenseId, {
        billable: payload.billable,
        // Default markup to 1.0 (no markup) if billable, otherwise undefined
        markupRate: payload.billable ? 1.0 : undefined,
        // Store reason for billable/non-billable decision (audit trail)
        ...(payload.billableReason && { billableReason: payload.billableReason }),
      });

      // Update work item metadata with routing decision
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "markBillable",
        taskName: "Mark Billable Status",
        priority: "normal",
        expenseId: payload.expenseId,
        isBillable: payload.billable,
      });

      // The billable status is stored in the work item result for routing
      // The workflow router will read this to determine if setBillableRate is needed
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The markBillable work item with actions and lifecycle activities.
 */
export const markBillableWorkItem = Builder.workItem("markBillable")
  .withActions(markBillableWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The markBillable task.
 */
export const markBillableTask = Builder.task(markBillableWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
