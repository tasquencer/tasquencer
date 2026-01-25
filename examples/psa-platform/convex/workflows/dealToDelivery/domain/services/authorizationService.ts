/**
 * Authorization Service for Deal to Delivery Workflow
 *
 * Provides authorization helpers that ensure API endpoints and work items
 * are protected by scope-based access control.
 *
 * Pattern: examples/er/convex/workflows/er/domain/services/authorizationService.ts
 * Reference: .review/recipes/psa-platform/specs/02-authorization.md
 */
import type { Id } from "../../../../_generated/dataModel";
import type { QueryCtx } from "../../../../_generated/server";
import { authComponent } from "../../../../auth";
import { assertUserHasScope, type AppScope } from "../../../../authorization";

/**
 * Ensures the current user is an authenticated PSA staff member.
 * Throws an error if the user is not authenticated or doesn't have the required scope.
 *
 * This is the primary authorization helper for Deal to Delivery workflow APIs.
 *
 * @param ctx - Query context
 * @param requiredScope - The scope required (defaults to 'dealToDelivery:staff')
 * @returns The authenticated user's ID
 * @throws Error if user is not authenticated or not authorized
 */
export async function requirePsaStaffMember(
  ctx: QueryCtx,
  requiredScope: AppScope = "dealToDelivery:staff"
): Promise<Id<"users">> {
  const authUser = await authComponent.getAuthUser(ctx);

  await assertUserHasScope(ctx, requiredScope);

  return authUser.userId as Id<"users">;
}

/**
 * Checks if the current user can view deals.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot view deals
 */
export async function requireDealsViewAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:deals:view:own");
}

/**
 * Checks if the current user can create deals.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot create deals
 */
export async function requireDealsCreateAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:deals:create");
}

/**
 * Checks if the current user can edit deals.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot edit deals
 */
export async function requireDealsEditAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:deals:edit:own");
}

/**
 * Checks if the current user has admin rights.
 * Returns true if the user has the admin:users scope.
 *
 * This is used for features like releasing other users' work items.
 *
 * @param ctx - Query context
 * @returns True if user has admin access
 */
export async function hasAdminAccess(ctx: QueryCtx): Promise<boolean> {
  try {
    await assertUserHasScope(ctx, "dealToDelivery:admin:users");
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// PROJECT AUTHORIZATION HELPERS
// =============================================================================

/**
 * Checks if the current user can view projects.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot view projects
 */
export async function requireProjectViewAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:projects:view:own");
}

/**
 * Checks if the current user can edit projects.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot edit projects
 */
export async function requireProjectEditAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:projects:edit:own");
}

/**
 * Checks if the current user can view a specific project.
 *
 * Access is granted if the user has:
 * - 'dealToDelivery:projects:view:all' scope (can view all projects), OR
 * - 'dealToDelivery:projects:view:team' scope AND is in the same organization, OR
 * - 'dealToDelivery:projects:view:own' scope AND is the project manager or assigned to the project
 *
 * @param ctx - Query context
 * @param projectId - The project to check access for
 * @returns True if user can view the project
 */
export async function canViewProject(
  ctx: QueryCtx,
  projectId: Id<"projects">
): Promise<boolean> {
  // Must be authenticated
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return false;
  }

  // Check for all-access scope first
  try {
    await assertUserHasScope(ctx, "dealToDelivery:projects:view:all");
    return true;
  } catch {
    // Continue to check team/own access
  }

  // Get the project to check ownership/team membership
  const project = await ctx.db.get(projectId);
  if (!project) {
    return false;
  }

  // Get current user
  const user = await ctx.db.get(authUser.userId as Id<"users">);
  if (!user) {
    return false;
  }

  // Check team access (same organization)
  try {
    await assertUserHasScope(ctx, "dealToDelivery:projects:view:team");
    if (user.organizationId === project.organizationId) {
      return true;
    }
  } catch {
    // Continue to check own access
  }

  // Check own access (is project manager or assigned)
  try {
    await assertUserHasScope(ctx, "dealToDelivery:projects:view:own");
    // Check if user is the project manager
    if (project.managerId === authUser.userId) {
      return true;
    }
    // Check if user has any tasks assigned in this project
    // Note: assigneeIds is an array, so we query all project tasks and check membership
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const isAssignedToProject = projectTasks.some((task) =>
      task.assigneeIds.includes(authUser.userId as Id<"users">)
    );
    if (isAssignedToProject) {
      return true;
    }
  } catch {
    // No own access scope
  }

  return false;
}

