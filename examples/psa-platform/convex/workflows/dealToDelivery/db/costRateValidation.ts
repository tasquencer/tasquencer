/**
 * Cost Rate Validation Module
 *
 * Provides validation functions for user cost rates to ensure accurate
 * budget burn calculations. Per spec 06-workflow-execution-phase.md,
 * budget burn uses user.costRate for time cost calculations.
 *
 * Business Rule: All users logging time on projects must have a valid
 * costRate > 0 set by an admin. Users with costRate = 0 will cause
 * budget calculations to underreport actual costs.
 *
 * References:
 * - .review/recipes/psa-platform/specs/06-workflow-execution-phase.md lines 260-276
 * - .review/recipes/psa-platform/specs/01-domain-model.md lines 278-307
 */

import type { Doc, Id } from "../../../_generated/dataModel";

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum valid cost rate in cents per hour.
 * Users with costRate below this are considered to have "unconfigured" rates.
 */
export const MIN_VALID_COST_RATE = 1; // At least 1 cent per hour

// =============================================================================
// Basic Validation Functions
// =============================================================================

/**
 * Check if a cost rate value is valid (greater than 0).
 * @param costRate - The cost rate in cents per hour
 * @returns true if the cost rate is valid
 */
export function isValidCostRate(costRate: number | undefined | null): boolean {
  return typeof costRate === "number" && costRate >= MIN_VALID_COST_RATE;
}

/**
 * Check if a user has a valid cost rate configured.
 * @param user - User document or object with costRate field
 * @returns true if the user has a valid cost rate
 */
export function userHasValidCostRate(
  user: Pick<Doc<"users">, "costRate"> | null | undefined
): boolean {
  if (!user) return false;
  return isValidCostRate(user.costRate);
}

/**
 * Get a warning message if a user's cost rate is not configured.
 * @param user - User document
 * @returns Warning message or null if cost rate is valid
 */
export function getCostRateWarning(
  user: Pick<Doc<"users">, "_id" | "name" | "costRate"> | null
): string | null {
  if (!user) {
    return "User not found";
  }
  if (!isValidCostRate(user.costRate)) {
    return `User "${user.name}" (${user._id}) has no cost rate configured (current: $${(user.costRate / 100).toFixed(2)}/hr). Budget calculations will be inaccurate.`;
  }
  return null;
}

// =============================================================================
// Batch Validation Functions
// =============================================================================

/**
 * Result of validating cost rates for a set of users.
 */
export interface CostRateValidationResult {
  /** Whether all users have valid cost rates */
  allValid: boolean;
  /** IDs of users with missing/invalid cost rates */
  usersWithMissingRates: Id<"users">[];
  /** Warning messages for users with issues */
  warnings: string[];
  /** Count of users with valid rates */
  validCount: number;
  /** Count of users with missing rates */
  missingCount: number;
}

/**
 * Validate cost rates for a list of users.
 * @param users - Array of user documents
 * @returns Validation result with details about any issues
 */
export function validateUserCostRates(
  users: Array<Pick<Doc<"users">, "_id" | "name" | "costRate">>
): CostRateValidationResult {
  const usersWithMissingRates: Id<"users">[] = [];
  const warnings: string[] = [];
  let validCount = 0;

  for (const user of users) {
    if (userHasValidCostRate(user)) {
      validCount++;
    } else {
      usersWithMissingRates.push(user._id);
      const warning = getCostRateWarning(user);
      if (warning) {
        warnings.push(warning);
      }
    }
  }

  return {
    allValid: usersWithMissingRates.length === 0,
    usersWithMissingRates,
    warnings,
    validCount,
    missingCount: usersWithMissingRates.length,
  };
}

/**
 * Get unique user IDs from time entries that have missing cost rates.
 * @param entries - Array of time entries with userId
 * @param userCostRates - Map of userId to costRate
 * @returns Array of user IDs that have missing or zero cost rates
 */
export function getUsersWithMissingCostRates(
  entries: Array<{ userId: Id<"users"> }>,
  userCostRates: Map<Id<"users">, number>
): Id<"users">[] {
  const uniqueUserIds = new Set<Id<"users">>();
  const usersWithMissingRates: Id<"users">[] = [];

  for (const entry of entries) {
    if (uniqueUserIds.has(entry.userId)) continue;
    uniqueUserIds.add(entry.userId);

    const costRate = userCostRates.get(entry.userId);
    if (!isValidCostRate(costRate)) {
      usersWithMissingRates.push(entry.userId);
    }
  }

  return usersWithMissingRates;
}

// =============================================================================
// Budget Calculation with Validation
// =============================================================================

/**
 * Result of calculating time cost with validation.
 */
export interface TimeCostCalculationResult {
  /** Total calculated time cost in cents */
  timeCost: number;
  /** Total hours from entries */
  totalHours: number;
  /** Whether calculation includes users with missing cost rates */
  hasUsersWithMissingRates: boolean;
  /** IDs of users with missing cost rates */
  usersWithMissingRates: Id<"users">[];
  /** Warning message if there are issues (null if clean) */
  warningMessage: string | null;
  /** The "adjusted" cost if missing rates were treated as $0 (same as timeCost) */
  adjustedCost: number;
  /** Estimated underreporting if any users have missing rates */
  potentialUnderreporting: boolean;
}

