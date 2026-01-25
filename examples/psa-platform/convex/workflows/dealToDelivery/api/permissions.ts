/**
 * Permissions API
 *
 * Pre-flight authorization checks for the Deal to Delivery workflow.
 * UI components use these to determine what actions are available
 * before attempting them.
 *
 * TENET-AUTHZ: All permission checks properly validate user scopes.
 *
 * Reference: .review/recipes/psa-platform/specs/02-authorization.md
 * Pattern: examples/er/convex/workflows/er/api/permissions.ts
 */
import { v } from 'convex/values'
import { query } from '../../../_generated/server'
import { authComponent } from '../../../auth'
import { userHasScope } from '@repo/tasquencer/components/authorization/helpers'
import { components } from '../../../_generated/api'
import type { Id } from '../../../_generated/dataModel'
import type { AppScope } from '../../../authorization'
import { DealToDeliveryWorkItemHelpers } from '../helpers'

/**
 * Checks if the current user can create a new deal.
 * Used by UI to show/hide the "New Deal" button.
 *
 * @returns true if user has deals:create scope
 */
export const canCreateDeal = query({
  handler: async (ctx) => {
    try {
      const authUser = await authComponent.safeGetAuthUser(ctx)
      if (!authUser || !authUser.userId) {
        return false
      }
      return await userHasScope(
        ctx,
        components.tasquencerAuthorization,
        authUser.userId,
        'dealToDelivery:deals:create' as AppScope,
      )
    } catch {
      return false
    }
  },
})

/**
 * Checks if the current user can claim a specific work item.
 * Used by UI to show/hide the "Claim" button on work items.
 *
 * @param args.workItemId - The work item to check
 * @returns true if user can claim the work item
 */
export const canClaimWorkItem = query({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.safeGetAuthUser(ctx)
      if (!authUser || !authUser.userId) {
        return false
      }
      return await DealToDeliveryWorkItemHelpers.canUserClaimWorkItem(
        ctx,
        authUser.userId as Id<'users'>,
        args.workItemId,
      )
    } catch {
      return false
    }
  },
})

/**
 * Checks if the current user can complete a specific work item.
 * Only the user who claimed the work item can complete it.
 * Used by UI to show/hide the "Complete" button on work items.
 *
 * @param args.workItemId - The work item to check
 * @returns true if user can complete the work item
 */
export const canCompleteWorkItem = query({
  args: { workItemId: v.id('tasquencerWorkItems') },
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.safeGetAuthUser(ctx)
      if (!authUser || !authUser.userId) {
        return false
      }
      // User can complete if they have claimed the work item
      const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
        ctx.db,
        args.workItemId,
      )
      if (!metadata) {
        return false
      }
      // Check if the work item is claimed by this user
      if (
        metadata.claim &&
        'userId' in metadata.claim &&
        metadata.claim.userId === authUser.userId
      ) {
        return true
      }
      return false
    } catch {
      return false
    }
  },
})

/**
 * Checks if the current user has a specific scope.
 * General-purpose scope check for UI feature flags.
 *
 * @param args.scope - The scope to check
 * @returns true if user has the scope
 */
export const hasScope = query({
  args: { scope: v.string() },
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.safeGetAuthUser(ctx)
      if (!authUser || !authUser.userId) {
        return false
      }
      return await userHasScope(
        ctx,
        components.tasquencerAuthorization,
        authUser.userId,
        args.scope as AppScope,
      )
    } catch {
      return false
    }
  },
})
