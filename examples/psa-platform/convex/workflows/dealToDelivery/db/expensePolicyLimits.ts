/**
 * Expense Policy Limits Validation
 *
 * Implements expense policy limit checking per spec 10-workflow-expense-approval.md lines 293-304.
 * Expenses exceeding limits are flagged for additional review, not blocked.
 *
 * Policy Limits (all amounts in cents):
 * - Meals: $75/day limit, $30 per expense limit
 * - Travel - Airfare: $1,000 per expense
 * - Travel - Hotel: $250/night
 * - Software: $500 per expense
 * - Materials: $1,000 per expense
 * - Subcontractor: No fixed limit (requires vendor info and receipt)
 * - Other: $250 per expense
 *
 * Reference: .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 */

import type { Doc } from "../../../_generated/dataModel";

// =============================================================================
// POLICY LIMIT CONSTANTS (amounts in cents)
// =============================================================================

/**
 * Per-expense limits by category (in cents)
 */
export const EXPENSE_PER_ITEM_LIMITS = {
  // Travel subcategories
  Airfare: 100_000, // $1,000
  Hotel: 25_000, // $250/night
  Meals: 3_000, // $30 per expense
  CarRental: 15_000, // $150/day (reasonable default)
  Mileage: null, // No per-item limit, calculated by miles
  Parking: 5_000, // $50 per expense
  Other: 25_000, // $250 (for travel other)

  // Main expense types
  Software: 50_000, // $500
  Materials: 100_000, // $1,000
  Subcontractor: null, // No fixed limit, requires receipt and vendor info
} as const;

/**
 * Daily limits by category (in cents) - for expenses that accumulate daily
 */
export const EXPENSE_DAILY_LIMITS = {
  Meals: 7_500, // $75/day
  Hotel: 25_000, // $250/night
} as const;

/**
 * Per-expense limits for main expense types (in cents)
 */
export const EXPENSE_TYPE_LIMITS: Record<Doc<"expenses">["type"], number | null> = {
  Travel: null, // Travel has subcategory limits, not a single type limit
  Software: 50_000, // $500
  Materials: 100_000, // $1,000
  Subcontractor: null, // No fixed limit
  Other: 25_000, // $250
};

// =============================================================================
// POLICY LIMIT CHECK TYPES
// =============================================================================

export interface PolicyLimitCheckResult {
  /** Whether any policy limit was exceeded */
  exceeded: boolean;
  /** Detailed violations found */
  violations: PolicyViolation[];
  /** Human-readable summary for UI display */
  summary: string | null;
}

export interface PolicyViolation {
  /** Type of violation */
  type: "per_expense" | "daily";
  /** Expense category that was violated */
  category: string;
  /** Amount submitted (in cents) */
  amount: number;
  /** Policy limit (in cents) */
  limit: number;
  /** How much over the limit (in cents) */
  overBy: number;
  /** Human-readable message */
  message: string;
}

// =============================================================================
// POLICY LIMIT CHECK FUNCTIONS
// =============================================================================

/**
 * Check if an expense amount exceeds the per-expense limit for its type.
 *
 * @param expenseType - The main expense type (Travel, Software, etc.)
 * @param amount - The expense amount in cents
 * @param travelCategory - For travel expenses, the subcategory (Airfare, Hotel, etc.)
 * @returns PolicyLimitCheckResult with exceeded flag and violations
 */
export function checkExpensePolicyLimit(
  expenseType: Doc<"expenses">["type"],
  amount: number,
  travelCategory?: string
): PolicyLimitCheckResult {
  const violations: PolicyViolation[] = [];

  // Get the applicable limit
  let limit: number | null = null;
  let category: string = expenseType;

  if (expenseType === "Travel" && travelCategory) {
    // Use travel subcategory limit
    category = travelCategory;
    limit = EXPENSE_PER_ITEM_LIMITS[travelCategory as keyof typeof EXPENSE_PER_ITEM_LIMITS] ?? null;
  } else {
    // Use main expense type limit
    limit = EXPENSE_TYPE_LIMITS[expenseType];
  }

  // Check per-expense limit
  if (limit !== null && amount > limit) {
    const overBy = amount - limit;
    violations.push({
      type: "per_expense",
      category,
      amount,
      limit,
      overBy,
      message: `${category} expense of $${(amount / 100).toFixed(2)} exceeds policy limit of $${(limit / 100).toFixed(2)} by $${(overBy / 100).toFixed(2)}`,
    });
  }

  return {
    exceeded: violations.length > 0,
    violations,
    summary: violations.length > 0
      ? violations.map((v) => v.message).join("; ")
      : null,
  };
}

