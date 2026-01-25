/**
 * SetBillableRate Work Item
 *
 * Set markup rate for billable expenses.
 * Only executed if the expense was marked as billable.
 *
 * Entry condition: markBillable completed with billable = true
 * Exit condition: Markup rate set, ready for submission
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
import { assertUserHasScope } from "../../../authorization";
import { getExpense, updateExpense } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:edit:own' scope
const expensesEditPolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:edit:own"
);

// Per spec 08-workflow-expense-tracking.md line 426:
// "Markup Limits: Markup cannot exceed 50% without manager override"
// Maximum allowed markup rate (150% = 50% markup) without override
const MAX_MARKUP_RATE = 1.5;
// Maximum markup rate WITH manager override (200% = 100% markup)
const MAX_MARKUP_RATE_WITH_OVERRIDE = 2.0;

/**
 * Actions for the setBillableRate work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the current user
 * - complete: Sets markup rate for billable expense
 * - fail: Marks the work item as failed
 */
const setBillableRateWorkItemActions = authService.builders.workItemActions
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
        // Validate expense exists and is billable
        const expense = await getExpense(mutationCtx.db, payload.expenseId);
        assertExpenseExists(expense, { expenseId: payload.expenseId });

        if (!expense.billable) {
          throw new Error(
            "Cannot set billable rate on non-billable expense"
          );
        }
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:edit:own",
        dealId: deal._id,
        payload: {
          type: "setBillableRate",
          taskName: "Set Billable Rate",
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
      markupRate: z.number().min(1.0).max(MAX_MARKUP_RATE_WITH_OVERRIDE),
      // Per spec 08-workflow-expense-tracking.md line 426: manager override allows > 50% markup
      hasManagerOverride: z.boolean().default(false),
    }),
    expensesEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "setBillableRate:complete",
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
          `Expense must be in Draft status to set billable rate. Current status: ${expense.status}`
        );
      }

      // Validate expense is billable
      if (!expense.billable) {
        throw new Error("Cannot set billable rate on non-billable expense");
      }

      // Validate markup rate is within allowed range
      // Per spec 08-workflow-expense-tracking.md line 426: "Markup cannot exceed 50% without manager override"
      if (payload.markupRate > MAX_MARKUP_RATE && !payload.hasManagerOverride) {
        throw new Error(
          `Markup rate cannot exceed ${(MAX_MARKUP_RATE - 1) * 100}% without manager override. ` +
          `Requested: ${((payload.markupRate - 1) * 100).toFixed(0)}%. ` +
          `Set hasManagerOverride: true if this markup has been approved by a manager.`
        );
      }

      // TENET-AUTHZ: When manager override is used, verify the user has expenses:approve scope
      // This prevents regular team members from bypassing the 50% cap by setting hasManagerOverride=true
      if (payload.hasManagerOverride) {
        try {
          await assertUserHasScope(mutationCtx, "dealToDelivery:expenses:approve");
        } catch {
          throw new Error(
            "Manager override requires 'expenses:approve' permission. " +
            "Only managers can authorize markup rates above 50%."
          );
        }
      }

      // Even with override, cap at absolute maximum
      if (payload.markupRate > MAX_MARKUP_RATE_WITH_OVERRIDE) {
        throw new Error(
          `Markup rate cannot exceed ${(MAX_MARKUP_RATE_WITH_OVERRIDE - 1) * 100}% even with manager override. ` +
          `Requested: ${((payload.markupRate - 1) * 100).toFixed(0)}%`
        );
      }

      // Update expense with markup rate
      await updateExpense(mutationCtx.db, payload.expenseId, {
        markupRate: payload.markupRate,
      });

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "setBillableRate",
          taskName: "Set Billable Rate",
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
 * The setBillableRate work item with actions and lifecycle activities.
 */
export const setBillableRateWorkItem = Builder.workItem("setBillableRate")
  .withActions(setBillableRateWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The setBillableRate task.
 */
export const setBillableRateTask = Builder.task(setBillableRateWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
