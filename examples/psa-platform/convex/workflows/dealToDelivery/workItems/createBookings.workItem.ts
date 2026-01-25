/**
 * CreateBookings Work Item
 *
 * Creates resource bookings for team members on a project.
 * Bookings can be Tentative (for deals < 75% probability) or Confirmed.
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
import { getUser } from "../db/users";
import { insertBooking, calculateUserBookedHours } from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertUserExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:book:team' scope
const resourcesBookPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:book:team"
);

/**
 * Actions for the createBookings work item.
 */
const createBookingsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    resourcesBookPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:book:team",
        dealId: project.dealId!,
        payload: {
          type: "createBookings",
          taskName: "Create Bookings",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), resourcesBookPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      bookings: z.array(
        z.object({
          userId: zid("users"),
          startDate: z.number(),
          endDate: z.number(),
          hoursPerDay: z.number().min(0).max(24),
          taskId: zid("tasks").optional(),
          notes: z.string().optional(),
        })
      ),
      isConfirmed: z.boolean().describe("True for Confirmed, false for Tentative"),
    }),
    resourcesBookPolicy,
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

      const bookingType = payload.isConfirmed ? "Confirmed" : "Tentative";
      const createdBookingIds: string[] = [];
      let totalBookedHours = 0;

      // Create bookings for each entry
      for (const bookingInput of payload.bookings) {
        // Verify user exists
        const user = await getUser(mutationCtx.db, bookingInput.userId);
        assertUserExists(user, { userId: bookingInput.userId });

        // Calculate hours for this booking
        const days =
          Math.ceil(
            (bookingInput.endDate - bookingInput.startDate) /
              (24 * 60 * 60 * 1000)
          ) + 1;
        const bookingHours = days * bookingInput.hoursPerDay;

        // Check for over-allocation (warning only, don't block)
        const existingBookedHours = await calculateUserBookedHours(
          mutationCtx.db,
          bookingInput.userId,
          bookingInput.startDate,
          bookingInput.endDate
        );

        const standardWorkingHoursPerDay = 8;
        const totalStandardHours = days * standardWorkingHoursPerDay;
        const totalAfterBooking = existingBookedHours + bookingHours;
        const utilizationAfter =
          totalStandardHours > 0
            ? (totalAfterBooking / totalStandardHours) * 100
            : 0;

        // Log warning if over-allocated (> 100%)
        if (utilizationAfter > 100) {
          console.warn(
            `Over-allocation warning: User ${bookingInput.userId} will be at ${utilizationAfter.toFixed(1)}% utilization`
          );
        }

        // Create the booking
        const bookingId = await insertBooking(mutationCtx.db, {
          organizationId: project.organizationId,
          userId: bookingInput.userId,
          projectId: payload.projectId,
          taskId: bookingInput.taskId,
          type: bookingType,
          startDate: bookingInput.startDate,
          endDate: bookingInput.endDate,
          hoursPerDay: bookingInput.hoursPerDay,
          notes: bookingInput.notes,
          createdAt: Date.now(),
        });

        createdBookingIds.push(bookingId);
        totalBookedHours += bookingHours;
      }

      // Store booking IDs in work item metadata for later reference
      // (This data can be used by reviewBookings and confirmBookings)

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), resourcesBookPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createBookings work item with actions and lifecycle activities.
 */
export const createBookingsWorkItem = Builder.workItem("createBookings")
  .withActions(createBookingsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createBookings task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const createBookingsTask = Builder.task(createBookingsWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
