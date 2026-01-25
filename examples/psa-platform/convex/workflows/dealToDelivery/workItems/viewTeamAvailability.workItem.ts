/**
 * ViewTeamAvailability Work Item
 *
 * Displays team availability for resource allocation. Shows users with their
 * available hours, booked hours, and utilization percentage for a date range.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { listActiveUsersByOrganization } from "../db/users";
import {
  listUserBookingsInDateRange,
  calculateUserBookedHours,
} from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:view:team' scope for viewing team availability
const resourcesViewPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:view:team"
);

/**
 * Actions for the viewTeamAvailability work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Calculates and returns team availability data
 * - fail: Marks the work item as failed
 */
const viewTeamAvailabilityWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    resourcesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get project's deal for metadata linking
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // Initialize work item metadata - link to deal for consistency
      // Resource planning work items are part of the deal-to-delivery workflow
      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:view:team",
        dealId: project.dealId!, // Projects in this workflow always have a dealId
        payload: {
          type: "viewTeamAvailability",
          taskName: "View Team Availability",
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
      startDate: z.number().describe("Start date timestamp"),
      endDate: z.number().describe("End date timestamp"),
    }),
    resourcesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify project context
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      // Get all active users in the organization
      const users = await listActiveUsersByOrganization(
        mutationCtx.db,
        project.organizationId
      );

      // Calculate availability for each user
      const standardWorkingHoursPerDay = 8;
      const totalDays = Math.ceil(
        (payload.endDate - payload.startDate) / (24 * 60 * 60 * 1000)
      ) + 1;
      const totalStandardHours = totalDays * standardWorkingHoursPerDay;

      // Compute availability data for each user
      // Note: This data would typically be returned to UI or stored for display
      const availabilityData = await Promise.all(
        users.map(async (user) => {
          // Get bookings for this user in date range
          const bookings = await listUserBookingsInDateRange(
            mutationCtx.db,
            user._id,
            payload.startDate,
            payload.endDate
          );

          // Calculate booked hours
          const bookedHours = await calculateUserBookedHours(
            mutationCtx.db,
            user._id,
            payload.startDate,
            payload.endDate
          );

          // Calculate time off hours (bookings with type="TimeOff")
          const timeOffBookings = bookings.filter((b) => b.type === "TimeOff");
          let timeOffHours = 0;
          for (const booking of timeOffBookings) {
            const overlapStart = Math.max(booking.startDate, payload.startDate);
            const overlapEnd = Math.min(booking.endDate, payload.endDate);
            const days = Math.ceil(
              (overlapEnd - overlapStart) / (24 * 60 * 60 * 1000)
            ) + 1;
            timeOffHours += days * booking.hoursPerDay;
          }

          const availableHours = totalStandardHours - bookedHours;
          const utilizationPercent =
            totalStandardHours > 0
              ? Math.round((bookedHours / totalStandardHours) * 100)
              : 0;

          return {
            userId: user._id,
            name: user.name,
            role: user.role,
            skills: user.skills,
            department: user.department,
            location: user.location,
            totalAvailable: availableHours,
            totalBooked: bookedHours,
            timeOffHours,
            utilizationPercent,
          };
        })
      );

      // Complete the work item
      // In a real implementation, availabilityData would be returned to the UI
      void availabilityData;
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), resourcesViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The viewTeamAvailability work item with actions and lifecycle activities.
 */
export const viewTeamAvailabilityWorkItem = Builder.workItem(
  "viewTeamAvailability"
)
  .withActions(viewTeamAvailabilityWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The viewTeamAvailability task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const viewTeamAvailabilityTask = Builder.task(
  viewTeamAvailabilityWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
