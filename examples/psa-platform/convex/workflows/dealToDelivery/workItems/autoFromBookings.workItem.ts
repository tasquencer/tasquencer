/**
 * AutoFromBookings Work Item
 *
 * Auto-generate time entries from resource bookings.
 *
 * Entry condition: User selected "autoBooking" method
 * Exit condition: Time entries created from selected bookings with status = "Draft"
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
import { getBooking } from "../db/bookings";
import { insertTimeEntry, listTimeEntriesByUserAndDate } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { roundHours } from "../db/dateLimits";
import {
  assertProjectExists,
  assertBookingExists,
  assertAuthenticatedUser,
} from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:create:own' scope
const timeCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:time:create:own"
);

// Helper to get days between two dates
function getDaysBetween(startDate: number, endDate: number): number[] {
  const days: number[] = [];
  const oneDay = 24 * 60 * 60 * 1000;
  let current = startDate;

  while (current <= endDate) {
    days.push(current);
    current += oneDay;
  }

  return days;
}

/**
 * Actions for the autoFromBookings work item.
 *
 * - initialize: Sets up work item metadata
 * - start: Claims the work item for the current user
 * - complete: Creates time entries from selected bookings
 * - fail: Marks the work item as failed
 */
const autoFromBookingsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      userId: zid("users"),
      dateRange: z.object({
        startDate: z.number(),
        endDate: z.number(),
      }),
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
          type: "autoFromBookings",
          taskName: "Generate Time from Bookings",
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
      userId: zid("users"),
      dateRange: z.object({
        startDate: z.number(),
        endDate: z.number(),
      }),
      includeBookings: z.array(zid("bookings")), // Which bookings to use
      // Override hours per day - per spec task-autofrombookings.md: "Hours must be 0.25-24"
      overrideHours: z.number().min(0.25).max(24).optional(),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "autoFromBookings:complete",
        workItemId: workItem.id,
      });

      const now = Date.now();
      const createdEntryIds: Id<"timeEntries">[] = [];

      // Process each selected booking
      for (const bookingId of payload.includeBookings) {
        const booking = await getBooking(mutationCtx.db, bookingId);
        assertBookingExists(booking, { bookingId });

        // Skip bookings without projectId (e.g., TimeOff bookings)
        if (!booking.projectId) {
          continue;
        }

        // Validate project exists
        const project = await getProject(mutationCtx.db, booking.projectId);
        assertProjectExists(project, { projectId: booking.projectId });

        // Calculate overlap between booking and requested date range
        const overlapStart = Math.max(booking.startDate, payload.dateRange.startDate);
        const overlapEnd = Math.min(booking.endDate, payload.dateRange.endDate);

        if (overlapStart > overlapEnd) {
          continue; // No overlap
        }

        // Get all days in the overlap period
        const days = getDaysBetween(overlapStart, overlapEnd);

        // Create time entries for each day
        for (const day of days) {
          // Skip days with existing entries for this user/project
          const existingEntries = await listTimeEntriesByUserAndDate(
            mutationCtx.db,
            payload.userId,
            day
          );
          const hasExistingEntry = existingEntries.some(
            (e) => e.projectId === booking.projectId
          );

          if (hasExistingEntry) {
            continue; // Skip to avoid duplicates
          }

          // Use override hours or booking's hours per day, rounded to nearest 0.25
          const rawHours = payload.overrideHours ?? booking.hoursPerDay;
          const hours = roundHours(rawHours);

          // Validate hours after rounding
          if (hours < 0.25 || hours > 24) {
            continue;
          }

          // Create time entry with status = "Draft"
          const entryId = await insertTimeEntry(mutationCtx.db, {
            organizationId: project.organizationId,
            userId: payload.userId,
            projectId: booking.projectId,
            taskId: booking.taskId,
            serviceId: undefined, // Bookings don't typically have service ID
            date: day,
            hours,
            billable: true, // Default billable for bookings
            status: "Draft",
            notes: `Auto-generated from booking`,
            createdAt: now,
          });

          createdEntryIds.push(entryId);
        }
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The autoFromBookings work item with actions and lifecycle activities.
 */
export const autoFromBookingsWorkItem = Builder.workItem("autoFromBookings")
  .withActions(autoFromBookingsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The autoFromBookings task.
 */
export const autoFromBookingsTask = Builder.task(autoFromBookingsWorkItem);
