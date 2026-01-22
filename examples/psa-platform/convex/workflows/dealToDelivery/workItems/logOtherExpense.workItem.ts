/**
 * LogOtherExpense Work Item
 *
 * Log miscellaneous expenses not fitting other categories.
 *
 * Entry condition: selectExpenseType completed with type = "Other"
 * Exit condition: Other expense record created
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
import { insertExpense } from "../db/expenses";
import { getUser } from "../db/users";
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkExpenseDuplicates } from "../db/duplicateDetection";
import { assertProjectExists, assertUserExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { checkOtherExpensePolicyLimit } from "../db/expensePolicyLimits";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:create' scope
const expensesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:create"
);

/**
 * Actions for the logOtherExpense work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Creates other expense record
 * - fail: Marks the work item as failed
 */
const logOtherExpenseWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    expensesCreatePolicy,
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
        scope: "dealToDelivery:expenses:create",
        dealId: deal._id,
        payload: {
          type: "logOtherExpense",
          taskName: "Log Other Expense",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), expensesCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      description: z.string().min(1),
      amount: z.number().positive(),
      currency: z.string().default("USD"),
      date: z.number(),
      category: z.string().optional(),
      vendor: z.string().optional(),
      notes: z.string().optional(),
    }),
    expensesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "logOtherExpense:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const user = await getUser(mutationCtx.db, userId);
      assertUserExists(user, { userId });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Check policy limits for other expenses ($250 limit, spec 10-workflow-expense-approval.md lines 293-304)
      const policyCheck = checkOtherExpensePolicyLimit(payload.amount);

      // Check for potential duplicates (warn, don't block)
      // Per spec 10-workflow-expense-approval.md line 275: "Not duplicate: No existing expense for same item"
      const duplicateCheck = await checkExpenseDuplicates(mutationCtx.db, {
        userId,
        projectId: payload.projectId,
        date: payload.date,
        amount: payload.amount,
        type: "Other",
        description: payload.description,
      });

      if (duplicateCheck.hasPotentialDuplicates) {
        // Log warning for audit trail - duplicates are warnings, not blockers
        console.warn(
          `[logOtherExpense] Duplicate warning: ${duplicateCheck.warningMessage} ` +
          `(confidence: ${duplicateCheck.confidence}, duplicateIds: ${duplicateCheck.duplicateIds.join(", ")})`
        );
      }

      // Create expense record with policy limit flag
      const expenseId = await insertExpense(mutationCtx.db, {
        organizationId: user.organizationId,
        userId,
        projectId: payload.projectId,
        type: "Other",
        amount: payload.amount,
        currency: payload.currency,
        billable: false, // Will be set in markBillable step
        status: "Draft",
        date: payload.date,
        description: payload.description,
        createdAt: Date.now(),
        ...(payload.vendor && {
          vendorInfo: {
            name: payload.vendor,
          },
        }),
        // Optional notes field (per spec task-logotherexpense.md)
        ...(payload.notes && { notes: payload.notes }),
        // Policy limit tracking
        policyLimitExceeded: policyCheck.exceeded,
        policyLimitDetails: policyCheck.summary ?? undefined,
      });

      // Update work item metadata with the expense ID
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "logOtherExpense",
          taskName: "Log Other Expense",
          priority: "normal",
          expenseId,
        } as any);
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The logOtherExpense work item with actions and lifecycle activities.
 */
export const logOtherExpenseWorkItem = Builder.workItem("logOtherExpense")
  .withActions(logOtherExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The logOtherExpense task.
 */
export const logOtherExpenseTask = Builder.task(logOtherExpenseWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
