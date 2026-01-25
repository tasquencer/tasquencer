/**
 * ReviewTimesheet Work Item
 *
 * Manager reviews submitted time entries and decides to approve or reject.
 * Routes to approveTimesheet or rejectTimesheet based on decision.
 *
 * Entry condition: Time entries exist with status = "Submitted", reviewer has approval scope
 * Exit condition: Decision recorded, routed to approve or reject work item
 *
 * Reference: .review/recipes/psa-platform/specs/09-workflow-timesheet-approval.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getTimeEntry } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertTimeEntryExists, assertAuthenticatedUser } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:approve' scope
const timeApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:time:approve"
);

/**
 * Actions for the reviewTimesheet work item.
 *
 * - initialize: Sets up work item metadata with time entry context
 * - start: Claims the work item for the reviewer
 * - complete: Records approval decision and routes accordingly
 * - fail: Marks the work item as failed
 */
const reviewTimesheetWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      timeEntryIds: z.array(zid("timeEntries")).min(1),
    }),
    timeApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate at least one time entry exists and is in Submitted status
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });

        if (timeEntry.status !== "Submitted") {
          throw new Error(
            `Time entry must be in Submitted status to review. Entry ${timeEntryId} has status: ${timeEntry.status}`
          );
        }
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:time:approve",
        dealId: deal._id,
        payload: {
          type: "reviewTimesheet",
          taskName: "Review Timesheet",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), timeApprovePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      timeEntryIds: z.array(zid("timeEntries")).min(1),
      decision: z.enum(["approve", "reject"]),
      comments: z.string().optional(),
    }),
    timeApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "reviewTimesheet:complete",
        workItemId: workItem.id,
      });

      const reviewerId = authUser.userId as Id<"users">;

      // Validate time entries exist and are in Submitted status
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });

        if (timeEntry.status !== "Submitted") {
          throw new Error(
            `Time entry must be in Submitted status to review. Entry ${timeEntryId} has status: ${timeEntry.status}`
          );
        }

        // Prevent self-approval (business rule)
        if (timeEntry.userId === reviewerId) {
          throw new Error(
            "Cannot approve your own time entries. Please request another manager to review."
          );
        }
      }

      // Store the decision and comments in work item metadata for routing and audit trail
      // The workflow router will read this to determine the next task (approve vs reject)
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "reviewTimesheet",
        taskName: "Review Timesheet",
        priority: "normal",
        decision: payload.decision,
        comments: payload.comments, // Persist for audit trail (per spec task-reviewtimesheet.md)
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviewTimesheet work item with actions and lifecycle activities.
 */
export const reviewTimesheetWorkItem = Builder.workItem("reviewTimesheet")
  .withActions(reviewTimesheetWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviewTimesheet task.
 */
export const reviewTimesheetTask = Builder.task(reviewTimesheetWorkItem);
