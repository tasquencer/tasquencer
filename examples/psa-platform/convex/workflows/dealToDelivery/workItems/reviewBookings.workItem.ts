/**
 * ReviewBookings Work Item
 *
 * Displays a summary of bookings for review, showing utilization impact
 * and flagging any conflicts or over-allocations.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getUser } from "../db/users";
import {
  getBooking,
  listBookingsByProject,
  calculateUserBookedHours,
} from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertBookingExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:view:team' scope
const resourcesViewPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:view:team"
);

/**
 * Actions for the reviewBookings work item.
 */
const reviewBookingsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    resourcesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:view:team",
        dealId: project.dealId!,
        payload: {
          type: "reviewBookings",
          taskName: "Review Bookings",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), resourcesViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      bookingIds: z.array(zid("bookings")),
      needsMoreFiltering: z.boolean().optional(),
    }),
    resourcesViewPolicy,
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

      // Get all bookings for the project
      const projectBookings = await listBookingsByProject(
        mutationCtx.db,
        payload.projectId
      );

      let hasConflicts = false;
      const standardWorkingHoursPerDay = 8;

      // Review each specified booking
      const bookingReviews = await Promise.all(
        payload.bookingIds.map(async (bookingId) => {
          const booking = await getBooking(mutationCtx.db, bookingId);
          assertBookingExists(booking, { bookingId });

          // Get user info
          const user = await getUser(mutationCtx.db, booking.userId);

          // Calculate utilization for this user during booking period
          const totalDays =
            Math.ceil(
              (booking.endDate - booking.startDate) / (24 * 60 * 60 * 1000)
            ) + 1;
          const totalStandardHours = totalDays * standardWorkingHoursPerDay;

          const bookedHours = await calculateUserBookedHours(
            mutationCtx.db,
            booking.userId,
            booking.startDate,
            booking.endDate
          );

          const utilizationPercent =
            totalStandardHours > 0
              ? Math.round((bookedHours / totalStandardHours) * 100)
              : 0;

          // Flag if over-allocated
          if (utilizationPercent > 100) {
            hasConflicts = true;
          }

          return {
            bookingId,
            userId: booking.userId,
            userName: user?.name ?? "Unknown",
            type: booking.type,
            startDate: booking.startDate,
            endDate: booking.endDate,
            hoursPerDay: booking.hoursPerDay,
            utilizationPercent,
            isOverAllocated: utilizationPercent > 100,
          };
        })
      );

      // Summary
      const summary = {
        totalBookings: payload.bookingIds.length,
        tentativeCount: projectBookings.filter((b) => b.type === "Tentative")
          .length,
        confirmedCount: projectBookings.filter((b) => b.type === "Confirmed")
          .length,
        hasConflicts,
      };

      // In a real implementation, bookingReviews and summary would be returned to the UI
      void bookingReviews;
      void summary;

      // Store the needsMoreFiltering routing decision in metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "reviewBookings",
        taskName: "Review Bookings",
        priority: "normal",
        needsMoreFiltering: payload.needsMoreFiltering,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), resourcesViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviewBookings work item with actions and lifecycle activities.
 */
export const reviewBookingsWorkItem = Builder.workItem("reviewBookings")
  .withActions(reviewBookingsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviewBookings task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const reviewBookingsTask = Builder.task(reviewBookingsWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
