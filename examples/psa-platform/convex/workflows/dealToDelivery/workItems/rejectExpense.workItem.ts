/**
 * RejectExpense Work Item
 *
 * Reject expense with feedback for correction.
 *
 * Entry condition: reviewExpense completed with decision = "reject"
 * Exit condition: Expense status = "Rejected", team member notified
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
import { getExpense, rejectExpenseWithRevisionTracking } from "../db/expenses";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { getUser, listUsersByOrganization } from "../db/users";
import {
  insertNotification,
  generateExpenseRejectedContent,
  generateExpenseEscalatedContent,
} from "../db/notifications";
import { assertExpenseExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { MAX_REVISION_CYCLES } from "../db/revisionCycle";

// Policy: Requires 'dealToDelivery:expenses:approve' scope (approvers can also reject)
const expensesApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:approve"
);

// Issue types for expense rejection
const issueTypeSchema = z.enum([
  "missing_receipt",
  "wrong_category",
  "invalid_amount",
  "missing_vendor_info",
  "not_project_related",
  "duplicate",
  "other",
]);

/**
 * Actions for the rejectExpense work item.
 *
 * - initialize: Sets up work item metadata with expense context
 * - start: Claims the work item for the rejector
 * - complete: Marks expense as rejected with feedback
 * - fail: Marks the work item as failed
 */
const rejectExpenseWorkItemActions = authService.builders.workItemActions
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
          type: "rejectExpense",
          taskName: "Reject Expense",
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
      rejectionReason: z.string().min(1),
      issues: z.array(
        z.object({
          type: issueTypeSchema,
          details: z.string(),
        })
      ).min(1),
    }),
    expensesApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "rejectExpense:complete",
        workItemId: workItem.id,
      });

      // Validate expense exists
      const expense = await getExpense(mutationCtx.db, payload.expenseId);
      assertExpenseExists(expense, { expenseId: payload.expenseId });

      // Build rejection comments with issues
      const issuesList = payload.issues
        .map((issue) => `- ${issue.type}: ${issue.details}`)
        .join("\n");
      const fullComments = `${payload.rejectionReason}\n\nIssues:\n${issuesList}`;

      // Reject the expense with revision tracking (per spec 10-workflow-expense-approval.md line 288)
      const result = await rejectExpenseWithRevisionTracking(
        mutationCtx.db,
        payload.expenseId,
        fullComments,
        payload.issues,
        MAX_REVISION_CYCLES
      );

      // Update work item metadata with escalation status
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "rejectExpense",
          taskName: result.escalated ? "Reject Expense (Escalated to Admin)" : "Reject Expense",
          priority: result.escalated ? "high" : "normal",
          expenseId: payload.expenseId,
        });
      }

      // Notify team member that their expense was rejected
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      const rejectedContent = generateExpenseRejectedContent(
        expense.amount,
        payload.rejectionReason
      );

      await insertNotification(mutationCtx.db, {
        organizationId: deal.organizationId,
        userId: expense.userId,
        type: "expense_rejected",
        resourceType: "expense",
        resourceId: payload.expenseId,
        title: rejectedContent.title,
        message: rejectedContent.message,
        data: {
          expenseId: payload.expenseId,
          rejectionReason: payload.rejectionReason,
          issues: payload.issues,
          escalated: result.escalated,
        },
      });

      // If escalated, also notify admin (per spec 10-workflow-expense-approval.md line 288)
      if (result.escalated) {
        // Find admin users in the organization
        const allUsers = await listUsersByOrganization(mutationCtx.db, deal.organizationId);
        const adminUsers = allUsers.filter((u) => u.role === "psa_admin");

        // Get submitting user's name for the escalation notification
        const submittingUser = await getUser(mutationCtx.db, expense.userId);
        const userName = submittingUser?.name ?? "Team member";

        const escalationContent = generateExpenseEscalatedContent(
          userName,
          result.newRevisionCount
        );

        for (const admin of adminUsers) {
          await insertNotification(mutationCtx.db, {
            organizationId: deal.organizationId,
            userId: admin._id,
            type: "expense_escalated",
            resourceType: "expense",
            resourceId: payload.expenseId,
            title: escalationContent.title,
            message: escalationContent.message,
            data: {
              expenseId: payload.expenseId,
              submittedBy: expense.userId,
              submittedByName: userName,
              revisionCount: result.newRevisionCount,
            },
          });
        }
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The rejectExpense work item with actions and lifecycle activities.
 */
export const rejectExpenseWorkItem = Builder.workItem("rejectExpense")
  .withActions(rejectExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The rejectExpense task.
 */
export const rejectExpenseTask = Builder.task(rejectExpenseWorkItem);
