import {
  type GetAuthorizationServiceScopes,
  createSystemScopeModule,
} from '@repo/tasquencer'
import { Authorization } from './tasquencer'
import { authComponent } from './auth'
import type { QueryCtx } from './_generated/server'
import { userHasScope } from '@repo/tasquencer/components/authorization/helpers'
import { components } from './_generated/api'

// Import workflow scope modules here after scaffolding:
// import { workflowScopeModule } from './workflows/<name>/scopes'

const userProvider = Authorization.UserProvider.withGetUser((ctx) => {
  return authComponent.safeGetAuthUser(ctx)
}).withUserToUserId((user) => {
  return user._id
})

/**
 * System Scope Module
 * Defines system-level scopes for application-wide permissions
 */
const systemScopeModule = createSystemScopeModule('system')
  .withScope('admin', {
    description: 'Full administrative access to the system',
    tags: ['system', 'admin'],
  })
  .withScope('read', {
    description: 'Read-only access to system resources',
    tags: ['system', 'read'],
  })
  .withScope('write', {
    description: 'Write access to system resources',
    tags: ['system', 'write'],
  })

/**
 * Application Authorization Service
 * Single service instance that combines all scope modules
 */
export const authService = Authorization.Service.make(userProvider)
  .withScopeModule(systemScopeModule)
  // Register workflow scope modules here:
  // .withScopeModule(workflowScopeModule)
  .build()

/**
 * Type helper to extract all scope strings from the auth service
 */
export type AppScope = GetAuthorizationServiceScopes<typeof authService>

export async function assertUserHasScope(ctx: QueryCtx, scope: AppScope) {
  const user = await authComponent.getAuthUser(ctx)
  if (!user || !user.userId) {
    throw new Error('User not authenticated')
  }
  const hasScope = await userHasScope(
    ctx,
    components.tasquencerAuthorization,
    user.userId,
    scope,
  )
  if (!hasScope) {
    throw new Error(`User ${user.userId} does not have scope ${scope}`)
  }
}
