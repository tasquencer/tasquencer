/**
 * RejectTimesheet Work Item
 *
 * Reject time entries with feedback for correction.
 *
 * Entry condition: reviewTimesheet completed with decision = "reject"
 * Exit condition: Time entries status = "Rejected", routed to reviseTimesheet
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
import { getTimeEntry, rejectTimeEntryWithRevisionTracking } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { getUser, listUsersByOrganization } from "../db/users";
import {
  insertNotification,
  generateTimesheetRejectedContent,
  generateTimesheetEscalatedContent,
} from "../db/notifications";
import { assertTimeEntryExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { MAX_REVISION_CYCLES } from "../db/revisionCycle";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:approve' scope (approvers can also reject)
const timeApprovePolicy = authService.policies.requireScope(
  "dealToDelivery:time:approve"
);

/**
 * Actions for the rejectTimesheet work item.
 *
 * - initialize: Sets up work item metadata with time entry context
 * - start: Claims the work item for the reviewer
 * - complete: Rejects time entries with feedback
 * - fail: Marks the work item as failed
 */
const rejectTimesheetWorkItemActions = authService.builders.workItemActions
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
          type: "rejectTimesheet",
          taskName: "Reject Timesheet",
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
      comments: z.string().min(1, "Rejection reason is required"),
    }),
    timeApprovePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "rejectTimesheet:complete",
        workItemId: workItem.id,
      });


      // Track if any entries need escalation
      let anyEscalated = false;
      const rejectionResults: Array<{ entryId: string; revisionCount: number; escalated: boolean }> = [];

      // Reject each time entry with revision tracking
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });

        // Validate entry is in correct status
        if (timeEntry.status !== "Submitted") {
          throw new Error(
            `Time entry must be in Submitted status to reject. Entry ${timeEntryId} has status: ${timeEntry.status}`
          );
        }

        // Reject with revision tracking (per spec 09-workflow-timesheet-approval.md line 281)
        const result = await rejectTimeEntryWithRevisionTracking(
          mutationCtx.db,
          timeEntryId,
          payload.comments,
          MAX_REVISION_CYCLES
        );

        rejectionResults.push({
          entryId: timeEntryId,
          revisionCount: result.newRevisionCount,
          escalated: result.escalated,
        });

        if (result.escalated) {
          anyEscalated = true;
        }
      }

      // Update work item metadata with escalation status
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "rejectTimesheet",
          taskName: anyEscalated ? "Reject Timesheet (Escalated to Admin)" : "Reject Timesheet",
          priority: anyEscalated ? "high" : "normal",
        });
      }

      // Notify team member(s) that their timesheet was rejected with comments
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      // Group entries by user to avoid duplicate notifications
      const userRejections = new Map<Id<"users">, { count: number; escalated: boolean }>();
      for (const result of rejectionResults) {
        const entry = await getTimeEntry(mutationCtx.db, result.entryId as Id<"timeEntries">);
        if (entry) {
          const existing = userRejections.get(entry.userId);
          if (existing) {
            existing.count++;
            existing.escalated = existing.escalated || result.escalated;
          } else {
            userRejections.set(entry.userId, { count: 1, escalated: result.escalated });
          }
        }
      }

      for (const [userId, { count, escalated }] of userRejections) {
        const content = generateTimesheetRejectedContent(count, payload.comments);
        await insertNotification(mutationCtx.db, {
          organizationId: deal.organizationId,
          userId: userId,
          type: "timesheet_rejected",
          resourceType: "timeEntry",
          resourceId: payload.timeEntryIds.join(","),
          title: content.title,
          message: content.message,
          data: {
            timeEntryIds: payload.timeEntryIds,
            comments: payload.comments,
            escalated,
          },
        });
      }

      // If escalated, also notify admin (per spec 09-workflow-timesheet-approval.md line 281)
      if (anyEscalated) {
        // Find admin users in the organization
        const allUsers = await listUsersByOrganization(mutationCtx.db, deal.organizationId);
        const adminUsers = allUsers.filter((u) => u.role === "psa_admin");

        // Get submitting user's name for the escalation notification
        const firstEntry = await getTimeEntry(mutationCtx.db, payload.timeEntryIds[0]);
        const submittingUser = firstEntry
          ? await getUser(mutationCtx.db, firstEntry.userId)
          : null;
        const userName = submittingUser?.name ?? "Team member";

        const maxRevision = Math.max(...rejectionResults.map((r) => r.revisionCount));
        const escalationContent = generateTimesheetEscalatedContent(userName, maxRevision);

        for (const admin of adminUsers) {
          await insertNotification(mutationCtx.db, {
            organizationId: deal.organizationId,
            userId: admin._id,
            type: "timesheet_escalated",
            resourceType: "timeEntry",
            resourceId: payload.timeEntryIds.join(","),
            title: escalationContent.title,
            message: escalationContent.message,
            data: {
              timeEntryIds: payload.timeEntryIds,
              submittedBy: firstEntry?.userId,
              submittedByName: userName,
              revisionCount: maxRevision,
            },
          });
        }
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeApprovePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The rejectTimesheet work item with actions and lifecycle activities.
 */
export const rejectTimesheetWorkItem = Builder.workItem("rejectTimesheet")
  .withActions(rejectTimesheetWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The rejectTimesheet task.
 */
export const rejectTimesheetTask = Builder.task(rejectTimesheetWorkItem);
