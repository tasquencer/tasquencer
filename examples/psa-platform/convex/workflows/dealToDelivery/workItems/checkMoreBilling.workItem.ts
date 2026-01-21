/**
 * CheckMoreBilling Work Item
 *
 * Determine if more billing cycles are needed for project.
 *
 * Entry condition: Payment recorded or billing cycle completed
 * Exit condition: Decision made on whether more billing is needed
 *
 * Reference: .review/recipes/psa-platform/specs/12-workflow-billing-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { getBudgetByProjectId } from "../db/budgets";
import { listBillableUninvoicedTimeEntries } from "../db/timeEntries";
import { listBillableUninvoicedExpenses } from "../db/expenses";
import { listUninvoicedMilestones } from "../db/milestones";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:invoices:view:all' scope
const invoicesViewPolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:view:all"
);

/**
 * Actions for the checkMoreBilling work item.
 */
const checkMoreBillingWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    invoicesViewPolicy,
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
        scope: "dealToDelivery:invoices:view:all",
        dealId: deal._id,
        payload: {
          type: "checkMoreBilling",
          taskName: "Check More Billing",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), invoicesViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
    }),
    invoicesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "checkMoreBilling:complete",
        workItemId: workItem.id,
      });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Check for uninvoiced items
      const uninvoicedTime = await listBillableUninvoicedTimeEntries(
        mutationCtx.db,
        payload.projectId
      );

      const uninvoicedExpenses = await listBillableUninvoicedExpenses(
        mutationCtx.db,
        payload.projectId
      );

      const uninvoicedMilestones = await listUninvoicedMilestones(
        mutationCtx.db,
        payload.projectId
      );

      // Check for recurring billing
      const budget = await getBudgetByProjectId(mutationCtx.db, payload.projectId);
      const isRetainer = budget?.type === "Retainer";
      // In a real implementation, we would check if recurring billing is due
      // For now, we just check if it's a retainer
      const nextBillingDue = isRetainer;

      // Determine if more billing is needed (used for workflow routing)
      const moreBillingCycles =
        uninvoicedTime.length > 0 ||
        uninvoicedExpenses.length > 0 ||
        uninvoicedMilestones.length > 0 ||
        nextBillingDue;

      // Update metadata with counts for UI display and routing decision (per spec task-checkmorebilling.md)
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "checkMoreBilling",
        taskName: "Check More Billing",
        priority: "normal",
        uninvoicedTimeCount: uninvoicedTime.length,
        uninvoicedExpensesCount: uninvoicedExpenses.length,
        uninvoicedMilestonesCount: uninvoicedMilestones.length,
        isRetainer,
        moreBillingCycles, // Store decision for workflow routing
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The checkMoreBilling work item with actions and lifecycle activities.
 */
export const checkMoreBillingWorkItem = Builder.workItem("checkMoreBilling")
  .withActions(checkMoreBillingWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The checkMoreBilling task.
 */
export const checkMoreBillingTask = Builder.task(checkMoreBillingWorkItem);
