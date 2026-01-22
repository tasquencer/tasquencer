/**
 * ManualEntry Work Item
 *
 * Manually enter time with hours and details.
 *
 * Entry condition: User selected "manual" method
 * Exit condition: Time entry created with status = "Draft"
 *
 * Reference: .review/recipes/psa-platform/specs/07-workflow-time-tracking.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { insertTimeEntry } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkTimeEntryDuplicates } from "../db/duplicateDetection";
import { roundHours } from "../db/dateLimits";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:create:own' scope
const timeCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:time:create:own"
);

/**
 * Actions for the manualEntry work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Creates time entry with manually entered hours
 * - fail: Marks the work item as failed
 */
const manualEntryWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
      date: z.number().optional(),
    }),
    timeCreatePolicy,
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
        scope: "dealToDelivery:time:create:own",
        dealId: deal._id,
        payload: {
          type: "manualEntry",
          taskName: "Manual Time Entry",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), timeCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      taskId: zid("tasks").optional(),
      serviceId: zid("services").optional(),
      date: z.number(), // Entry date
      // Hours worked - per spec task-manualentry.md: "Hours must be 0.25-24"
      hours: z.number().min(0.25).max(24),
      notes: z.string().optional(),
      billable: z.boolean().default(true),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "manualEntry:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const now = Date.now();

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Validate hours (per spec: 0.25 - 24 range)
      if (payload.hours < 0.25) {
        throw new Error("Hours must be at least 0.25 (15 minutes)");
      }
      if (payload.hours > 24) {
        throw new Error("Hours cannot exceed 24 per day");
      }

      // Round hours to nearest 0.25 (15 minutes) per spec line 299
      // "Hours rounded to nearest 0.25 (15 min) or 0.1 (6 min) based on org setting"
      const roundedHours = roundHours(payload.hours);

      // Validate not a future date
      if (payload.date > now) {
        throw new Error("Cannot submit time for future dates");
      }

      // Check for potential duplicates (warn, don't block)
      // Per spec 07-workflow-time-tracking.md line 287: "Warn if entry exists for same project/date"
      const duplicateCheck = await checkTimeEntryDuplicates(mutationCtx.db, {
        userId,
        projectId: payload.projectId,
        date: payload.date,
        taskId: payload.taskId,
        hours: roundedHours,
      });

      if (duplicateCheck.hasPotentialDuplicates) {
        // Log warning for audit trail - duplicates are warnings, not blockers
        console.warn(
          `[manualEntry] Duplicate warning: ${duplicateCheck.warningMessage} ` +
          `(confidence: ${duplicateCheck.confidence}, duplicateIds: ${duplicateCheck.duplicateIds.join(", ")})`
        );
      }

      // Create time entry with status = "Draft"
      // Note: hours are rounded to nearest 0.25 per spec line 299
      await insertTimeEntry(mutationCtx.db, {
        organizationId: project.organizationId,
        userId,
        projectId: payload.projectId,
        taskId: payload.taskId,
        serviceId: payload.serviceId,
        date: payload.date,
        hours: roundedHours,
        billable: payload.billable,
        status: "Draft",
        notes: payload.notes,
        createdAt: now,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The manualEntry work item with actions and lifecycle activities.
 */
export const manualEntryWorkItem = Builder.workItem("manualEntry")
  .withActions(manualEntryWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The manualEntry task.
 */
export const manualEntryTask = Builder.task(manualEntryWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
