/**
 * LogMaterialsExpense Work Item
 *
 * Log materials and supplies expenses.
 *
 * Entry condition: selectExpenseType completed with type = "Materials"
 * Exit condition: Materials expense record created
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
import { assertProjectExists, assertUserExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { checkMaterialsExpensePolicyLimit } from "../db/expensePolicyLimits";
import { checkExpenseDuplicates } from "../db/duplicateDetection";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:create' scope
const expensesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:create"
);

/**
 * Actions for the logMaterialsExpense work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Creates materials expense record
 * - fail: Marks the work item as failed
 */
const logMaterialsExpenseWorkItemActions = authService.builders.workItemActions
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
          type: "logMaterialsExpense",
          taskName: "Log Materials Expense",
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
      vendor: z.string().min(1),
      quantity: z.number().optional(),
      unitCost: z.number().optional(),
      category: z.string().optional(),
      notes: z.string().optional(),
    }),
    expensesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "logMaterialsExpense:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const user = await getUser(mutationCtx.db, userId);
      assertUserExists(user, { userId });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Check policy limits for materials expenses ($1,000 limit, spec 10-workflow-expense-approval.md lines 293-304)
      const policyCheck = checkMaterialsExpensePolicyLimit(payload.amount);

      // Check for potential duplicates (warn, don't block)
      // Per spec 10-workflow-expense-approval.md line 275: "Not duplicate"
      const duplicateCheck = await checkExpenseDuplicates(mutationCtx.db, {
        userId,
        projectId: payload.projectId,
        date: payload.date,
        amount: payload.amount,
        type: "Materials",
        description: payload.description,
      });

      if (duplicateCheck.hasPotentialDuplicates) {
        console.warn(
          `[logMaterialsExpense] Duplicate warning: ${duplicateCheck.warningMessage} ` +
          `(confidence: ${duplicateCheck.confidence}, duplicateIds: ${duplicateCheck.duplicateIds.join(", ")})`
        );
      }

      // Create expense record with policy limit flag
      const expenseId = await insertExpense(mutationCtx.db, {
        organizationId: user.organizationId,
        userId,
        projectId: payload.projectId,
        type: "Materials",
        amount: payload.amount,
        currency: payload.currency,
        billable: false, // Will be set in markBillable step
        status: "Draft",
        date: payload.date,
        description: payload.description,
        createdAt: Date.now(),
        vendorInfo: {
          name: payload.vendor,
        },
        // Policy limit tracking
        policyLimitExceeded: policyCheck.exceeded,
        policyLimitDetails: policyCheck.summary ?? undefined,
        ...(payload.notes && { notes: payload.notes }),
      });

      // Update work item metadata with the expense ID
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "logMaterialsExpense",
          taskName: "Log Materials Expense",
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
 * The logMaterialsExpense work item with actions and lifecycle activities.
 */
export const logMaterialsExpenseWorkItem = Builder.workItem("logMaterialsExpense")
  .withActions(logMaterialsExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The logMaterialsExpense task.
 */
export const logMaterialsExpenseTask = Builder.task(logMaterialsExpenseWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
