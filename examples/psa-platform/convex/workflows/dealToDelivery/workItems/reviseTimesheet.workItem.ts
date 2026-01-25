/**
 * ReviseTimesheet Work Item
 *
 * Correct rejected time entries and optionally resubmit.
 *
 * Entry condition: Time entries rejected by manager
 * Exit condition: Time entries revised, status = "Draft" or "Submitted"
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
import { getTimeEntry, updateTimeEntry, updateTimeEntryStatus } from "../db/timeEntries";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertTimeEntryExists, assertAuthenticatedUser } from "../exceptions";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:time:edit:own' scope
const timeEditPolicy = authService.policies.requireScope(
  "dealToDelivery:time:edit:own"
);

/**
 * Actions for the reviseTimesheet work item.
 *
 * - initialize: Sets up work item metadata with time entry context
 * - start: Claims the work item for the team member
 * - complete: Revises time entries and optionally resubmits
 * - fail: Marks the work item as failed
 */
const reviseTimesheetWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      timeEntryIds: z.array(zid("timeEntries")).min(1),
    }),
    timeEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate time entries exist and are rejected
      for (const timeEntryId of payload.timeEntryIds) {
        const timeEntry = await getTimeEntry(mutationCtx.db, timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId });

        if (timeEntry.status !== "Rejected") {
          throw new Error(
            `Time entry must be in Rejected status to revise. Entry ${timeEntryId} has status: ${timeEntry.status}`
          );
        }
      }

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:time:edit:own",
        dealId: deal._id,
        payload: {
          type: "reviseTimesheet",
          taskName: "Revise Timesheet",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), timeEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      timeEntryIds: z.array(zid("timeEntries")).min(1),
      revisions: z.array(z.object({
        timeEntryId: zid("timeEntries"),
        hours: z.number().min(0.25).max(24).optional(),
        projectId: zid("projects").optional(),
        taskId: zid("tasks").optional(),
        notes: z.string().optional(),
        billable: z.boolean().optional(),
        date: z.number().optional(),
      })),
      resubmit: z.boolean(),
    }),
    timeEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "reviseTimesheet:complete",
        workItemId: workItem.id,
      });

      const userId = authUser.userId as Id<"users">;

      // Apply revisions to each time entry
      for (const revision of payload.revisions) {
        const timeEntry = await getTimeEntry(mutationCtx.db, revision.timeEntryId);
        assertTimeEntryExists(timeEntry, { timeEntryId: revision.timeEntryId });

        // Validate entry belongs to current user
        if (timeEntry.userId !== userId) {
          throw new Error("Cannot revise time entries belonging to other users");
        }

        // Validate entry is in Rejected status
        if (timeEntry.status !== "Rejected") {
          throw new Error(
            `Time entry must be in Rejected status to revise. Entry ${revision.timeEntryId} has status: ${timeEntry.status}`
          );
        }

        // Build update object with only provided fields
        const updates: Parameters<typeof updateTimeEntry>[2] = {};
        if (revision.hours !== undefined) updates.hours = revision.hours;
        if (revision.projectId !== undefined) updates.projectId = revision.projectId;
        if (revision.taskId !== undefined) updates.taskId = revision.taskId;
        if (revision.notes !== undefined) updates.notes = revision.notes;
        if (revision.billable !== undefined) updates.billable = revision.billable;
        if (revision.date !== undefined) updates.date = revision.date;

        // Apply revisions if any
        if (Object.keys(updates).length > 0) {
          await updateTimeEntry(mutationCtx.db, revision.timeEntryId, updates);
        }

        // Update status based on resubmit flag
        const newStatus = payload.resubmit ? "Submitted" : "Draft";
        await updateTimeEntryStatus(mutationCtx.db, revision.timeEntryId, newStatus);
      }

      // Update work item metadata
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id
      );
      if (metadata) {
        await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
          type: "reviseTimesheet",
          taskName: "Revise Timesheet",
          priority: "normal",
        });
      }

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), timeEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The reviseTimesheet work item with actions and lifecycle activities.
 */
export const reviseTimesheetWorkItem = Builder.workItem("reviseTimesheet")
  .withActions(reviseTimesheetWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The reviseTimesheet task.
 */
export const reviseTimesheetTask = Builder.task(reviseTimesheetWorkItem);
