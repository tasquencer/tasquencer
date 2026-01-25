/**
 * SelectInvoicingMethod Work Item
 *
 * Gateway task to choose the invoicing method for a project.
 * Routes to the appropriate invoice generation task based on selection.
 *
 * Entry condition: Project has billable items (time, expenses, milestones)
 * Exit condition: Invoicing method selected, routing decision made
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { getBudgetByProjectId } from "../db/budgets";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:create' scope
const invoicesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:create"
);

/**
 * Actions for the selectInvoicingMethod work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Records the selected invoicing method
 * - fail: Marks the work item as failed
 */
const selectInvoicingMethodWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    invoicesCreatePolicy,
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
        scope: "dealToDelivery:invoices:create",
        dealId: deal._id,
        payload: {
          type: "selectInvoicingMethod",
          taskName: "Select Invoicing Method",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), invoicesCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      method: z.enum(["TimeAndMaterials", "FixedFee", "Milestone", "Recurring"]),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "selectInvoicingMethod:complete",
        workItemId: workItem.id,
      });

      // Validate project and budget exist
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const budget = await getBudgetByProjectId(mutationCtx.db, payload.projectId);
      if (!budget) {
        throw new Error("Project must have a budget before invoicing");
      }

      // The selected method is passed to the routing decision in the workflow
      // No additional state change needed here - the workflow routes based on the method

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The selectInvoicingMethod work item with actions and lifecycle activities.
 */
export const selectInvoicingMethodWorkItem = Builder.workItem("selectInvoicingMethod")
  .withActions(selectInvoicingMethodWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The selectInvoicingMethod task.
 */
export const selectInvoicingMethodTask = Builder.task(selectInvoicingMethodWorkItem);
