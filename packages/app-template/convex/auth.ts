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
        const userId = await ctx.db.insert('users', {})
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
