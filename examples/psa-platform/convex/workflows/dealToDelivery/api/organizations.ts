/**
 * Organizations API
 *
 * Query endpoints for organization and user data access.
 *
 * TENET-AUTHZ: All queries are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getOrganization as getOrganizationFromDb,
  getUser as getUserFromDb,
  listUsersByOrganization,
  listActiveUsersByOrganization,
  listUsersBySkill,
  listUsersByDepartment,
} from '../db'
import { authComponent } from '../../../auth'

/**
 * Gets the current user's organization.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @returns The organization document or null if not found
 */
export const getOrganization = query({
  args: {},
  handler: async (ctx) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUserFromDb(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return null
    }

    return await getOrganizationFromDb(ctx.db, user.organizationId)
  },
})

/**
 * Lists users in the current user's organization.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.activeOnly - If true, only return active users (default: false)
 * @param args.skill - Optional filter by skill
 * @param args.department - Optional filter by department
 * @param args.limit - Maximum number of users to return (default: 100)
 * @returns Array of user documents
 */
export const listUsers = query({
  args: {
    activeOnly: v.optional(v.boolean()),
    skill: v.optional(v.string()),
    department: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUserFromDb(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return []
    }

    const limit = args.limit ?? 100
    const organizationId = user.organizationId

    // Apply filters based on provided arguments
    // Priority: skill > department > activeOnly > all
    if (args.skill) {
      const users = await listUsersBySkill(
        ctx.db,
        organizationId,
        args.skill,
        limit
      )
      // Apply additional activeOnly filter if specified
      if (args.activeOnly) {
        return users.filter((u) => u.isActive)
      }
      return users
    }

    if (args.department) {
      const users = await listUsersByDepartment(
        ctx.db,
        organizationId,
        args.department,
        limit
      )
      // Apply additional activeOnly filter if specified
      if (args.activeOnly) {
        return users.filter((u) => u.isActive)
      }
      return users
    }

    if (args.activeOnly) {
      return await listActiveUsersByOrganization(ctx.db, organizationId, limit)
    }

    return await listUsersByOrganization(ctx.db, organizationId, limit)
  },
})

/**
 * Gets a user by ID with their skills.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.userId - The user ID to retrieve
 * @returns The user document with skills or null if not found
 */
export const getUser = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const user = await getUserFromDb(ctx.db, args.userId)
    if (!user) {
      return null
    }

    // User document already includes skills array
    return user
  },
})

/**
 * Gets the current authenticated user.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @returns The current user document or null if not found
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requirePsaStaffMember(ctx)
    return await getUserFromDb(ctx.db, userId)
  },
})