/**
 * Check travel expense against specific subcategory limits.
 *
 * @param amount - The expense amount in cents
 * @param travelCategory - The travel subcategory (Airfare, Hotel, Meals, etc.)
 * @param nights - For hotel expenses, the number of nights (default 1)
 * @returns PolicyLimitCheckResult with exceeded flag and violations
 */
export function checkTravelExpensePolicyLimit(
  amount: number,
  travelCategory: "Airfare" | "Hotel" | "CarRental" | "Meals" | "Mileage" | "Parking" | "Other",
  nights = 1
): PolicyLimitCheckResult {
  const violations: PolicyViolation[] = [];

  // Get the per-item limit for this category
  const perItemLimit = EXPENSE_PER_ITEM_LIMITS[travelCategory];

  if (perItemLimit !== null) {
    // For hotel, multiply by number of nights
    const effectiveLimit = travelCategory === "Hotel" ? perItemLimit * nights : perItemLimit;

    if (amount > effectiveLimit) {
      const overBy = amount - effectiveLimit;
      const limitDisplay = travelCategory === "Hotel" && nights > 1
        ? `$${(perItemLimit / 100).toFixed(2)}/night x ${nights} nights = $${(effectiveLimit / 100).toFixed(2)}`
        : `$${(effectiveLimit / 100).toFixed(2)}`;

      violations.push({
        type: "per_expense",
        category: travelCategory,
        amount,
        limit: effectiveLimit,
        overBy,
        message: `${travelCategory} expense of $${(amount / 100).toFixed(2)} exceeds policy limit of ${limitDisplay} by $${(overBy / 100).toFixed(2)}`,
      });
    }
  }

  return {
    exceeded: violations.length > 0,
    violations,
    summary: violations.length > 0
      ? violations.map((v) => v.message).join("; ")
      : null,
  };
}

/**
 * Check software expense against policy limit.
 *
 * @param amount - The expense amount in cents
 * @returns PolicyLimitCheckResult
 */
export function checkSoftwareExpensePolicyLimit(amount: number): PolicyLimitCheckResult {
  return checkExpensePolicyLimit("Software", amount);
}

/**
 * Check materials expense against policy limit.
 *
 * @param amount - The expense amount in cents
 * @returns PolicyLimitCheckResult
 */
export function checkMaterialsExpensePolicyLimit(amount: number): PolicyLimitCheckResult {
  return checkExpensePolicyLimit("Materials", amount);
}

/**
 * Check "other" expense against policy limit.
 *
 * @param amount - The expense amount in cents
 * @returns PolicyLimitCheckResult
 */
export function checkOtherExpensePolicyLimit(amount: number): PolicyLimitCheckResult {
  return checkExpensePolicyLimit("Other", amount);
}

/**
 * Format amount in cents to dollar string for display.
 */
export function formatAmountForDisplay(amountInCents: number): string {
  return `$${(amountInCents / 100).toFixed(2)}`;
}

/**
 * Get the policy limit for an expense type (in cents).
 * Returns null if no fixed limit exists.
 */
export function getPolicyLimitForType(
  expenseType: Doc<"expenses">["type"],
  travelCategory?: string
): number | null {
  if (expenseType === "Travel" && travelCategory) {
    return EXPENSE_PER_ITEM_LIMITS[travelCategory as keyof typeof EXPENSE_PER_ITEM_LIMITS] ?? null;
  }
  return EXPENSE_TYPE_LIMITS[expenseType];
}
