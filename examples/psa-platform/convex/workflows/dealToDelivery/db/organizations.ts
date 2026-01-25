/**
 * Database functions for organizations
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertOrganization(
  db: DatabaseWriter,
  org: Omit<Doc<"organizations">, "_id" | "_creationTime">
): Promise<Id<"organizations">> {
  return await db.insert("organizations", org);
}

export async function getOrganization(
  db: DatabaseReader,
  orgId: Id<"organizations">
): Promise<Doc<"organizations"> | null> {
  return await db.get(orgId);
}

export async function updateOrganization(
  db: DatabaseWriter,
  orgId: Id<"organizations">,
  updates: Partial<Omit<Doc<"organizations">, "_id" | "_creationTime">>
): Promise<void> {
  const org = await db.get(orgId);
  if (!org) {
    throw new EntityNotFoundError("Organization", { organizationId: orgId });
  }
  await db.patch(orgId, updates);
}

export async function listOrganizations(
  db: DatabaseReader,
  limit = 50
): Promise<Array<Doc<"organizations">>> {
  return await db.query("organizations").order("desc").take(limit);
}
