/**
 * RequestChangeOrder Work Item
 *
 * Creates a change order request for additional budget.
 * Prepares documentation for client approval.
 *
 * Entry condition: Work paused due to budget overrun
 * Exit condition: Change order created with status = "Pending"
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { getBudget } from "../db/budgets";
import { insertChangeOrder } from "../db/changeOrders";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertBudgetExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:changeOrders:request' scope
const changeOrdersRequestPolicy = authService.policies.requireScope(
  "dealToDelivery:changeOrders:request"
);

/**
 * Actions for the requestChangeOrder work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Creates change order record
 * - fail: Marks the work item as failed
 */
const requestChangeOrderWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    changeOrdersRequestPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:changeOrders:request",
        dealId: project.dealId!,
        payload: {
          type: "requestChangeOrder",
          taskName: "Request Change Order",
          priority: "high",
        },
      });
    }
  )
  .start(z.never(), changeOrdersRequestPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      description: z.string().min(1),
      budgetImpact: z.number().min(0), // Additional amount in cents
      justification: z.string().min(1),
      additionalServices: z
        .array(
          z.object({
            name: z.string(),
            rate: z.number().min(0), // Rate in cents
            hours: z.number().min(0),
          })
        )
        .optional(),
      scopeChanges: z.string().optional(),
    }),
    changeOrdersRequestPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (project._id !== payload.projectId) {
        throw new Error(
          `Project mismatch: expected ${project._id}, got ${payload.projectId}`
        );
      }

      // Get authenticated user for tracking who requested
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "requestChangeOrder",
        workItemId: workItem.id,
      });
      const requestedBy = authUser.userId as Id<"users">;

      // Get current budget
      const budget = await getBudget(mutationCtx.db, project.budgetId!);
      assertBudgetExists(budget, { projectId: project._id });

      // Calculate new projected total
      const currentTotal = budget.totalAmount || 0;
      const newTotal = currentTotal + payload.budgetImpact;

      const now = Date.now();

      // Create change order record (per spec task-requestchangeorder.md: persist all fields)
      const changeOrderId = await insertChangeOrder(mutationCtx.db, {
        organizationId: project.organizationId,
        projectId: project._id,
        description: payload.description,
        justification: payload.justification, // Required per spec
        budgetImpact: payload.budgetImpact,
        status: "Pending",
        additionalServices: payload.additionalServices, // Optional per spec
        scopeChanges: payload.scopeChanges, // Optional per spec
        requestedBy,
        createdAt: now,
      });

      // Log for audit
      console.log(
        `Change order ${changeOrderId} created for project ${project._id}: ` +
          `+${payload.budgetImpact} cents ` +
          `(new total: ${newTotal} cents). ` +
          `Reason: ${payload.justification}`
      );

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), changeOrdersRequestPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The requestChangeOrder work item with actions and lifecycle activities.
 */
export const requestChangeOrderWorkItem = Builder.workItem("requestChangeOrder")
  .withActions(requestChangeOrderWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The requestChangeOrder task.
 */
export const requestChangeOrderTask = Builder.task(requestChangeOrderWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
