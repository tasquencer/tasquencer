/**
 * SelectExpenseType Work Item
 *
 * Choose the expense category for proper classification and routing.
 * Routes to one of: logSoftwareExpense, logTravelExpense, logMaterialsExpense,
 * logSubcontractorExpense, or logOtherExpense.
 *
 * Entry condition: User has expenses:create scope, assigned to project, project status = "Active"
 * Exit condition: Expense type selected, routed to appropriate logging work item
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
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:expenses:create' scope
const expensesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:expenses:create"
);

/**
 * Actions for the selectExpenseType work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Records the selected expense type for routing
 * - fail: Marks the work item as failed
 */
const selectExpenseTypeWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects").optional(),
    }),
    expensesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate project exists if provided
      if (payload.projectId) {
        const project = await getProject(mutationCtx.db, payload.projectId);
        assertProjectExists(project, { projectId: payload.projectId });
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:expenses:create",
        dealId: deal._id,
        payload: {
          type: "selectExpenseType",
          taskName: "Select Expense Type",
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
      expenseType: z.enum(["Software", "Travel", "Materials", "Subcontractor", "Other"]),
      projectId: zid("projects"),
    }),
    expensesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Store the selected expense type in metadata for routing
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "selectExpenseType",
        taskName: "Select Expense Type",
        priority: "normal",
        selectedExpenseType: payload.expenseType,
      });

      // The expense type selection is stored in the work item result for routing
      // The workflow router will read this to determine the next task
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), expensesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The selectExpenseType work item with actions and lifecycle activities.
 */
export const selectExpenseTypeWorkItem = Builder.workItem("selectExpenseType")
  .withActions(selectExpenseTypeWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The selectExpenseType task.
 */
export const selectExpenseTypeTask = Builder.task(selectExpenseTypeWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
