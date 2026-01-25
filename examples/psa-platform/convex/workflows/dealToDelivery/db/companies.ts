/**
 * Database functions for companies (clients)
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertCompany(
  db: DatabaseWriter,
  company: Omit<Doc<"companies">, "_id" | "_creationTime">
): Promise<Id<"companies">> {
  return await db.insert("companies", company);
}

export async function getCompany(
  db: DatabaseReader,
  companyId: Id<"companies">
): Promise<Doc<"companies"> | null> {
  return await db.get(companyId);
}

export async function updateCompany(
  db: DatabaseWriter,
  companyId: Id<"companies">,
  updates: Partial<Omit<Doc<"companies">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const company = await db.get(companyId);
  if (!company) {
    throw new EntityNotFoundError("Company", { companyId });
  }
  await db.patch(companyId, updates);
}

export async function listCompaniesByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 50
): Promise<Array<Doc<"companies">>> {
  return await db
    .query("companies")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(limit);
}
