/**
 * ConfirmBookings Work Item
 *
 * Confirms tentative bookings, converting them to confirmed status.
 * Also updates project status to "Active" when bookings are confirmed.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject, updateProjectStatus } from "../db/projects";
import { getBooking, updateBookingType } from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertBookingExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:confirm' scope
const resourcesConfirmPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:confirm"
);

/**
 * Actions for the confirmBookings work item.
 */
const confirmBookingsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    resourcesConfirmPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:confirm",
        dealId: project.dealId!,
        payload: {
          type: "confirmBookings",
          taskName: "Confirm Bookings",
          priority: "normal",
        },
      });
    }
  )
  .start(
    z.never(),
    resourcesConfirmPolicy,
    async ({ mutationCtx, workItem }) => {
      await startAndClaimWorkItem(mutationCtx, workItem);
    }
  )
  .complete(
    z.object({
      bookingIds: z.array(zid("bookings")),
      confirmAll: z.boolean(),
      selectiveConfirmation: z
        .array(
          z.object({
            bookingId: zid("bookings"),
            confirm: z.boolean(),
            reason: z.string().optional(),
          })
        )
        .optional(),
    }),
    resourcesConfirmPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      let confirmedCount = 0;

      if (payload.confirmAll) {
        // Confirm all bookings
        for (const bookingId of payload.bookingIds) {
          const booking = await getBooking(mutationCtx.db, bookingId);
          assertBookingExists(booking, { bookingId });

          if (booking.type === "Tentative") {
            await updateBookingType(mutationCtx.db, bookingId, "Confirmed");
            confirmedCount++;
          }
        }
      } else if (payload.selectiveConfirmation) {
        // Selectively confirm/reject bookings
        for (const decision of payload.selectiveConfirmation) {
          const booking = await getBooking(mutationCtx.db, decision.bookingId);
          assertBookingExists(booking, { bookingId: decision.bookingId });

          if (decision.confirm && booking.type === "Tentative") {
            await updateBookingType(
              mutationCtx.db,
              decision.bookingId,
              "Confirmed"
            );
            confirmedCount++;
          }
          // If not confirming, the booking stays as Tentative
          // (or could be deleted, depending on business rules)
        }
      }

      // Update project status to Active if it's currently in Planning
      if (project.status === "Planning" && confirmedCount > 0) {
        await updateProjectStatus(mutationCtx.db, project._id, "Active");
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), resourcesConfirmPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The confirmBookings work item with actions and lifecycle activities.
 */
export const confirmBookingsWorkItem = Builder.workItem("confirmBookings")
  .withActions(confirmBookingsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The confirmBookings task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const confirmBookingsTask = Builder.task(confirmBookingsWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
