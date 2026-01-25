import { mutation, query } from '../_generated/server'
import { components } from '../_generated/api'
import { v } from 'convex/values'
import { authService } from '../authorization'
import { assertUserHasScope } from '../authorization'

export const listUsers = query({
  handler: async (ctx) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.db.query('users').collect()
  },
})

export const listAuthGroups = query({
  handler: async (ctx) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.listAuthGroups,
      {},
    )
  },
})

export const listAuthRoles = query({
  handler: async (ctx) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.listAuthRoles,
      {},
    )
  },
})

export const listAuthGroupRoleAssignments = query({
  handler: async (ctx) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.listAuthGroupRoleAssignments,
      {},
    )
  },
})

export const updateUserAuthGroupMemberships = mutation({
  args: {
    userId: v.string(),
    groupIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.updateUserAuthGroupMemberships,
      args,
    )
  },
})

export const updateUserAuthRoleAssignments = mutation({
  args: {
    userId: v.string(),
    roleIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.updateUserAuthRoleAssignments,
      args,
    )
  },
})

export const getUserAuthGroupMemberships = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthGroupMemberships,
      args,
    )
  },
})

export const getUserAuthRoleAssignments = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthRoleAssignments,
      args,
    )
  },
})

export const createAuthGroup = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.createAuthGroup,
      args,
    )
  },
})

export const updateAuthGroup = mutation({
  args: {
    groupId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.updateAuthGroup,
      args,
    )
  },
})
export const deleteAuthGroup = mutation({
  args: {
    groupId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.deleteAuthGroup,
      args,
    )
  },
})

export const getAuthGroup = query({
  args: {
    groupId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthGroup,
      args,
    )
  },
})

export const getAuthGroupByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthGroupByName,
      args,
    )
  },
})

// ========================================
// Role Management
// ========================================

export const createAuthRole = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    scopes: v.array(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.createAuthRole,
      args,
    )
  },
})

export const updateAuthRole = mutation({
  args: {
    roleId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.updateAuthRole,
      args,
    )
  },
})

export const deleteAuthRole = mutation({
  args: {
    roleId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.deleteAuthRole,
      args,
    )
  },
})

export const getAuthRole = query({
  args: {
    roleId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthRole,
      args,
    )
  },
})

export const getAuthRoleByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthRoleByName,
      args,
    )
  },
})

// ========================================
// User-Group Membership Management
// ========================================

export const addUserToAuthGroup = mutation({
  args: {
    userId: v.string(),
    groupId: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.addUserToAuthGroup,
      args,
    )
  },
})

export const removeUserFromAuthGroup = mutation({
  args: {
    userId: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await assertUserHasScope(ctx, 'system:admin')
    await ctx.runMutation(
      components.tasquencerAuthorization.api.removeUserFromAuthGroup,
      args,
    )
  },
})

export const getUserAuthGroups = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthGroups,
      args,
    )
  },
})

// ========================================
// Group-Role Assignment Management
// ========================================

export const assignAuthRoleToGroup = mutation({
  args: {
    groupId: v.string(),
    roleId: v.string(),
    assignedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.assignAuthRoleToGroup,
      args,
    )
  },
})

export const removeAuthRoleFromGroup = mutation({
  args: {
    groupId: v.string(),
    roleId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.removeAuthRoleFromGroup,
      args,
    )
  },
})

export const getAuthGroupRoles = query({
  args: {
    groupId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthGroupRoles,
      args,
    )
  },
})

// ========================================
// User-Role Assignment Management
// ========================================

export const assignAuthRoleToUser = mutation({
  args: {
    userId: v.string(),
    roleId: v.string(),
    assignedBy: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.assignAuthRoleToUser,
      args,
    )
  },
})

export const removeAuthRoleFromUser = mutation({
  args: {
    userId: v.string(),
    roleId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.removeAuthRoleFromUser,
      args,
    )
  },
})

export const getUserAuthRoles = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthRoles,
      args,
    )
  },
})

// ========================================
// Admin Queries for UI
// ========================================

export const getAuthGroupMemberCount = query({
  args: {
    groupId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthGroupMemberCount,
      args,
    )
  },
})

export const getRoleScopes = query({
  args: {
    roleId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getRoleScopes,
      args,
    )
  },
})

export const getUserScopes = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserScopes,
      args,
    )
  },
})

export const userInGroup = query({
  args: {
    userId: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.userInGroup,
      args,
    )
  },
})

export const getGroupMembers = query({
  args: {
    groupId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getGroupMembers,
      args,
    )
  },
})

export const getUsersWithScope = query({
  args: {
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getUsersWithScope,
      args,
    )
  },
})

export const getGroupByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getGroupByName,
      args,
    )
  },
})

export const getRoleByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAuthorization.api.getRoleByName,
      args,
    )
  },
})

export const insertAuthRoles = mutation({
  args: {
    roles: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        scopes: v.array(v.string()),
        isActive: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.insertAuthRoles,
      args,
    )
  },
})

export const insertAuthGroups = mutation({
  args: {
    groups: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        isActive: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.insertAuthGroups,
      args,
    )
  },
})

export const insertAuthGroupRoleAssignments = mutation({
  args: {
    assignments: v.array(
      v.object({
        groupId: v.string(),
        roleId: v.string(),
        assignedAt: v.number(),
        assignedBy: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runMutation(
      components.tasquencerAuthorization.api.insertAuthGroupRoleAssignments,
      args,
    )
  },
})

// ========================================
// Available Scopes Query
// ========================================

export const listAvailableScopes = query({
  handler: async (ctx) => {
    await assertUserHasScope(ctx, 'system:admin')
    return Object.entries(authService.scopes).map(([scope, metadata]) => ({
      scope,
      description: metadata.description,
      type: metadata.type,
      tags: metadata.tags,
      deprecated: metadata.deprecated,
    }))
  },
})
