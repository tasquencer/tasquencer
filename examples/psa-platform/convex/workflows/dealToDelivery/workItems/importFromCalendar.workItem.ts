/**
 * ImportFromCalendar Work Item
 *
 * Convert calendar events to time entries.
 *
 * Entry condition: User selected "calendar" method
 * Exit condition: Time entries created from selected calendar events with status = "Draft"
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
import { roundHours } from "../db/dateLimits";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:create:own' scope
const timeCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:time:create:own"
);

/**
 * Actions for the importFromCalendar work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Creates time entries from selected calendar events
 * - fail: Marks the work item as failed
 */
const importFromCalendarWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      calendarSource: z.enum(["google", "outlook"]).optional(),
      projectId: zid("projects").optional(),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:time:create:own",
        dealId: deal._id,
        payload: {
          type: "importFromCalendar",
          taskName: "Import Time from Calendar",
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
      calendarSource: z.enum(["google", "outlook"]),
      dateRange: z.object({
        startDate: z.number(),
        endDate: z.number(),
      }),
      selectedEvents: z.array(
        z.object({
          eventId: z.string(),
          title: z.string(),
          startTime: z.number(),
          endTime: z.number(),
          projectId: zid("projects"), // User maps event to project
          taskId: zid("tasks").optional(),
          serviceId: zid("services").optional(),
          billable: z.boolean(),
        })
      ),
      excludePatterns: z.array(z.string()).optional(),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "importFromCalendar:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;
      const now = Date.now();

      const createdEntryIds: Id<"timeEntries">[] = [];

      // Pre-compile exclude patterns for efficient matching
      const excludeRegexes = (payload.excludePatterns ?? []).map(
        (pattern) => new RegExp(pattern, "i")
      );

      // Create time entries from selected events
      for (const event of payload.selectedEvents) {
        // Filter out events matching exclude patterns (per spec task-importfromcalendar.md)
        if (excludeRegexes.some((regex) => regex.test(event.title))) {
          continue;
        }

        // Validate project exists
        const project = await getProject(mutationCtx.db, event.projectId);
        assertProjectExists(project, { projectId: event.projectId });

        // Calculate hours from start/end time
        const durationMs = event.endTime - event.startTime;
        const rawHours = durationMs / 3600000; // Convert ms to hours

        // Round to nearest 0.25 increment (per spec: hours rounded to nearest 0.25)
        const hours = roundHours(rawHours);

        // Skip if duration is too short (< 0.25h per spec)
        if (hours < 0.25) {
          continue;
        }

        // Cap hours at 24
        const cappedHours = Math.min(hours, 24);

        // Create time entry with status = "Draft"
        const entryId = await insertTimeEntry(mutationCtx.db, {
          organizationId: project.organizationId,
          userId,
          projectId: event.projectId,
          taskId: event.taskId,
          serviceId: event.serviceId,
          date: event.startTime, // Use event start time as date
          hours: cappedHours,
          billable: event.billable,
          status: "Draft",
          notes: event.title, // Use event title as notes
          createdAt: now,
        });

        createdEntryIds.push(entryId);
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The importFromCalendar work item with actions and lifecycle activities.
 */
export const importFromCalendarWorkItem = Builder.workItem("importFromCalendar")
  .withActions(importFromCalendarWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The importFromCalendar task.
 */
export const importFromCalendarTask = Builder.task(importFromCalendarWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
