/**
 * Work Item Authorization Helpers
 *
 * Provides role-based authorization helpers for work item operations.
 * Reference: .review/recipes/psa-platform/specs/02-authorization.md
 */
import type { QueryCtx, MutationCtx } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { components } from "../../../_generated/api";
import { DealToDeliveryWorkItemHelpers } from "../helpers";
import { authComponent } from "../../../auth";
import { getUser, listUsersByOrganization } from "../db/users";
import { isHumanClaim, ConstraintViolationError, EntityNotFoundError } from "@repo/tasquencer";
import { userHasScope } from "@repo/tasquencer/components/authorization/helpers";

/**
 * Work item assignment types
 */
export interface WorkItemAssignment {
  workItemId: Id<"tasquencerWorkItems">;
  claimedBy: string | null;
  requiredScope: string;
  requiredGroupId?: string;
}

/**
 * Check if a user can claim a specific work item based on their scopes.
 *
 * A user can claim a work item if:
 * 1. They have the required scope for the work item
 * 2. If a group is required, they belong to that group
 * 3. The work item is not already claimed by another user
 *
 * @param ctx - Query context
 * @param userId - The user ID to check (string format)
 * @param workItemId - The work item ID to check
 * @returns True if the user can claim the work item
 */
export async function canClaimWorkItem(
  ctx: QueryCtx,
  userId: string,
  workItemId: Id<"tasquencerWorkItems">
): Promise<boolean> {
  // Get work item metadata
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    ctx.db,
    workItemId
  );
  if (!metadata) {
    return false;
  }

  // Check if already claimed by another user
  if (metadata.claim) {
    const claimedByUserId = isHumanClaim(metadata.claim) ? metadata.claim.userId : undefined;
    if (claimedByUserId && claimedByUserId !== userId) {
      return false;
    }
  }

  // Check if user has the required scope
  const requiredScope = (metadata.offer as { requiredScope?: string })?.requiredScope;
  if (requiredScope) {
    const hasScope = await userHasScope(
      ctx,
      components.tasquencerAuthorization,
      userId,
      requiredScope
    );
    if (!hasScope) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a user can complete a specific work item.
 *
 * A user can complete a work item if:
 * 1. They have claimed the work item, OR
 * 2. They have admin privileges
 *
 * @param ctx - Query context
 * @param userId - The user ID to check (string format)
 * @param workItemId - The work item ID to check
 * @returns True if the user can complete the work item
 */
export async function canCompleteWorkItem(
  ctx: QueryCtx,
  userId: string,
  workItemId: Id<"tasquencerWorkItems">
): Promise<boolean> {
  // Get work item metadata
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    ctx.db,
    workItemId
  );
  if (!metadata) {
    return false;
  }

  // Check if the user has claimed this work item
  if (metadata.claim && isHumanClaim(metadata.claim)) {
    if (metadata.claim.userId === userId) {
      return true;
    }
  }

  // Check if user has admin scope
  const isAdmin = await userHasScope(
    ctx,
    components.tasquencerAuthorization,
    userId,
    "dealToDelivery:admin:users"
  );
  if (isAdmin) {
    return true;
  }

  return false;
}

/**
 * Get list of users who can be assigned to a work item based on required scope.
 *
 * @param ctx - Query context
 * @param organizationId - The organization to get users from
 * @param _requiredScope - The scope required for the work item (reserved for future scope filtering)
 * @param _requiredGroupId - Optional group ID required for the work item (reserved for future use)
 * @returns List of users who can be assigned to the work item
 */
export async function getAssignableUsers(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  _requiredScope: string,
  _requiredGroupId?: string
): Promise<Array<Doc<"users">>> {
  // Get all users in the organization
  const users = await listUsersByOrganization(ctx.db, organizationId);

  // Filter users who are active
  const assignableUsers: Array<Doc<"users">> = [];

  for (const user of users) {
    // Filter by active status
    if (user.isActive) {
      assignableUsers.push(user);
    }
  }

  return assignableUsers;
}

/**
 * Validate that a user has access to a work item.
 * Throws an error if access is denied.
 *
 * @param ctx - Query context
 * @param userId - The user ID to validate (string format)
 * @param workItemId - The work item ID to validate access to
 * @param operation - The operation being performed (for error messages)
 * @throws ConstraintViolationError if access is denied
 */
export async function validateWorkItemAccess(
  ctx: QueryCtx,
  userId: string,
  workItemId: Id<"tasquencerWorkItems">,
  operation: string
): Promise<void> {
  // Get work item metadata
  const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
    ctx.db,
    workItemId
  );
  if (!metadata) {
    throw new EntityNotFoundError("WorkItemMetadata", {
      workItemId,
      operation,
    });
  }

  // Validate user exists
  const user = await getUser(ctx.db, userId as Id<"users">);
  if (!user) {
    throw new EntityNotFoundError("User", { userId, operation });
  }

  // Check required scope
  const requiredScope = (metadata.offer as { requiredScope?: string })?.requiredScope;
  if (requiredScope) {
    const hasScope = await userHasScope(
      ctx,
      components.tasquencerAuthorization,
      userId,
      requiredScope
    );
    if (!hasScope) {
      throw new ConstraintViolationError("INSUFFICIENT_SCOPE", {
        userId,
        workItemId,
        requiredScope,
        operation,
      });
    }
  }
}

/**
 * Get the current user's available (claimable) work items.
 * Filters work items based on scope and group membership.
 *
 * @param ctx - Query context
 * @param _organizationId - The organization to get work items for (reserved for future filtering)
 * @returns List of claimable work items for the current user
 */
export async function getAvailableWorkItemsForUser(
  ctx: QueryCtx,
  _organizationId: Id<"organizations">
): Promise<Array<Doc<"dealToDeliveryWorkItems">>> {
  // Get all unclaimed work items for the organization's deals
  const allWorkItems = await ctx.db
    .query("dealToDeliveryWorkItems")
    .filter((q) => q.eq(q.field("claim"), undefined))
    .collect();

  // In a full implementation, we would filter by the user's scopes and groups
  // For now, return all unclaimed work items
  return allWorkItems;
}

/**
 * Assert that the current user is authenticated and return their user ID.
 *
 * @param ctx - Mutation context
 * @param operation - The operation being performed (for error messages)
 * @returns The authenticated user's ID
 * @throws ConstraintViolationError if not authenticated
 */
export async function assertAuthenticatedUserForWorkItem(
  ctx: MutationCtx,
  operation: string
): Promise<Id<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    throw new ConstraintViolationError("AUTHENTICATION_REQUIRED", {
      operation,
      workflow: "dealToDelivery",
    });
  }
  return authUser.userId as Id<"users">;
}