// =============================================================================
// TASK AUTHORIZATION HELPERS
// =============================================================================

/**
 * Checks if the current user can view tasks.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot view tasks
 */
export async function requireTaskViewAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:tasks:view:own");
}

/**
 * Checks if the current user can edit tasks.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot edit tasks
 */
export async function requireTaskEditAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:tasks:edit:own");
}

/**
 * Checks if the current user can edit a specific task.
 *
 * Access is granted if the user has:
 * - 'dealToDelivery:tasks:edit:all' scope (can edit all tasks), OR
 * - 'dealToDelivery:tasks:edit:own' scope AND is the task assignee
 *
 * @param ctx - Query context
 * @param taskId - The task to check access for
 * @returns True if user can edit the task
 */
export async function canEditTask(
  ctx: QueryCtx,
  taskId: Id<"tasks">
): Promise<boolean> {
  // Must be authenticated
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return false;
  }

  // Check for all-access scope first
  try {
    await assertUserHasScope(ctx, "dealToDelivery:tasks:edit:all");
    return true;
  } catch {
    // Continue to check own access
  }

  // Get the task to check assignment
  const task = await ctx.db.get(taskId);
  if (!task) {
    return false;
  }

  // Check own access (is assignee)
  // Note: assigneeIds is an array, so we check if user is in the array
  try {
    await assertUserHasScope(ctx, "dealToDelivery:tasks:edit:own");
    if (task.assigneeIds.includes(authUser.userId as Id<"users">)) {
      return true;
    }
  } catch {
    // No own access scope
  }

  return false;
}

// =============================================================================
// BUDGET AUTHORIZATION HELPERS
// =============================================================================

/**
 * Checks if the current user can approve budget changes.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot approve budgets
 */
export async function requireBudgetApproveAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:budgets:approve");
}

/**
 * Checks if the current user can approve a specific budget/change order.
 *
 * Access is granted if the user has:
 * - 'dealToDelivery:budgets:approve' scope AND
 * - Is NOT the one who requested the change (no self-approval)
 *
 * @param ctx - Query context
 * @param requesterId - The ID of the user who requested the budget change
 * @returns True if user can approve the budget change
 */
export async function canApproveBudget(
  ctx: QueryCtx,
  requesterId: Id<"users">
): Promise<boolean> {
  // Must be authenticated
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return false;
  }

  // Check for budget approval scope
  try {
    await assertUserHasScope(ctx, "dealToDelivery:budgets:approve");
  } catch {
    return false;
  }

  // Self-approval is not allowed
  if (authUser.userId === requesterId) {
    return false;
  }

  return true;
}

// =============================================================================
// REPORTS AUTHORIZATION HELPERS
// =============================================================================

/**
 * Checks if the current user can view team-level reports.
 * Returns user ID if authorized, throws error otherwise.
 *
 * @param ctx - Query context
 * @returns The authenticated user's ID
 * @throws Error if user cannot view team reports
 */
export async function requireTeamReportsAccess(
  ctx: QueryCtx
): Promise<Id<"users">> {
  return requirePsaStaffMember(ctx, "dealToDelivery:reports:view:team");
}

/**
 * Checks if the current user can view team reports.
 *
 * Access is granted if the user has any of:
 * - 'dealToDelivery:reports:view:all' scope (all reports access), OR
 * - 'dealToDelivery:reports:view:team' scope (team reports access)
 *
 * @param ctx - Query context
 * @returns True if user can view team reports
 */
export async function canViewTeamReports(ctx: QueryCtx): Promise<boolean> {
  // Must be authenticated
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    return false;
  }

  // Check for all-access scope first
  try {
    await assertUserHasScope(ctx, "dealToDelivery:reports:view:all");
    return true;
  } catch {
    // Continue to check team access
  }

  // Check team access
  try {
    await assertUserHasScope(ctx, "dealToDelivery:reports:view:team");
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// ADMIN AUTHORIZATION HELPERS
// =============================================================================

/**
 * Checks if the current user can impersonate other users.
 * Returns true if the user has the admin:impersonate scope.
 *
 * This is a sensitive operation used for testing and support purposes.
 *
 * @param ctx - Query context
 * @returns True if user can impersonate
 */
export async function canImpersonate(ctx: QueryCtx): Promise<boolean> {
  try {
    await assertUserHasScope(ctx, "dealToDelivery:admin:impersonate");
    return true;
  } catch {
    return false;
  }
}
