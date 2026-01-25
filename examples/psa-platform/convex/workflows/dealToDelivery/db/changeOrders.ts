/**
 * Database functions for change orders
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type ChangeOrderStatus = Doc<"changeOrders">["status"];

export async function insertChangeOrder(
  db: DatabaseWriter,
  changeOrder: Omit<Doc<"changeOrders">, "_id" | "_creationTime">
): Promise<Id<"changeOrders">> {
  return await db.insert("changeOrders", changeOrder);
}

export async function getChangeOrder(
  db: DatabaseReader,
  changeOrderId: Id<"changeOrders">
): Promise<Doc<"changeOrders"> | null> {
  return await db.get(changeOrderId);
}

export async function updateChangeOrderStatus(
  db: DatabaseWriter,
  changeOrderId: Id<"changeOrders">,
  status: ChangeOrderStatus
): Promise<void> {
  const changeOrder = await db.get(changeOrderId);
  if (!changeOrder) {
    throw new EntityNotFoundError("ChangeOrder", { changeOrderId });
  }
  await db.patch(changeOrderId, { status });
}

export async function updateChangeOrder(
  db: DatabaseWriter,
  changeOrderId: Id<"changeOrders">,
  updates: Partial<Omit<Doc<"changeOrders">, "_id" | "_creationTime" | "organizationId" | "projectId">>
): Promise<void> {
  const changeOrder = await db.get(changeOrderId);
  if (!changeOrder) {
    throw new EntityNotFoundError("ChangeOrder", { changeOrderId });
  }
  await db.patch(changeOrderId, updates);
}

export async function listChangeOrdersByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 50
): Promise<Array<Doc<"changeOrders">>> {
  return await db
    .query("changeOrders")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(limit);
}

export async function listPendingChangeOrdersByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"changeOrders">>> {
  const changeOrders = await listChangeOrdersByProject(db, projectId);
  return changeOrders.filter((co) => co.status === "Pending");
}

export async function approveChangeOrder(
  db: DatabaseWriter,
  changeOrderId: Id<"changeOrders">,
  approverId: Id<"users">
): Promise<void> {
  await updateChangeOrder(db, changeOrderId, {
    status: "Approved",
    approvedBy: approverId,
    approvedAt: Date.now(),
  });
}

export async function rejectChangeOrder(
  db: DatabaseWriter,
  changeOrderId: Id<"changeOrders">
): Promise<void> {
  await updateChangeOrderStatus(db, changeOrderId, "Rejected");
}

/**
 * Calculate total approved budget impact for a project
 */
export async function calculateApprovedBudgetImpact(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<number> {
  const changeOrders = await listChangeOrdersByProject(db, projectId);
  return changeOrders
    .filter((co) => co.status === "Approved")
    .reduce((sum, co) => sum + co.budgetImpact, 0);
}
