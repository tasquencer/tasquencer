import {
  type AuthFunctions,
  type GenericCtx,
  createClient,
} from '@convex-dev/better-auth'
import { components, internal } from './_generated/api'
import { query } from './_generated/server'
import type { Id, DataModel } from './_generated/dataModel'
import { betterAuth } from 'better-auth'
import { convex } from '@convex-dev/better-auth/plugins'

// Typesafe way to pass Convex functions defined in this file
const authFunctions: AuthFunctions = internal.auth

// Initialize the component
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        // Get or create the default organization
        // TODO: In production, organization assignment should be more sophisticated (deferred:production-org-assignment)
        let defaultOrg = await ctx.db
          .query('organizations')
          .first()
        if (!defaultOrg) {
          const orgId = await ctx.db.insert('organizations', {
            name: 'Default Organization',
            settings: {},
            createdAt: Date.now(),
          })
          defaultOrg = await ctx.db.get(orgId)
        }

        // Create the user with required fields
        const userId = await ctx.db.insert('users', {
          organizationId: defaultOrg!._id,
          email: authUser.email ?? '',
          name: authUser.name ?? 'New User',
          role: 'teamMember', // Default role
          costRate: 0, // Needs to be set by admin
          billRate: 0, // Needs to be set by admin
          skills: [],
          department: '',
          location: '',
          isActive: true,
        })
        await authComponent.setUserId(ctx, authUser._id, userId)
      },
      onDelete: async (ctx, authUser) => {
        await ctx.db.delete(authUser.userId as Id<'users'>)
      },
    },
  },
})

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi()

// Example function for getting the current user
// Feel free to edit, omit, etc.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    // Get user data from Better Auth - email, name, image, etc.

    const userMetadata = await authComponent.safeGetAuthUser(ctx)
    if (!userMetadata) {
      return null
    }
    // Get user data from your application's database
    // (skip this if you have no fields in your users table schema)
    const user = await ctx.db.get(userMetadata.userId as Id<'users'>)
    return {
      ...user,
      ...userMetadata,
    }
  },
})

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  // Configure your Better Auth instance here
  betterAuth({
    // All auth requests will be proxied through your TanStack Start server
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx),

    // Simple non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      // The Convex plugin is required
      convex(),
    ],
  })
