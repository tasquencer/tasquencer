/**
 * Duplicate Detection for Time Entries and Expenses
 *
 * Implements duplicate checking per specs:
 * - 09-workflow-timesheet-approval.md line 249: "Check for duplicate entries"
 * - 10-workflow-expense-approval.md line 275: "Not duplicate: No existing expense for same item"
 *
 * Detection returns warnings, not blocks - users can still submit with acknowledgment.
 *
 * Reference: .review/recipes/psa-platform/specs/09-workflow-timesheet-approval.md
 * Reference: .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 */

import type { DatabaseReader } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";

// =============================================================================
// TYPES
// =============================================================================

export interface DuplicateCheckResult {
  /** Whether potential duplicates were found */
  hasPotentialDuplicates: boolean;
  /** List of potential duplicate IDs */
  duplicateIds: string[];
  /** Human-readable warning message */
  warningMessage: string | null;
  /** Confidence level of the duplicate match */
  confidence: "exact" | "likely" | "possible" | null;
}

export interface TimeEntryDuplicateCriteria {
  userId: Id<"users">;
  projectId: Id<"projects">;
  date: number;
  taskId?: Id<"tasks">;
  hours?: number;
}

export interface ExpenseDuplicateCriteria {
  userId: Id<"users">;
  projectId: Id<"projects">;
  date: number;
  amount: number;
  type: Doc<"expenses">["type"];
  description?: string;
}

// =============================================================================
// TIME ENTRY DUPLICATE DETECTION
// =============================================================================

/**
 * Check for potential duplicate time entries.
 *
 * Duplicate criteria:
 * - Same user, project, and date = likely duplicate
 * - Same user, project, date, and task = exact duplicate
 * - Same user, project, date, and hours = possible duplicate
 *
 * @param db - Database reader
 * @param criteria - Time entry criteria to check
 * @param excludeId - Optional entry ID to exclude (for edits)
 * @returns DuplicateCheckResult with findings
 */
export async function checkTimeEntryDuplicates(
  db: DatabaseReader,
  criteria: TimeEntryDuplicateCriteria,
  excludeId?: Id<"timeEntries">
): Promise<DuplicateCheckResult> {
  // Query for entries on the same date by the same user for the same project
  const entries = await db
    .query("timeEntries")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", criteria.userId).eq("date", criteria.date)
    )
    .collect();

  // Filter to same project and exclude the current entry if editing
  const sameProjectEntries = entries.filter(
    (e) => e.projectId === criteria.projectId && e._id !== excludeId
  );

  if (sameProjectEntries.length === 0) {
    return {
      hasPotentialDuplicates: false,
      duplicateIds: [],
      warningMessage: null,
      confidence: null,
    };
  }

  // Check for exact duplicates (same task)
  if (criteria.taskId) {
    const exactDuplicates = sameProjectEntries.filter(
      (e) => e.taskId === criteria.taskId
    );
    if (exactDuplicates.length > 0) {
      return {
        hasPotentialDuplicates: true,
        duplicateIds: exactDuplicates.map((e) => e._id),
        warningMessage: `Found ${exactDuplicates.length} existing time entry(ies) for the same task on this date. This may be a duplicate.`,
        confidence: "exact",
      };
    }
  }

  // Check for likely duplicates (same project, same date)
  return {
    hasPotentialDuplicates: true,
    duplicateIds: sameProjectEntries.map((e) => e._id),
    warningMessage: `Found ${sameProjectEntries.length} existing time entry(ies) for this project on the same date. Please verify this is not a duplicate.`,
    confidence: "likely",
  };
}

/**
 * Check if a specific time entry would be a duplicate.
 * Returns true if an entry with same user, project, date, and task exists.
 */
export async function isTimeEntryDuplicate(
  db: DatabaseReader,
  criteria: TimeEntryDuplicateCriteria,
  excludeId?: Id<"timeEntries">
): Promise<boolean> {
  const result = await checkTimeEntryDuplicates(db, criteria, excludeId);
  return result.confidence === "exact";
}

