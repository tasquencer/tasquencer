/**
 * ApproveTimesheet Work Item
 *
 * Finalize approval and lock time entries for billing.
 *
 * Entry condition: reviewTimesheet completed with decision = "approve"
 * Exit condition: Time entries status = "Approved", locked for editing
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
import { getTimeEntry, approveTimeEntry } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import {
  insertNotification,
  generateTimesheetApprovedContent,
} from "../db/notifications";
import { assertTimeEntryExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:approve' scope
const timeApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:time:approve"
);

/**
 * Actions for the approveTimesheet work item.
 *
 * - initialize: Sets up work item metadata with time entry context
 * - start: Claims the work item for the approver
 * - complete: Approves and locks time entries
 * - fail: Marks the work item as failed
 */
const approveTimesheetWorkItemActions = authService.builders.workItemActions
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

      // Validate time entries exist
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:time:approve",
        dealId: deal._id,
        payload: {
          type: "approveTimesheet",
          taskName: "Approve Timesheet",
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
      approvalNotes: z.string().optional(),
    }),
    timeApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "approveTimesheet:complete",
        workItemId: workItem.id,
      });

      const approverId = authUser.userId as Id<"users">;
      let approvedCount = 0;

      // Approve and lock each time entry
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });

        // Prevent self-approval
        if (timeEntry.userId === approverId) {
          throw new Error(
            "Cannot approve your own time entries. Please request another manager to review."
          );
        }

        // Validate entry is in correct status
        if (timeEntry.status !== "Submitted") {
          throw new Error(
            `Time entry must be in Submitted status to approve. Entry ${timeEntryId} has status: ${timeEntry.status}`
          );
        }

        // Approve the time entry (sets status, approver, and timestamp)
        await approveTimeEntry(mutationCtx.db, timeEntryId, approverId);

        approvedCount++;
      }

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "approveTimesheet",
          taskName: "Approve Timesheet",
          priority: "normal",
        });
      }

      // Notify team member(s) that their timesheet was approved
      // Group entries by user to avoid duplicate notifications
      const userTimeEntries = new Map<Id<"users">, number>();
      for (const timeEntryId of payload.timeEntryIds) {
        const entry = await getTimeEntry(mutationCtx.db, timeEntryId);
        if (entry) {
          const count = userTimeEntries.get(entry.userId) || 0;
          userTimeEntries.set(entry.userId, count + 1);
        }
      }

      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      for (const [userId, entryCount] of userTimeEntries) {
        const content = generateTimesheetApprovedContent(entryCount);
        await insertNotification(mutationCtx.db, {
          organizationId: deal.organizationId,
          userId: userId,
          type: "timesheet_approved",
          resourceType: "timeEntry",
          resourceId: payload.timeEntryIds.join(","),
          title: content.title,
          message: content.message,
          data: {
            timeEntryIds: payload.timeEntryIds,
            approvedBy: approverId,
            approvalNotes: payload.approvalNotes,
            entryCount,
          },
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The approveTimesheet work item with actions and lifecycle activities.
 */
export const approveTimesheetWorkItem = Builder.workItem("approveTimesheet")
  .withActions(approveTimesheetWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The approveTimesheet task.
 */
export const approveTimesheetTask = Builder.task(approveTimesheetWorkItem);
