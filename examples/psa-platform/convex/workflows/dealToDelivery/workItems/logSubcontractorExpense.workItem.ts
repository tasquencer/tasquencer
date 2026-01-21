/**
 * LogSubcontractorExpense Work Item
 *
 * Log subcontractor or freelancer payments with vendor and tax info.
 *
 * Entry condition: selectExpenseType completed with type = "Subcontractor"
 * Exit condition: Subcontractor expense record created with vendor info
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
import { insertExpense } from "../db/expenses";
import { checkExpenseDuplicates } from "../db/duplicateDetection";
import { getUser } from "../db/users";
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertUserExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:expenses:create' scope
const expensesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:create"
);

// Per spec 08-workflow-expense-tracking.md line 424 and 21-ui-expense-form.md line 189:
// "Tax ID (required for > $600 total)" for subcontractor expenses
const SUBCONTRACTOR_TAX_ID_THRESHOLD = 60000; // $600 in cents

/**
 * Actions for the logSubcontractorExpense work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Creates subcontractor expense record with vendor info
 * - fail: Marks the work item as failed
 */
const logSubcontractorExpenseWorkItemActions = authService.builders.workItemActions
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
          type: "logSubcontractorExpense",
          taskName: "Log Subcontractor Expense",
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
      vendorName: z.string().min(1),
      vendorCompany: z.string().optional(),
      vendorEmail: z.string().optional(),
      vendorTaxId: z.string().optional(),
      invoiceNumber: z.string().optional(),
      workPeriodStart: z.number().optional(),
      workPeriodEnd: z.number().optional(),
      deliverables: z.string().optional(),
      notes: z.string().optional(),
    }),
    expensesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "logSubcontractorExpense:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const user = await getUser(mutationCtx.db, userId);
      assertUserExists(user, { userId });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Per spec 08-workflow-expense-tracking.md line 424 and 21-ui-expense-form.md line 189:
      // Tax ID is required for subcontractor expenses > $600 for 1099 compliance
      if (payload.amount > SUBCONTRACTOR_TAX_ID_THRESHOLD && !payload.vendorTaxId) {
        throw new Error(
          `Vendor Tax ID is required for subcontractor expenses over $${SUBCONTRACTOR_TAX_ID_THRESHOLD / 100} (1099 compliance). ` +
          `Amount: $${(payload.amount / 100).toFixed(2)}`
        );
      }

      // Check for potential duplicates (warn, don't block)
      // Per spec 10-workflow-expense-approval.md line 275: "Not duplicate"
      const duplicateCheck = await checkExpenseDuplicates(mutationCtx.db, {
        userId,
        projectId: payload.projectId,
        date: payload.date,
        amount: payload.amount,
        type: "Subcontractor",
        description: payload.vendorName,
      });

      if (duplicateCheck.hasPotentialDuplicates) {
        console.warn(
          `[logSubcontractorExpense] Duplicate warning: ${duplicateCheck.warningMessage} ` +
          `(confidence: ${duplicateCheck.confidence}, duplicateIds: ${duplicateCheck.duplicateIds.join(", ")})`
        );
      }

      // Create expense record with vendor info
      const expenseId = await insertExpense(mutationCtx.db, {
        organizationId: user.organizationId,
        userId,
        projectId: payload.projectId,
        type: "Subcontractor",
        amount: payload.amount,
        currency: payload.currency,
        billable: false, // Will be set in markBillable step
        status: "Draft",
        date: payload.date,
        description: payload.description,
        createdAt: Date.now(),
        vendorInfo: {
          name: payload.vendorName,
          taxId: payload.vendorTaxId,
        },
        ...(payload.notes && { notes: payload.notes }),
      });

      // Update work item metadata with the expense ID
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "logSubcontractorExpense",
          taskName: "Log Subcontractor Expense",
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
 * The logSubcontractorExpense work item with actions and lifecycle activities.
 */
export const logSubcontractorExpenseWorkItem = Builder.workItem("logSubcontractorExpense")
  .withActions(logSubcontractorExpenseWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The logSubcontractorExpense task.
 */
export const logSubcontractorExpenseTask = Builder.task(logSubcontractorExpenseWorkItem);
