/**
 * Database functions for rate cards
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

// Rate Cards

export async function insertRateCard(
  db: DatabaseWriter,
  rateCard: Omit<Doc<"rateCards">, "_id" | "_creationTime">
): Promise<Id<"rateCards">> {
  return await db.insert("rateCards", rateCard);
}

export async function getRateCard(
  db: DatabaseReader,
  rateCardId: Id<"rateCards">
): Promise<Doc<"rateCards"> | null> {
  return await db.get(rateCardId);
}

export async function updateRateCard(
  db: DatabaseWriter,
  rateCardId: Id<"rateCards">,
  updates: Partial<Omit<Doc<"rateCards">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const rateCard = await db.get(rateCardId);
  if (!rateCard) {
    throw new EntityNotFoundError("RateCard", { rateCardId });
  }
  await db.patch(rateCardId, updates);
}

export async function deleteRateCard(
  db: DatabaseWriter,
  rateCardId: Id<"rateCards">
): Promise<void> {
  await db.delete(rateCardId);
}

export async function listRateCardsByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">
): Promise<Array<Doc<"rateCards">>> {
  return await db
    .query("rateCards")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
}

export async function getDefaultRateCard(
  db: DatabaseReader,
  organizationId: Id<"organizations">
): Promise<Doc<"rateCards"> | null> {
  const rateCards = await listRateCardsByOrganization(db, organizationId);
  return rateCards.find((rc) => rc.isDefault) ?? rateCards[0] ?? null;
}

export async function setDefaultRateCard(
  db: DatabaseWriter,
  rateCardId: Id<"rateCards">
): Promise<void> {
  const rateCard = await getRateCard(db, rateCardId);
  if (!rateCard) {
    throw new EntityNotFoundError("RateCard", { rateCardId });
  }

  // Unset any existing default
  const existingDefault = await getDefaultRateCard(db, rateCard.organizationId);
  if (existingDefault && existingDefault._id !== rateCardId) {
    await updateRateCard(db, existingDefault._id, { isDefault: false });
  }

  // Set new default
  await updateRateCard(db, rateCardId, { isDefault: true });
}

// Rate Card Items

export async function insertRateCardItem(
  db: DatabaseWriter,
  item: Omit<Doc<"rateCardItems">, "_id" | "_creationTime">
): Promise<Id<"rateCardItems">> {
  return await db.insert("rateCardItems", item);
}

export async function getRateCardItem(
  db: DatabaseReader,
  itemId: Id<"rateCardItems">
): Promise<Doc<"rateCardItems"> | null> {
  return await db.get(itemId);
}

export async function updateRateCardItem(
  db: DatabaseWriter,
  itemId: Id<"rateCardItems">,
  updates: Partial<Omit<Doc<"rateCardItems">, "_id" | "_creationTime" | "rateCardId">>
): Promise<void> {
  const item = await db.get(itemId);
  if (!item) {
    throw new EntityNotFoundError("RateCardItem", { rateCardItemId: itemId });
  }
  await db.patch(itemId, updates);
}

export async function deleteRateCardItem(
  db: DatabaseWriter,
  itemId: Id<"rateCardItems">
): Promise<void> {
  await db.delete(itemId);
}

export async function listRateCardItems(
  db: DatabaseReader,
  rateCardId: Id<"rateCards">
): Promise<Array<Doc<"rateCardItems">>> {
  return await db
    .query("rateCardItems")
    .withIndex("by_rate_card", (q) => q.eq("rateCardId", rateCardId))
    .collect();
}

export async function getRateForService(
  db: DatabaseReader,
  rateCardId: Id<"rateCards">,
  serviceName: string
): Promise<number | null> {
  const items = await listRateCardItems(db, rateCardId);
  const item = items.find((i) => i.serviceName === serviceName);
  return item?.rate ?? null;
}
