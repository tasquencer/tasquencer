/**
 * UseTimer Work Item
 *
 * Start/stop a timer to track time in real-time.
 *
 * Entry condition: User selected "timer" method
 * Exit condition: Timer stopped, time entry created with status = "Draft"
 *
 * Reference: .review/recipes/psa-platform/specs/07-workflow-time-tracking.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { insertTimeEntry } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { checkTimeEntryDuplicates } from "../db/duplicateDetection";
import { checkTimerDuration, TIMER_MAX_HOURS, roundHours } from "../db/dateLimits";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:create:own' scope
const timeCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:time:create:own"
);

/**
 * Actions for the useTimer work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Creates time entry from timer (start time to now)
 * - fail: Marks the work item as failed
 */
const useTimerWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
      taskId: zid("tasks").optional(),
      serviceId: zid("services").optional(),
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
          type: "useTimer",
          taskName: "Track Time with Timer",
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
      startTime: z.number(), // When timer was started
      notes: z.string().optional(),
      billable: z.boolean().default(true),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "useTimer:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const now = Date.now();

      // Validate startTime is not in the future (per spec task-usetimer.md: "No future dates")
      if (payload.startTime > now) {
        throw new Error(
          `Timer start time cannot be in the future. ` +
          `Start time: ${new Date(payload.startTime).toISOString()}, now: ${new Date(now).toISOString()}`
        );
      }

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Check timer duration and handle auto-stop at 12 hours
      // Per spec 07-workflow-time-tracking.md line 300: "Timer auto-stops after 12 hours with warning"
      const timerCheck = checkTimerDuration(payload.startTime, now);

      // Round hours to nearest 0.25 (15 minutes) per spec line 299
      // "Hours rounded to nearest 0.25 (15 min) or 0.1 (6 min) based on org setting"
      const hours = roundHours(timerCheck.hours);

      // Log warning if timer was auto-stopped or is approaching limit
      if (timerCheck.wasAutoStopped) {
        console.warn(
          `[useTimer] Timer auto-stopped after ${TIMER_MAX_HOURS} hours. ` +
          `${timerCheck.message}`
        );
      } else if (timerCheck.hasWarning) {
        console.warn(`[useTimer] ${timerCheck.message}`);
      }

      // Validate minimum hours (per spec: 0.25 minimum)
      if (hours < 0.25) {
        throw new Error("Timer duration must be at least 15 minutes (0.25 hours)");
      }

      // Check for potential duplicates (warn, don't block)
      // Per spec 07-workflow-time-tracking.md line 287: "Warn if entry exists for same project/date"
      const duplicateCheck = await checkTimeEntryDuplicates(mutationCtx.db, {
        userId,
        projectId: payload.projectId,
        date: now,
        taskId: payload.taskId,
        hours,
      });

      if (duplicateCheck.hasPotentialDuplicates) {
        // Log warning for audit trail - duplicates are warnings, not blockers
        console.warn(
          `[useTimer] Duplicate warning: ${duplicateCheck.warningMessage} ` +
          `(confidence: ${duplicateCheck.confidence}, duplicateIds: ${duplicateCheck.duplicateIds.join(", ")})`
        );
      }

      // Create time entry with status = "Draft"
      await insertTimeEntry(mutationCtx.db, {
        organizationId: project.organizationId,
        userId,
        projectId: payload.projectId,
        taskId: payload.taskId,
        serviceId: payload.serviceId,
        date: now, // Current date
        hours,
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
 * The useTimer work item with actions and lifecycle activities.
 */
export const useTimerWorkItem = Builder.workItem("useTimer")
  .withActions(useTimerWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The useTimer task.
 */
export const useTimerTask = Builder.task(useTimerWorkItem);
