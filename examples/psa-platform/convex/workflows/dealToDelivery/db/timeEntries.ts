/**
 * Database functions for time entries
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type TimeEntryStatus = Doc<"timeEntries">["status"];

export async function insertTimeEntry(
  db: DatabaseWriter,
  entry: Omit<Doc<"timeEntries">, "_id" | "_creationTime">
): Promise<Id<"timeEntries">> {
  return await db.insert("timeEntries", entry);
}

export async function getTimeEntry(
  db: DatabaseReader,
  entryId: Id<"timeEntries">
): Promise<Doc<"timeEntries"> | null> {
  return await db.get(entryId);
}

export async function updateTimeEntryStatus(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  status: TimeEntryStatus
): Promise<void> {
  const entry = await db.get(entryId);
  if (!entry) {
    throw new EntityNotFoundError("TimeEntry", { timeEntryId: entryId });
  }
  await db.patch(entryId, { status });
}

export async function updateTimeEntry(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  updates: Partial<Omit<Doc<"timeEntries">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const entry = await db.get(entryId);
  if (!entry) {
    throw new EntityNotFoundError("TimeEntry", { timeEntryId: entryId });
  }
  await db.patch(entryId, updates);
}

export async function listTimeEntriesByUser(
  db: DatabaseReader,
  userId: Id<"users">,
  limit = 100
): Promise<Array<Doc<"timeEntries">>> {
  return await db
    .query("timeEntries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function listTimeEntriesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"timeEntries">>> {
  return await db
    .query("timeEntries")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(limit);
}

export async function listTimeEntriesByUserAndDate(
  db: DatabaseReader,
  userId: Id<"users">,
  date: number,
  limit = 50
): Promise<Array<Doc<"timeEntries">>> {
  return await db
    .query("timeEntries")
    .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
    .take(limit);
}

export async function listTimeEntriesByStatus(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  status: TimeEntryStatus,
  limit = 100
): Promise<Array<Doc<"timeEntries">>> {
  return await db
    .query("timeEntries")
    .withIndex("by_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export async function listSubmittedTimeEntriesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 100
): Promise<Array<Doc<"timeEntries">>> {
  const entries = await listTimeEntriesByProject(db, projectId, limit);
  return entries.filter((e) => e.status === "Submitted");
}

export async function listApprovedTimeEntriesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"timeEntries">>> {
  const entries = await listTimeEntriesByProject(db, projectId, limit);
  return entries.filter((e) => e.status === "Approved");
}

export async function listBillableUninvoicedTimeEntries(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"timeEntries">>> {
  const entries = await listTimeEntriesByProject(db, projectId, limit);
  return entries.filter(
    (e) => e.billable && e.status === "Approved" && !e.invoiceId
  );
}

export async function approveTimeEntry(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  approverId: Id<"users">
): Promise<void> {
  await updateTimeEntry(db, entryId, {
    status: "Approved",
    approvedBy: approverId,
    approvedAt: Date.now(),
    rejectionComments: undefined,
  });
}

export async function rejectTimeEntry(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  comments: string
): Promise<void> {
  await updateTimeEntry(db, entryId, {
    status: "Rejected",
    rejectionComments: comments,
  });
}

/**
 * Reject a time entry with revision cycle tracking.
 * Increments the revision count and sets escalation flag if limit reached.
 * Per spec 09-workflow-timesheet-approval.md line 281: "After 3 revision cycles, escalate to admin"
 */
export async function rejectTimeEntryWithRevisionTracking(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  comments: string,
  maxRevisionCycles: number = 3
): Promise<{ newRevisionCount: number; escalated: boolean }> {
  const entry = await db.get(entryId);
  if (!entry) {
    throw new EntityNotFoundError("TimeEntry", { timeEntryId: entryId });
  }

  const currentCount = entry.revisionCount ?? 0;
  const newRevisionCount = currentCount + 1;
  const escalated = newRevisionCount >= maxRevisionCycles;

  await db.patch(entryId, {
    status: "Rejected",
    rejectionComments: comments,
    revisionCount: newRevisionCount,
    escalatedToAdmin: escalated,
  });

  return { newRevisionCount, escalated };
}

export async function lockTimeEntry(
  db: DatabaseWriter,
  entryId: Id<"timeEntries">,
  invoiceId: Id<"invoices">
): Promise<void> {
  await updateTimeEntry(db, entryId, {
    status: "Locked",
    invoiceId,
  });
}

/**
 * Calculate total hours for a project
 */
export async function calculateProjectHours(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<{ total: number; billable: number; approved: number }> {
  const entries = await listTimeEntriesByProject(db, projectId);

  let total = 0;
  let billable = 0;
  let approved = 0;

  for (const entry of entries) {
    total += entry.hours;
    if (entry.billable) billable += entry.hours;
    if (entry.status === "Approved" || entry.status === "Locked") {
      approved += entry.hours;
    }
  }

  return { total, billable, approved };
}