/**
 * Calculate time cost from entries with cost rate validation.
 * This function calculates the total cost while tracking any users
 * who have missing cost rates (which would cause $0 cost for their hours).
 *
 * @param entries - Time entries with hours and userId
 * @param getUserCostRate - Function to get a user's cost rate by ID
 * @returns Calculation result with cost and validation details
 */
export async function calculateTimeCostWithValidation<
  T extends { hours: number; userId: Id<"users"> }
>(
  entries: T[],
  getUserCostRate: (userId: Id<"users">) => Promise<number>
): Promise<TimeCostCalculationResult> {
  const userCostRates = new Map<Id<"users">, number>();
  const usersWithMissingRates: Id<"users">[] = [];
  let timeCost = 0;
  let totalHours = 0;
  let hoursWithMissingRates = 0;

  // Calculate cost and collect cost rates
  for (const entry of entries) {
    totalHours += entry.hours;

    let costRate = userCostRates.get(entry.userId);
    if (costRate === undefined) {
      costRate = await getUserCostRate(entry.userId);
      userCostRates.set(entry.userId, costRate);

      if (!isValidCostRate(costRate)) {
        usersWithMissingRates.push(entry.userId);
      }
    }

    if (isValidCostRate(costRate)) {
      timeCost += entry.hours * costRate;
    } else {
      // Cost is 0 for users without rates - this is the underreporting
      hoursWithMissingRates += entry.hours;
    }
  }

  const hasUsersWithMissingRates = usersWithMissingRates.length > 0;
  let warningMessage: string | null = null;

  if (hasUsersWithMissingRates) {
    warningMessage =
      `Budget calculation includes ${usersWithMissingRates.length} user(s) with missing cost rates. ` +
      `${hoursWithMissingRates.toFixed(2)} hours (${((hoursWithMissingRates / totalHours) * 100).toFixed(1)}%) ` +
      `are being calculated at $0/hr, potentially underreporting actual costs.`;
  }

  return {
    timeCost,
    totalHours,
    hasUsersWithMissingRates,
    usersWithMissingRates,
    warningMessage,
    adjustedCost: timeCost, // Same as timeCost since we use 0 for missing rates
    potentialUnderreporting: hasUsersWithMissingRates,
  };
}

/**
 * Synchronous version of calculateTimeCostWithValidation for when
 * cost rates are already loaded into memory.
 *
 * @param entries - Time entries with hours and userId
 * @param userCostRates - Map of userId to costRate
 * @returns Calculation result with cost and validation details
 */
export function calculateTimeCostWithValidationSync<
  T extends { hours: number; userId: Id<"users"> }
>(
  entries: T[],
  userCostRates: Map<Id<"users">, number>
): TimeCostCalculationResult {
  const usersWithMissingRates: Id<"users">[] = [];
  const seenUsers = new Set<Id<"users">>();
  let timeCost = 0;
  let totalHours = 0;
  let hoursWithMissingRates = 0;

  for (const entry of entries) {
    totalHours += entry.hours;
    const costRate = userCostRates.get(entry.userId) ?? 0;

    // Track unique users with missing rates
    if (!seenUsers.has(entry.userId)) {
      seenUsers.add(entry.userId);
      if (!isValidCostRate(costRate)) {
        usersWithMissingRates.push(entry.userId);
      }
    }

    if (isValidCostRate(costRate)) {
      timeCost += entry.hours * costRate;
    } else {
      hoursWithMissingRates += entry.hours;
    }
  }

  const hasUsersWithMissingRates = usersWithMissingRates.length > 0;
  let warningMessage: string | null = null;

  if (hasUsersWithMissingRates && totalHours > 0) {
    warningMessage =
      `Budget calculation includes ${usersWithMissingRates.length} user(s) with missing cost rates. ` +
      `${hoursWithMissingRates.toFixed(2)} hours (${((hoursWithMissingRates / totalHours) * 100).toFixed(1)}%) ` +
      `are being calculated at $0/hr, potentially underreporting actual costs.`;
  }

  return {
    timeCost,
    totalHours,
    hasUsersWithMissingRates,
    usersWithMissingRates,
    warningMessage,
    adjustedCost: timeCost,
    potentialUnderreporting: hasUsersWithMissingRates,
  };
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generate a human-readable summary of cost rate validation issues.
 * @param result - The validation result from calculateTimeCostWithValidation
 * @returns A formatted summary string
 */
export function formatCostRateValidationSummary(
  result: CostRateValidationResult | TimeCostCalculationResult
): string {
  if ("allValid" in result) {
    // CostRateValidationResult
    if (result.allValid) {
      return `All ${result.validCount} users have valid cost rates configured.`;
    }
    return (
      `Cost rate issues found: ${result.missingCount} of ${result.validCount + result.missingCount} users ` +
      `have missing or zero cost rates.\n` +
      result.warnings.join("\n")
    );
  } else {
    // TimeCostCalculationResult
    if (!result.hasUsersWithMissingRates) {
      return `Time cost calculated: $${(result.timeCost / 100).toFixed(2)} for ${result.totalHours.toFixed(2)} hours.`;
    }
    return (
      `Time cost calculated: $${(result.timeCost / 100).toFixed(2)} for ${result.totalHours.toFixed(2)} hours.\n` +
      `⚠️ ${result.warningMessage}`
    );
  }
}
