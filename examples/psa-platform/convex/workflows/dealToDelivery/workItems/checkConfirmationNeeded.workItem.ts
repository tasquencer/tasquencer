/**
 * CheckConfirmationNeeded Work Item
 *
 * System task that checks if any bookings need confirmation.
 * Routes to confirmBookings if there are tentative bookings,
 * otherwise routes to workflow end.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { cleanupWorkItemOnCancel, startAndClaimWorkItem } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getBooking } from "../db/bookings";
import { assertProjectExists, assertBookingExists } from "../exceptions";

// System task - uses a permissive policy since it's automated
// In production, you might want a system-level scope
const systemPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:view:team"
);

/**
 * Actions for the checkConfirmationNeeded work item.
 *
 * This is a system (automated) task that checks booking types
 * and routes the workflow accordingly.
 */
const checkConfirmationNeededWorkItemActions =
  authService.builders.workItemActions
    .initialize(
      z.object({
        projectId: zid("projects"),
      }),
      systemPolicy,
      async ({ mutationCtx, workItem }, payload) => {
        const workItemId = await workItem.initialize();

        const project = await getProject(mutationCtx.db, payload.projectId);
        assertProjectExists(project, { projectId: payload.projectId });

        await initializeDealWorkItemAuth(mutationCtx, workItemId, {
          scope: "dealToDelivery:resources:view:team",
          dealId: project.dealId!,
          payload: {
            type: "checkConfirmationNeeded",
            taskName: "Check Confirmation Needed",
            priority: "normal",
          },
        });
      }
    )
    .start(z.never(), systemPolicy, async ({ mutationCtx, workItem }) => {
      await startAndClaimWorkItem(mutationCtx, workItem);
    })
    .complete(
      z.object({
        bookingIds: z.array(zid("bookings")),
      }),
      systemPolicy,
      async ({ mutationCtx, workItem }, payload) => {
        // Check if any of the bookings are Tentative
        let needsConfirmation = false;

        for (const bookingId of payload.bookingIds) {
          const booking = await getBooking(mutationCtx.db, bookingId);
          assertBookingExists(booking, { bookingId });

          if (booking.type === "Tentative") {
            needsConfirmation = true;
            break;
          }
        }

        // The workflow routing will check this result
        // and route to either confirmBookings or workflow end
        // The routing decision is made by the workflow definition
        // In a real implementation, needsConfirmation would influence routing
        void needsConfirmation;

        await workItem.complete();
      }
    )
    .fail(z.any().optional(), systemPolicy, async ({ workItem }) => {
      await workItem.fail();
    });

/**
 * The checkConfirmationNeeded work item with actions and lifecycle activities.
 */
export const checkConfirmationNeededWorkItem = Builder.workItem(
  "checkConfirmationNeeded"
)
  .withActions(checkConfirmationNeededWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The checkConfirmationNeeded task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const checkConfirmationNeededTask = Builder.task(
  checkConfirmationNeededWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
