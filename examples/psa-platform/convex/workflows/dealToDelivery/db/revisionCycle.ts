/**
 * Revision Cycle Tracking
 *
 * Implements the 3-cycle escalation rule for timesheets and expenses.
 * After 3 reject-revise cycles, entries are escalated to admin review.
 *
 * Specs:
 * - 09-workflow-timesheet-approval.md line 281: "After 3 revision cycles, escalate to admin"
 * - 10-workflow-expense-approval.md line 288: "Revision Limit: After 3 revision cycles, escalate to admin"
 *
 * Reference: .review/recipes/psa-platform/specs/09-workflow-timesheet-approval.md
 * Reference: .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Maximum number of reject-revise cycles before escalation to admin.
 */
export const MAX_REVISION_CYCLES = 3;

// =============================================================================
// TYPES
// =============================================================================

export interface RevisionCycleCheckResult {
  /** Current revision count after this rejection */
  newRevisionCount: number;
  /** Whether the entry should be escalated to admin */
  shouldEscalate: boolean;
  /** Human-readable message for the escalation */
  escalationMessage: string | null;
}

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Check if an entry should be escalated after rejection.
 *
 * Call this when rejecting a time entry or expense to determine
 * if escalation is needed.
 *
 * @param currentRevisionCount - Current revision count (0 if never revised)
 * @returns RevisionCycleCheckResult with new count and escalation status
 */
export function checkRevisionCycleOnRejection(
  currentRevisionCount: number | undefined
): RevisionCycleCheckResult {
  const current = currentRevisionCount ?? 0;
  const newCount = current + 1;
  const shouldEscalate = newCount >= MAX_REVISION_CYCLES;

  return {
    newRevisionCount: newCount,
    shouldEscalate,
    escalationMessage: shouldEscalate
      ? `Entry has been rejected ${newCount} times and requires admin review.`
      : null,
  };
}

/**
 * Check if an entry has been escalated and requires admin action.
 *
 * Call this when a user tries to revise an entry to determine
 * if they need admin intervention.
 *
 * @param revisionCount - Current revision count
 * @param escalatedToAdmin - Whether entry has been escalated
 * @returns true if entry requires admin intervention
 */
export function requiresAdminIntervention(
  revisionCount: number | undefined,
  escalatedToAdmin: boolean | undefined
): boolean {
  if (escalatedToAdmin === true) {
    return true;
  }
  // Also check count in case escalatedToAdmin wasn't set yet
  return (revisionCount ?? 0) >= MAX_REVISION_CYCLES;
}

/**
 * Get the remaining revision attempts before escalation.
 *
 * @param currentRevisionCount - Current revision count
 * @returns Number of remaining attempts (can be negative if exceeded)
 */
export function getRemainingRevisionAttempts(
  currentRevisionCount: number | undefined
): number {
  return MAX_REVISION_CYCLES - (currentRevisionCount ?? 0);
}

/**
 * Format a warning message about approaching escalation.
 *
 * @param currentRevisionCount - Current revision count
 * @returns Warning message or null if not close to limit
 */
export function getEscalationWarning(
  currentRevisionCount: number | undefined
): string | null {
  const count = currentRevisionCount ?? 0;
  const remaining = MAX_REVISION_CYCLES - count;

  if (remaining <= 0) {
    return `This entry has exceeded the maximum revision cycles (${MAX_REVISION_CYCLES}) and requires admin review.`;
  }

  if (remaining === 1) {
    return `Warning: This is the last revision attempt. One more rejection will escalate this entry to admin review.`;
  }

  if (remaining === 2) {
    return `Note: ${remaining} revision attempts remaining before admin escalation.`;
  }

  return null;
}
