/**
 * Database functions for users
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export async function insertUser(
  db: DatabaseWriter,
  user: Omit<Doc<"users">, "_id" | "_creationTime">
): Promise<Id<"users">> {
  return await db.insert("users", user);
}

export async function getUser(
  db: DatabaseReader,
  userId: Id<"users">
): Promise<Doc<"users"> | null> {
  return await db.get(userId);
}

export async function getUserByEmail(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  email: string
): Promise<Doc<"users"> | null> {
  return await db
    .query("users")
    .withIndex("by_email", (q) =>
      q.eq("organizationId", organizationId).eq("email", email)
    )
    .unique();
}

export async function updateUser(
  db: DatabaseWriter,
  userId: Id<"users">,
  updates: Partial<Omit<Doc<"users">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const user = await db.get(userId);
  if (!user) {
    throw new EntityNotFoundError("User", { userId });
  }
  await db.patch(userId, updates);
}

export async function listUsersByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 100
): Promise<Array<Doc<"users">>> {
  return await db
    .query("users")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(limit);
}

export async function listActiveUsersByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 100
): Promise<Array<Doc<"users">>> {
  const users = await listUsersByOrganization(db, organizationId, limit);
  return users.filter((u) => u.isActive);
}

export async function listUsersBySkill(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  skill: string,
  limit = 100
): Promise<Array<Doc<"users">>> {
  const users = await listUsersByOrganization(db, organizationId, limit);
  return users.filter((u) => u.skills.includes(skill));
}

export async function listUsersByDepartment(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  department: string,
  limit = 100
): Promise<Array<Doc<"users">>> {
  const users = await listUsersByOrganization(db, organizationId, limit);
  return users.filter((u) => u.department === department);
}
