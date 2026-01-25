/**
 * Database functions for budgets and services
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type BudgetType = Doc<"budgets">["type"];

export async function insertBudget(
  db: DatabaseWriter,
  budget: Omit<Doc<"budgets">, "_id" | "_creationTime">
): Promise<Id<"budgets">> {
  return await db.insert("budgets", budget);
}

export async function getBudget(
  db: DatabaseReader,
  budgetId: Id<"budgets">
): Promise<Doc<"budgets"> | null> {
  return await db.get(budgetId);
}

export async function getBudgetByProjectId(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Doc<"budgets"> | null> {
  return await db
    .query("budgets")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
}

export async function updateBudget(
  db: DatabaseWriter,
  budgetId: Id<"budgets">,
  updates: Partial<Omit<Doc<"budgets">, "_id" | "_creationTime" | "projectId" | "organizationId">>
): Promise<void> {
  const budget = await db.get(budgetId);
  if (!budget) {
    throw new EntityNotFoundError("Budget", { budgetId });
  }
  await db.patch(budgetId, updates);
}

// Services (budget line items)

export async function insertService(
  db: DatabaseWriter,
  service: Omit<Doc<"services">, "_id" | "_creationTime">
): Promise<Id<"services">> {
  return await db.insert("services", service);
}

export async function getService(
  db: DatabaseReader,
  serviceId: Id<"services">
): Promise<Doc<"services"> | null> {
  return await db.get(serviceId);
}

export async function listServicesByBudget(
  db: DatabaseReader,
  budgetId: Id<"budgets">
): Promise<Array<Doc<"services">>> {
  return await db
    .query("services")
    .withIndex("by_budget", (q) => q.eq("budgetId", budgetId))
    .collect();
}

export async function updateService(
  db: DatabaseWriter,
  serviceId: Id<"services">,
  updates: Partial<Omit<Doc<"services">, "_id" | "_creationTime" | "budgetId" | "organizationId">>
): Promise<void> {
  const service = await db.get(serviceId);
  if (!service) {
    throw new EntityNotFoundError("Service", { serviceId });
  }
  await db.patch(serviceId, updates);
}

export async function deleteService(
  db: DatabaseWriter,
  serviceId: Id<"services">
): Promise<void> {
  await db.delete(serviceId);
}

/**
 * Calculate the total budget amount from services
 */
export async function recalculateBudgetTotal(
  db: DatabaseWriter,
  budgetId: Id<"budgets">
): Promise<number> {
  const services = await listServicesByBudget(db, budgetId);
  const total = services.reduce((sum, s) => sum + s.totalAmount, 0);
  await db.patch(budgetId, { totalAmount: total });
  return total;
}
