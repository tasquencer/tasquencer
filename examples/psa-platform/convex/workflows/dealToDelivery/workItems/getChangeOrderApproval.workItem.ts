/**
 * GetChangeOrderApproval Work Item
 *
 * Gets client/stakeholder approval for budget increase.
 * Updates budget if approved, handles rejection with escalation.
 *
 * Entry condition: Change order created and pending
 * Exit condition: Change order approved/rejected, budget updated if approved
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject, getProjectByWorkflowId, updateProjectStatus } from "../db/projects";
import { getBudget, updateBudget } from "../db/budgets";
import { listTasksByStatus, updateTaskStatus } from "../db/tasks";
import {
  getChangeOrder,
  listChangeOrdersByProject,
  listPendingChangeOrdersByProject,
  rejectChangeOrder,
  updateChangeOrder,
} from "../db/changeOrders";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertBudgetExists, assertChangeOrderExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:changeOrders:approve' scope
const changeOrdersApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:changeOrders:approve"
);

/**
 * Actions for the getChangeOrderApproval work item.
 *
 * - initialize: Sets up work item metadata with change order context
 * - start: Claims the work item for the current user
 * - complete: Processes approval/rejection, updates budget if approved
 * - fail: Marks the work item as failed
 */
const getChangeOrderApprovalWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      changeOrderId: zid("changeOrders"),
    }),
    changeOrdersApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const changeOrder = await getChangeOrder(
        mutationCtx.db,
        payload.changeOrderId
      );
      assertChangeOrderExists(changeOrder, {
        changeOrderId: payload.changeOrderId,
      });

      const project = await getProject(mutationCtx.db, changeOrder.projectId);
      assertProjectExists(project, { projectId: changeOrder.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:changeOrders:approve",
        dealId: project.dealId!,
        payload: {
          type: "getChangeOrderApproval",
          taskName: "Get Change Order Approval",
          priority: "urgent",
          changeOrderId: payload.changeOrderId,
        },
      });
    }
  )
  .start(z.never(), changeOrdersApprovePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      changeOrderId: zid("changeOrders"),
      approved: z.boolean(),
      approverName: z.string().optional(),
      approverEmail: z.string().email().optional(),
      comments: z.string().optional(),
      approvedAmount: z.number().min(0).optional(), // May approve partial amount
    }),
    changeOrdersApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const changeOrder = await getChangeOrder(
        mutationCtx.db,
        payload.changeOrderId
      );
      assertChangeOrderExists(changeOrder, {
        changeOrderId: payload.changeOrderId,
      });

      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (project._id !== changeOrder.projectId) {
        throw new Error(
          `Project mismatch: expected ${project._id}, got ${changeOrder.projectId}`
        );
      }

      if (payload.approved) {
        // Determine approved amount (may be partial)
        const approvedAmount =
          payload.approvedAmount ?? changeOrder.budgetImpact;

        // Get budget
        const budget = await getBudget(mutationCtx.db, project.budgetId!);
        assertBudgetExists(budget, { projectId: project._id });

        // Update budget total
        const newTotal = (budget.totalAmount || 0) + approvedAmount;
        await updateBudget(mutationCtx.db, budget._id, {
          totalAmount: newTotal,
        });

        // Mark change order as approved
        // Note: We use updateChangeOrder to include any extra details
        await updateChangeOrder(mutationCtx.db, changeOrder._id, {
          status: "Approved",
          approvedAt: Date.now(),
        });

        // Update project status back to Active
        await updateProjectStatus(mutationCtx.db, project._id, "Active");

        // Resume paused tasks
        const pausedTasks = await listTasksByStatus(
          mutationCtx.db,
          project._id,
          "OnHold"
        );
        for (const task of pausedTasks) {
          await updateTaskStatus(mutationCtx.db, task._id, "InProgress");
        }

        console.log(
          `Change order ${changeOrder._id} approved for project ${project._id}: ` +
            `+${approvedAmount} cents. New budget total: ${newTotal} cents. ` +
            `${pausedTasks.length} tasks resumed.`
        );
      } else {
        // Mark change order as rejected
        await rejectChangeOrder(mutationCtx.db, changeOrder._id);

        // Log rejection reason for audit
        if (payload.comments) {
          console.log(
            `Change order ${changeOrder._id} rejected for project ${project._id}. ` +
              `Reason: ${payload.comments}`
          );
        }

        // TODO: Trigger escalation or project closure discussion
        // This would typically be done via a scheduled action or workflow routing
        // (deferred:execution-phase-escalation)
        console.log(
          `Change order rejection: Project ${project._id} requires escalation or closure decision.`
        );
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), changeOrdersApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The getChangeOrderApproval work item with actions and lifecycle activities.
 */
export const getChangeOrderApprovalWorkItem = Builder.workItem("getChangeOrderApproval")
  .withActions(getChangeOrderApprovalWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The getChangeOrderApproval task.
 */
export const getChangeOrderApprovalTask = Builder.task(getChangeOrderApprovalWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const project = await getProjectByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertProjectExists(project, { workflowId: parent.workflow.id });

    const pendingChangeOrders = await listPendingChangeOrdersByProject(
      mutationCtx.db,
      project._id
    );
    const changeOrder =
      pendingChangeOrders[0] ??
      (await listChangeOrdersByProject(mutationCtx.db, project._id))[0];

    if (!changeOrder) {
      console.warn(
        `[getChangeOrderApproval] No change orders found for project ${project._id}.`
      );
      return;
    }

    await workItem.initialize({ changeOrderId: changeOrder._id });
  },
});
