/**
 * CloseProject Work Item
 *
 * Officially close the project and verify completion criteria.
 *
 * Entry condition: All billing complete, all invoices paid (or marked)
 * Exit condition: Project status = "Completed", metrics captured
 *
 * Reference: .review/recipes/psa-platform/specs/13-workflow-close-phase.md
 */
import { Builder } from "../../../tasquencer";
import { ConstraintViolationError } from "@repo/tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import {
  getProject,
  updateProjectStatus,
  updateProject,
  getProjectClosureChecklist,
  calculateProjectMetrics,
  cancelFutureBookings,
} from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";

// Policy: Requires 'dealToDelivery:projects:close' scope
const projectsClosePolicy = authService.policies.requireScope(
  "dealToDelivery:projects:close"
);

/**
 * Actions for the closeProject work item.
 */
const closeProjectWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    projectsClosePolicy,
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
        scope: "dealToDelivery:projects:close",
        dealId: deal._id,
        payload: {
          type: "closeProject",
          taskName: "Close Project",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), projectsClosePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      closeDate: z.number(),
      completionStatus: z.enum(["completed", "cancelled", "on_hold_indefinitely"]),
      closureNotes: z.string().optional(),
      finalDeliverables: z.array(z.object({
        name: z.string(),
        description: z.string(),
        deliveredAt: z.number(),
      })).optional(),
      acknowledgements: z.object({
        clientSignoff: z.boolean().optional(),
        clientSignoffDate: z.number().optional(),
        clientSignoffBy: z.string().optional(),
      }).optional(),
      /** Set to true to close even with warnings (unpaid invoices, etc.) */
      acknowledgeWarnings: z.boolean().optional(),
    }),
    projectsClosePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "closeProject:complete",
        workItemId: workItem.id,
      });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // 1. Verify closure criteria (spec 13-workflow-close-phase.md lines 76-82)
      const checklist = await getProjectClosureChecklist(mutationCtx.db, payload.projectId);

      // Hard blockers - cannot close without these
      if (!checklist.canClose) {
        const blockers: string[] = [];
        if (!checklist.allTasksComplete) {
          blockers.push(`${checklist.incompleteTasks} incomplete task(s)`);
        }
        if (!checklist.allTimeEntriesApproved) {
          blockers.push(`${checklist.unapprovedTimeEntries} unapproved time entry(ies)`);
        }
        if (!checklist.allExpensesApproved) {
          blockers.push(`${checklist.unapprovedExpenses} unapproved expense(s)`);
        }
        throw new ConstraintViolationError(
          `Cannot close project: ${blockers.join(", ")}. ` +
          "All tasks must be completed/cancelled and all time entries/expenses must be approved."
        );
      }

      // Soft warnings - can close but warn
      const softWarnings: string[] = [];
      if (!checklist.allItemsInvoiced && !payload.acknowledgeWarnings) {
        softWarnings.push(
          `${checklist.uninvoicedTimeEntries + checklist.uninvoicedExpenses} billable item(s) not invoiced`
        );
      }
      if (!checklist.allInvoicesPaid && !payload.acknowledgeWarnings) {
        const amountStr = (checklist.unpaidAmount / 100).toFixed(2);
        softWarnings.push(`${checklist.unpaidInvoices} invoice(s) unpaid ($${amountStr} outstanding)`);
      }

      // If there are soft warnings and user hasn't acknowledged, fail with warnings
      if (softWarnings.length > 0 && !payload.acknowledgeWarnings) {
        throw new ConstraintViolationError(
          `Project has warnings: ${softWarnings.join("; ")}. ` +
          "Set acknowledgeWarnings=true to close anyway."
        );
      }

      // 2. Calculate final metrics (spec lines 87-98)
      const metrics = await calculateProjectMetrics(mutationCtx.db, payload.projectId, payload.closeDate);

      // 3. Cancel pending bookings (spec line 85-86)
      const cancelledBookings = await cancelFutureBookings(mutationCtx.db, payload.projectId);

      // Build warnings list for response
      const warnings = [...checklist.warnings];
      if (cancelledBookings > 0) {
        warnings.push(`${cancelledBookings} future booking(s) cancelled`);
      }

      // Update project status
      const statusMap = {
        completed: "Completed" as const,
        cancelled: "Archived" as const,
        on_hold_indefinitely: "OnHold" as const,
      };
      await updateProjectStatus(mutationCtx.db, payload.projectId, statusMap[payload.completionStatus]);

      // Update the project with closure details (TENET-DOMAIN-BOUNDARY)
      await updateProject(mutationCtx.db, payload.projectId, {
        endDate: payload.closeDate,
        closureNotes: payload.closureNotes,
        closedAt: Date.now(),
        // Store metrics as JSON string in description for now
        // In a real implementation, we'd have a dedicated projectMetrics table
        description: project.description
          ? `${project.description}\n\n--- Closure Metrics ---\n` +
            `Revenue: $${(metrics.totalRevenue / 100).toFixed(2)}\n` +
            `Cost: $${(metrics.totalCost / 100).toFixed(2)}\n` +
            `Profit: $${(metrics.profit / 100).toFixed(2)} (${metrics.profitMargin.toFixed(1)}%)\n` +
            `Budget Variance: ${metrics.budgetVariance.toFixed(1)}%\n` +
            `Duration: ${metrics.durationDays} days\n` +
            `Total Hours: ${metrics.totalHours}h (${metrics.billableHours}h billable)`
          : `--- Closure Metrics ---\n` +
            `Revenue: $${(metrics.totalRevenue / 100).toFixed(2)}\n` +
            `Cost: $${(metrics.totalCost / 100).toFixed(2)}\n` +
            `Profit: $${(metrics.profit / 100).toFixed(2)} (${metrics.profitMargin.toFixed(1)}%)\n` +
            `Budget Variance: ${metrics.budgetVariance.toFixed(1)}%\n` +
            `Duration: ${metrics.durationDays} days\n` +
            `Total Hours: ${metrics.totalHours}h (${metrics.billableHours}h billable)`,
      });

      // Update metadata with closure result
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "closeProject",
        taskName: "Close Project",
        priority: "normal",
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), projectsClosePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The closeProject work item with actions and lifecycle activities.
 */
export const closeProjectWorkItem = Builder.workItem("closeProject")
  .withActions(closeProjectWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The closeProject task.
 */
export const closeProjectTask = Builder.task(closeProjectWorkItem);
