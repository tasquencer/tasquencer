/**
 * Database functions for estimates and estimate services
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertEstimate(
  db: DatabaseWriter,
  estimate: Omit<Doc<"estimates">, "_id" | "_creationTime">
): Promise<Id<"estimates">> {
  return await db.insert("estimates", estimate);
}

export async function getEstimate(
  db: DatabaseReader,
  estimateId: Id<"estimates">
): Promise<Doc<"estimates"> | null> {
  return await db.get(estimateId);
}

export async function getEstimateByDealId(
  db: DatabaseReader,
  dealId: Id<"deals">
): Promise<Doc<"estimates"> | null> {
  return await db
    .query("estimates")
    .withIndex("by_deal", (q) => q.eq("dealId", dealId))
    .order("desc")
    .first();
}

export async function listEstimatesByDeal(
  db: DatabaseReader,
  dealId: Id<"deals">,
  limit = 10
): Promise<Array<Doc<"estimates">>> {
  return await db
    .query("estimates")
    .withIndex("by_deal", (q) => q.eq("dealId", dealId))
    .order("desc")
    .take(limit);
}

export async function updateEstimate(
  db: DatabaseWriter,
  estimateId: Id<"estimates">,
  updates: Partial<Omit<Doc<"estimates">, "_id" | "_creationTime" | "organizationId" | "dealId">>
): Promise<void> {
  const estimate = await db.get(estimateId);
  if (!estimate) {
    throw new EntityNotFoundError("Estimate", { estimateId });
  }
  await db.patch(estimateId, updates);
}

// Estimate Services

export async function insertEstimateService(
  db: DatabaseWriter,
  service: Omit<Doc<"estimateServices">, "_id" | "_creationTime">
): Promise<Id<"estimateServices">> {
  return await db.insert("estimateServices", service);
}

export async function getEstimateService(
  db: DatabaseReader,
  serviceId: Id<"estimateServices">
): Promise<Doc<"estimateServices"> | null> {
  return await db.get(serviceId);
}

export async function listEstimateServices(
  db: DatabaseReader,
  estimateId: Id<"estimates">
): Promise<Array<Doc<"estimateServices">>> {
  return await db
    .query("estimateServices")
    .withIndex("by_estimate", (q) => q.eq("estimateId", estimateId))
    .collect();
}

export async function updateEstimateService(
  db: DatabaseWriter,
  serviceId: Id<"estimateServices">,
  updates: Partial<Omit<Doc<"estimateServices">, "_id" | "_creationTime" | "estimateId">>
): Promise<void> {
  const service = await db.get(serviceId);
  if (!service) {
    throw new EntityNotFoundError("EstimateService", { estimateServiceId: serviceId });
  }
  await db.patch(serviceId, updates);
}

export async function deleteEstimateService(
  db: DatabaseWriter,
  serviceId: Id<"estimateServices">
): Promise<void> {
  await db.delete(serviceId);
}

/**
 * Calculate the total for an estimate based on its services
 */
export async function recalculateEstimateTotal(
  db: DatabaseWriter,
  estimateId: Id<"estimates">
): Promise<number> {
  const services = await listEstimateServices(db, estimateId);
  const total = services.reduce((sum, s) => sum + s.total, 0);
  await db.patch(estimateId, { total });
  return total;
}
