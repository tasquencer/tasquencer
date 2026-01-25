/**
 * Database functions for milestones
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertMilestone(
  db: DatabaseWriter,
  milestone: Omit<Doc<"milestones">, "_id" | "_creationTime">
): Promise<Id<"milestones">> {
  return await db.insert("milestones", milestone);
}

export async function getMilestone(
  db: DatabaseReader,
  milestoneId: Id<"milestones">
): Promise<Doc<"milestones"> | null> {
  return await db.get(milestoneId);
}

export async function updateMilestone(
  db: DatabaseWriter,
  milestoneId: Id<"milestones">,
  updates: Partial<Omit<Doc<"milestones">, "_id" | "_creationTime" | "projectId" | "organizationId">>
): Promise<void> {
  const milestone = await db.get(milestoneId);
  if (!milestone) {
    throw new EntityNotFoundError("Milestone", { milestoneId });
  }
  await db.patch(milestoneId, updates);
}

export async function deleteMilestone(
  db: DatabaseWriter,
  milestoneId: Id<"milestones">
): Promise<void> {
  await db.delete(milestoneId);
}

export async function listMilestonesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"milestones">>> {
  return await db
    .query("milestones")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
}

export async function listCompletedMilestones(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"milestones">>> {
  const milestones = await listMilestonesByProject(db, projectId);
  return milestones.filter((m) => m.completedAt !== undefined);
}

export async function listUninvoicedMilestones(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"milestones">>> {
  const milestones = await listMilestonesByProject(db, projectId);
  return milestones.filter(
    (m) => m.completedAt !== undefined && !m.invoiceId
  );
}

export async function completeMilestone(
  db: DatabaseWriter,
  milestoneId: Id<"milestones">
): Promise<void> {
  await updateMilestone(db, milestoneId, { completedAt: Date.now() });
}

export async function markMilestoneInvoiced(
  db: DatabaseWriter,
  milestoneId: Id<"milestones">,
  invoiceId: Id<"invoices">
): Promise<void> {
  await updateMilestone(db, milestoneId, { invoiceId });
}

/**
 * Get the next sort order for a new milestone in a project
 */
export async function getNextMilestoneSortOrder(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<number> {
  const milestones = await listMilestonesByProject(db, projectId);
  if (milestones.length === 0) return 0;
  return Math.max(...milestones.map((m) => m.sortOrder)) + 1;
}
