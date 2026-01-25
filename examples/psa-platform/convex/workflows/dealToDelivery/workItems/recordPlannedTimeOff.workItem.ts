/**
 * RecordPlannedTimeOff Work Item
 *
 * Records planned time off for a team member as a booking with type="TimeOff".
 * This blocks availability for the specified period.
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
import { insertBooking } from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertUserExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:timeoff:own' scope
const timeoffOwnPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:timeoff:own"
);

/**
 * Actions for the recordPlannedTimeOff work item.
 */
const recordPlannedTimeOffWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    timeoffOwnPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:timeoff:own",
        dealId: project.dealId!,
        payload: {
          type: "recordPlannedTimeOff",
          taskName: "Record Planned Time Off",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), timeoffOwnPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      userId: zid("users"),
      startDate: z.number().describe("Start date timestamp"),
      endDate: z.number().describe("End date timestamp"),
      type: z.enum(["Vacation", "Sick", "Personal", "Holiday"]),
      hoursPerDay: z.number().min(0).max(24).optional().default(8),
      notes: z.string().optional(),
    }),
    timeoffOwnPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      // Verify user exists
      const user = await getUser(mutationCtx.db, payload.userId);
      assertUserExists(user, { userId: payload.userId });

      // Create a TimeOff booking
      await insertBooking(mutationCtx.db, {
        organizationId: project.organizationId,
        userId: payload.userId,
        projectId: undefined, // TimeOff bookings don't have a project
        taskId: undefined,
        type: "TimeOff",
        startDate: payload.startDate,
        endDate: payload.endDate,
        hoursPerDay: payload.hoursPerDay,
        notes: payload.notes
          ? `${payload.type}: ${payload.notes}`
          : payload.type,
        createdAt: Date.now(),
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeoffOwnPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The recordPlannedTimeOff work item with actions and lifecycle activities.
 */
export const recordPlannedTimeOffWorkItem = Builder.workItem(
  "recordPlannedTimeOff"
)
  .withActions(recordPlannedTimeOffWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The recordPlannedTimeOff task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const recordPlannedTimeOffTask = Builder.task(
  recordPlannedTimeOffWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
