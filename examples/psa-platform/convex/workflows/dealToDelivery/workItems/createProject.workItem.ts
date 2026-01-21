/**
 * CreateProject Work Item
 *
 * Creates a project from a won deal, establishing the project structure
 * and initial budget based on the deal's estimate.
 *
 * Entry condition: Deal stage = "Won"
 * Exit condition: Project created with status = "Planning", budget initialized
 *
 * Reference: .review/recipes/psa-platform/specs/04-workflow-planning-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithDealAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { getEstimateByDealId, listEstimateServices } from "../db/estimates";
import { insertProject, updateProject } from "../db/projects";
import { insertBudget, recalculateBudgetTotal, insertService } from "../db/budgets";
import { assertEstimateExists, assertDealStage, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:projects:create' scope
const projectsCreatePolicy = authService.policies.requireScope("dealToDelivery:projects:create");

/**
 * Actions for the createProject work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Creates project and budget from deal/estimate
 * - fail: Marks the work item as failed
 */
const createProjectWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    projectsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:projects:create",
        dealId: payload.dealId,
        payload: {
          type: "createProject",
          taskName: "Create Project",
          priority: "high",
        },
      });
    }
  )
  .start(z.never(), projectsCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
    }),
    projectsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal, rootWorkflowId } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Verify deal is in Won stage
      assertDealStage(deal, ["Won"], { operation: "createProject" });

      // Get the authenticated user to set as project manager
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      const managerId = authUser?.userId
        ? (authUser.userId as Id<"users">)
        : deal.ownerId;

      if (!managerId) {
        assertAuthenticatedUser(authUser, {
          operation: "createProject",
          workItemId: workItem.id,
        });
      }

      // Fetch the estimate for the deal
      const estimate = await getEstimateByDealId(mutationCtx.db, deal._id);
      assertEstimateExists(estimate, { dealId: deal._id });

      // Get estimate services to copy to budget
      const estimateServices = await listEstimateServices(mutationCtx.db, estimate._id);

      // Create the project record
      const now = Date.now();
      const projectId = await insertProject(mutationCtx.db, {
        organizationId: deal.organizationId,
        companyId: deal.companyId,
        dealId: deal._id,
        workflowId: rootWorkflowId,
        name: deal.name,
        status: "Planning",
        startDate: now,
        managerId,
        createdAt: now,
      });

      // Create the initial budget shell from estimate
      // Default to TimeAndMaterials if no type preference
      const budgetId = await insertBudget(mutationCtx.db, {
        projectId,
        organizationId: deal.organizationId,
        type: "TimeAndMaterials",
        totalAmount: 0, // Will be calculated after services are added
        createdAt: now,
      });

      // Copy services from estimate to budget
      for (const estimateService of estimateServices) {
        await insertService(mutationCtx.db, {
          budgetId,
          organizationId: deal.organizationId,
          name: estimateService.name,
          rate: estimateService.rate,
          estimatedHours: estimateService.hours,
          totalAmount: estimateService.total,
        });
      }

      const estimateTotal = estimate.total;
      const negotiationDelta = deal.value - estimateTotal;
      if (negotiationDelta !== 0) {
        await insertService(mutationCtx.db, {
          budgetId,
          organizationId: deal.organizationId,
          name: "Negotiation Adjustment",
          rate: 0,
          estimatedHours: 0,
          totalAmount: negotiationDelta,
        });
      }

      // Recalculate budget total from services
      await recalculateBudgetTotal(mutationCtx.db, budgetId);

      // Update project with budget reference
      await updateProject(mutationCtx.db, projectId, {
        budgetId,
      });

      // Update deal with project reference (for tracking)
      // Note: deals don't have a projectId field in schema, so we skip this
      // The link is through project.dealId

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), projectsCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createProject work item with actions and lifecycle activities.
 */
export const createProjectWorkItem = Builder.workItem("createProject")
  .withActions(createProjectWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createProject task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const createProjectTask = Builder.task(createProjectWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
