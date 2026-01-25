/**
 * SetBudget Work Item
 *
 * Finalizes the budget structure with services, rates, and type.
 * This allows the project manager or finance team to adjust the
 * initial budget created from the estimate.
 *
 * Entry condition: Project exists with initial budget
 * Exit condition: Budget finalized with type and services set
 *
 * Reference: .review/recipes/psa-platform/specs/04-workflow-planning-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithDealAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { getProjectByDealId } from "../db/projects";
import {
  getBudget,
  updateBudget,
  insertService,
  listServicesByBudget,
  deleteService,
  recalculateBudgetTotal,
} from "../db/budgets";
import { assertBudgetExists, assertProjectExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:budgets:create' scope
const budgetsCreatePolicy = authService.policies.requireScope("dealToDelivery:budgets:create");

// Service schema for budget line items
// Per spec 04-workflow-planning-phase.md line 150: "Rates must be > 0 for billable services"
const serviceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  rate: z.number().positive("Rate must be greater than 0 for billable services"),
  estimatedHours: z.number().min(0, "Estimated hours must be non-negative"),
});

/**
 * Actions for the setBudget work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Updates budget type and services
 * - fail: Marks the work item as failed
 */
const setBudgetWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    budgetsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:budgets:create",
        dealId: payload.dealId,
        payload: {
          type: "setBudget",
          taskName: "Set Budget",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), budgetsCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      budgetId: zid("budgets"),
      type: z.enum(["TimeAndMaterials", "FixedFee", "Retainer"]),
      services: z.array(serviceSchema).min(1, "At least one service is required"),
    }),
    budgetsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify budget exists
      const budget = await getBudget(mutationCtx.db, payload.budgetId);
      assertBudgetExists(budget, { budgetId: payload.budgetId });

      // Verify the budget belongs to a project linked to this workflow's deal
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      const project = await getProjectByDealId(mutationCtx.db, deal._id);
      assertProjectExists(project, { workflowId: deal.workflowId });

      if (project.budgetId !== payload.budgetId) {
        throw new Error(
          `Budget mismatch: expected ${project.budgetId}, got ${payload.budgetId}`
        );
      }

      // Update budget type
      await updateBudget(mutationCtx.db, payload.budgetId, {
        type: payload.type,
      });

      // Delete existing services (replacing with new ones)
      const existingServices = await listServicesByBudget(
        mutationCtx.db,
        payload.budgetId
      );
      for (const service of existingServices) {
        await deleteService(mutationCtx.db, service._id);
      }

      // Insert new services
      for (const service of payload.services) {
        const totalAmount = service.rate * service.estimatedHours;
        await insertService(mutationCtx.db, {
          budgetId: payload.budgetId,
          organizationId: budget.organizationId,
          name: service.name,
          rate: service.rate,
          estimatedHours: service.estimatedHours,
          totalAmount,
        });
      }

      // Recalculate budget total
      await recalculateBudgetTotal(mutationCtx.db, payload.budgetId);

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), budgetsCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The setBudget work item with actions and lifecycle activities.
 */
export const setBudgetWorkItem = Builder.workItem("setBudget")
  .withActions(setBudgetWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The setBudget task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const setBudgetTask = Builder.task(setBudgetWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
