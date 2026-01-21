/**
 * MonitorBudgetBurn Work Item
 *
 * Monitors budget consumption and determines if overrun threshold exceeded.
 * Calculates costs from approved time entries and expenses.
 *
 * Entry condition: Project has budget and active tasks
 * Exit condition: Budget status determined (budgetOk or budgetOverrun)
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getBudget } from "../db/budgets";
import { listApprovedTimeEntriesByProject } from "../db/timeEntries";
import { listApprovedExpensesByProject } from "../db/expenses";
import { getUser } from "../db/users";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertBudgetExists } from "../exceptions";
import { calculateTimeCostWithValidationSync } from "../db/costRateValidation";

// Policy: Requires 'dealToDelivery:budgets:view:own' scope
const budgetsViewPolicy = authService.policies.requireScope(
  "dealToDelivery:budgets:view:own"
);

/**
 * Budget burn thresholds per spec 06-workflow-execution-phase.md lines 278-284:
 * - 0-75%: Green - Normal operations
 * - 75-90%: Yellow - Warning, increased monitoring
 * - 90%+: Red - Budget overrun, pause work
 */
export const WARNING_THRESHOLD = 0.75;
export const OVERRUN_THRESHOLD = 0.9;

/**
 * Actions for the monitorBudgetBurn work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Calculates budget burn and returns status
 * - fail: Marks the work item as failed
 */
const monitorBudgetBurnWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    budgetsViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:budgets:view:own",
        dealId: project.dealId!,
        payload: {
          type: "monitorBudgetBurn",
          taskName: "Monitor Budget Burn",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), budgetsViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
    }),
    budgetsViewPolicy,
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

      // Get budget
      const budget = await getBudget(mutationCtx.db, project.budgetId!);
      assertBudgetExists(budget, { projectId: project._id });

      // Get approved time entries
      const timeEntries = await listApprovedTimeEntriesByProject(
        mutationCtx.db,
        project._id
      );

      // Build user cost rate map and calculate time cost with validation
      const userCostRates = new Map<typeof timeEntries[0]["userId"], number>();
      for (const entry of timeEntries) {
        if (!userCostRates.has(entry.userId)) {
          const user = await getUser(mutationCtx.db, entry.userId);
          userCostRates.set(entry.userId, user?.costRate ?? 0);
        }
      }

      // Calculate time cost with validation (warns about users with missing cost rates)
      const timeCostResult = calculateTimeCostWithValidationSync(
        timeEntries,
        userCostRates
      );
      const timeCost = timeCostResult.timeCost;

      // Log warning if any users have missing cost rates
      if (timeCostResult.hasUsersWithMissingRates) {
        console.warn(
          `⚠️ Budget burn calculation for project ${project._id}: ${timeCostResult.warningMessage}`
        );
      }

      // Get approved expenses
      const expenses = await listApprovedExpensesByProject(
        mutationCtx.db,
        project._id
      );

      // Calculate expense cost: direct amount
      const expenseCost = expenses.reduce(
        (sum, expense) => sum + expense.amount,
        0
      );

      // Calculate burn metrics
      const totalCost = timeCost + expenseCost;
      const budgetTotal = budget.totalAmount || 0;
      const burnRate = budgetTotal > 0 ? totalCost / budgetTotal : 0;
      const budgetRemaining = budgetTotal - totalCost;

      // Use module-level threshold constants (exported for testing)
      const budgetOk = burnRate <= OVERRUN_THRESHOLD;

      // Determine warning level based on thresholds
      const warningLevel: "green" | "yellow" | "red" =
        burnRate > OVERRUN_THRESHOLD ? "red" :
        burnRate > WARNING_THRESHOLD ? "yellow" : "green";

      // Log warning at yellow threshold (75-90%)
      if (warningLevel === "yellow") {
        console.warn(
          `⚠️ Budget warning for project ${project._id}: ` +
            `${(burnRate * 100).toFixed(1)}% burned - approaching overrun threshold. ` +
            `Increased monitoring recommended.`
        );
      }

      // Log the metrics for audit
      console.log(
        `Budget burn for project ${project._id}: ` +
          `${(burnRate * 100).toFixed(1)}% burned [${warningLevel.toUpperCase()}] ` +
          `(${totalCost} of ${budgetTotal} cents, ` +
          `${budgetRemaining} remaining, budgetOk: ${budgetOk})`
      );

      // Store the budget burn result in work item metadata for routing
      // The workflow router will read this to determine the next task (continue vs pause)
      // warningLevel is stored for UI display and increased monitoring triggers
      // Build the payload with optional cost rate warning fields
      const metadataPayload: {
        type: "monitorBudgetBurn";
        taskName: string;
        priority: "low" | "normal" | "high" | "urgent";
        budgetOk: boolean;
        burnRate: number;
        totalCost: number;
        budgetRemaining: number;
        warningLevel: "green" | "yellow" | "red";
        costRateWarning?: string;
        usersWithMissingRatesCount?: number;
      } = {
        type: "monitorBudgetBurn",
        taskName: "Monitor Budget Burn",
        priority: "normal",
        budgetOk,
        burnRate,
        totalCost,
        budgetRemaining,
        warningLevel,
      };

      // Include cost rate validation warning for audit trail if there are users with missing rates
      if (timeCostResult.hasUsersWithMissingRates && timeCostResult.warningMessage) {
        metadataPayload.costRateWarning = timeCostResult.warningMessage;
        metadataPayload.usersWithMissingRatesCount = timeCostResult.usersWithMissingRates.length;
      }

      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, metadataPayload);

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), budgetsViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The monitorBudgetBurn work item with actions and lifecycle activities.
 */
export const monitorBudgetBurnWorkItem = Builder.workItem("monitorBudgetBurn")
  .withActions(monitorBudgetBurnWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The monitorBudgetBurn task.
 */
export const monitorBudgetBurnTask = Builder.task(monitorBudgetBurnWorkItem);
