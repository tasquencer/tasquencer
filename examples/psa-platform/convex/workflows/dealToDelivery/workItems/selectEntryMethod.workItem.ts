/**
 * SelectEntryMethod Work Item
 *
 * Choose how to record time for this session.
 * Routes to one of: useTimer, manualEntry, importFromCalendar, autoFromBookings
 *
 * Entry condition: User has time:create scope, assigned to project, project status = "Active"
 * Exit condition: Entry method selected, routed to appropriate work item
 *
 * Reference: .review/recipes/psa-platform/specs/07-workflow-time-tracking.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import {
  initializeDealWorkItemAuth,
  updateWorkItemMetadataPayload,
} from "./helpersAuth";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:time:create:own' scope
const timeCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:time:create:own"
);

/**
 * Actions for the selectEntryMethod work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Records the selected entry method for routing
 * - fail: Marks the work item as failed
 */
const selectEntryMethodWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects").optional(),
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

      // Validate project exists if provided
      if (payload.projectId) {
        const project = await getProject(mutationCtx.db, payload.projectId);
        assertProjectExists(project, { projectId: payload.projectId });
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:time:create:own",
        dealId: deal._id,
        payload: {
          type: "selectEntryMethod",
          taskName: "Select Time Entry Method",
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
      method: z.enum(["timer", "manual", "calendar", "autoBooking"]),
      projectId: zid("projects").optional(),
      date: z.number().optional(),
    }),
    timeCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Store the selected method in metadata for routing
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "selectEntryMethod",
          taskName: "Select Time Entry Method",
          priority: "normal",
          selectedMethod: payload.method,
        });
      }

      // The method selection is stored in the work item result for routing
      // The workflow router will read this to determine the next task
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The selectEntryMethod work item with actions and lifecycle activities.
 */
export const selectEntryMethodWorkItem = Builder.workItem("selectEntryMethod")
  .withActions(selectEntryMethodWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The selectEntryMethod task.
 */
export const selectEntryMethodTask = Builder.task(selectEntryMethodWorkItem);
