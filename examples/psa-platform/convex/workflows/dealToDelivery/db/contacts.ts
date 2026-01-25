/**
 * Database functions for contacts
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertContact(
  db: DatabaseWriter,
  contact: Omit<Doc<"contacts">, "_id" | "_creationTime">
): Promise<Id<"contacts">> {
  return await db.insert("contacts", contact);
}

export async function getContact(
  db: DatabaseReader,
  contactId: Id<"contacts">
): Promise<Doc<"contacts"> | null> {
  return await db.get(contactId);
}

export async function updateContact(
  db: DatabaseWriter,
  contactId: Id<"contacts">,
  updates: Partial<Omit<Doc<"contacts">, "_id" | "_creationTime" | "organizationId" | "companyId">>
): Promise<void> {
  const contact = await db.get(contactId);
  if (!contact) {
    throw new EntityNotFoundError("Contact", { contactId });
  }
  await db.patch(contactId, updates);
}

export async function listContactsByCompany(
  db: DatabaseReader,
  companyId: Id<"companies">,
  limit = 50
): Promise<Array<Doc<"contacts">>> {
  return await db
    .query("contacts")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(limit);
}

export async function listContactsByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 100
): Promise<Array<Doc<"contacts">>> {
  return await db
    .query("contacts")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(limit);
}

export async function getPrimaryContactForCompany(
  db: DatabaseReader,
  companyId: Id<"companies">
): Promise<Doc<"contacts"> | null> {
  const contacts = await listContactsByCompany(db, companyId);
  return contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
}
