/**
 * Scaffold Domain Helpers
 *
 * Domain functions for scaffold/bootstrap operations that need
 * cross-organization access. These are intentionally separate from
 * the org-scoped db/users.ts functions.
 *
 * Follows TENET-DOMAIN-BOUNDARY: actions/mutations call domain functions,
 * not ctx.db directly.
 */
import type { DatabaseReader } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * List all users across all organizations.
 *
 * This is for bootstrap scenarios where we need to check total user count
 * (e.g., verify exactly one user exists for initial setup).
 */
export async function listAllUsers(
  db: DatabaseReader
): Promise<Array<Doc<"users">>> {
  return await db.query("users").collect();
}

/**
 * Find a user by email across all organizations.
 *
 * This is for superadmin scaffolding where we need to find a user
 * by email without knowing their organization.
 */
export async function getUserByEmailAnyOrg(
  db: DatabaseReader,
  email: string
): Promise<Doc<"users"> | null> {
  return await db
    .query("users")
    .filter((q) => q.eq(q.field("email"), email))
    .first();
}