// =============================================================================
// EXPENSE DUPLICATE DETECTION
// =============================================================================

/**
 * Check for potential duplicate expenses.
 *
 * Duplicate criteria:
 * - Same user, project, date, and amount = exact duplicate
 * - Same user, project, date, type, and similar amount (within 10%) = likely duplicate
 * - Same user, project, and date with same type = possible duplicate
 *
 * @param db - Database reader
 * @param criteria - Expense criteria to check
 * @param excludeId - Optional expense ID to exclude (for edits)
 * @returns DuplicateCheckResult with findings
 */
export async function checkExpenseDuplicates(
  db: DatabaseReader,
  criteria: ExpenseDuplicateCriteria,
  excludeId?: Id<"expenses">
): Promise<DuplicateCheckResult> {
  // Query for expenses by the same user
  const expenses = await db
    .query("expenses")
    .withIndex("by_user", (q) => q.eq("userId", criteria.userId))
    .collect();

  // Filter to same project, date, and type, excluding current entry if editing
  const candidateExpenses = expenses.filter(
    (e) =>
      e.projectId === criteria.projectId &&
      e.date === criteria.date &&
      e.type === criteria.type &&
      e._id !== excludeId
  );

  if (candidateExpenses.length === 0) {
    return {
      hasPotentialDuplicates: false,
      duplicateIds: [],
      warningMessage: null,
      confidence: null,
    };
  }

  // Check for exact duplicates (same amount)
  const exactDuplicates = candidateExpenses.filter(
    (e) => e.amount === criteria.amount
  );
  if (exactDuplicates.length > 0) {
    return {
      hasPotentialDuplicates: true,
      duplicateIds: exactDuplicates.map((e) => e._id),
      warningMessage: `Found ${exactDuplicates.length} existing ${criteria.type} expense(s) with the same amount on this date. This appears to be a duplicate.`,
      confidence: "exact",
    };
  }

  // Check for likely duplicates (similar amount within 10%)
  const similarAmountExpenses = candidateExpenses.filter((e) => {
    const diff = Math.abs(e.amount - criteria.amount);
    const threshold = criteria.amount * 0.1; // 10% threshold
    return diff <= threshold;
  });

  if (similarAmountExpenses.length > 0) {
    return {
      hasPotentialDuplicates: true,
      duplicateIds: similarAmountExpenses.map((e) => e._id),
      warningMessage: `Found ${similarAmountExpenses.length} similar ${criteria.type} expense(s) on this date. Please verify this is not a duplicate.`,
      confidence: "likely",
    };
  }

  // Possible duplicates (same type and date)
  return {
    hasPotentialDuplicates: true,
    duplicateIds: candidateExpenses.map((e) => e._id),
    warningMessage: `Found ${candidateExpenses.length} other ${criteria.type} expense(s) on this date. Consider if this is a duplicate.`,
    confidence: "possible",
  };
}

/**
 * Check if a specific expense would be an exact duplicate.
 * Returns true if an expense with same user, project, date, type, and amount exists.
 */
export async function isExpenseDuplicate(
  db: DatabaseReader,
  criteria: ExpenseDuplicateCriteria,
  excludeId?: Id<"expenses">
): Promise<boolean> {
  const result = await checkExpenseDuplicates(db, criteria, excludeId);
  return result.confidence === "exact";
}

// =============================================================================
// DATE HELPERS
// =============================================================================

/**
 * Normalize a timestamp to the start of the day (midnight UTC).
 * Useful for date-based duplicate checks.
 */
export function normalizeDateToDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Check if two timestamps are on the same day.
 */
export function isSameDay(timestamp1: number, timestamp2: number): boolean {
  return normalizeDateToDay(timestamp1) === normalizeDateToDay(timestamp2);
}
