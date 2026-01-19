/**
 * Date Limits Validation
 *
 * Implements date limit checking for time entries and expenses.
 *
 * Business Rules:
 * - Time entries: Warn if entry is older than 30 days, block if older than 90 days (unless admin override)
 * - Expenses: Expenses older than 90 days require approval exception
 * - Timer: Auto-stop after 12 hours with warning
 *
 * Reference: .review/recipes/psa-platform/specs/07-workflow-time-tracking.md (line 286)
 * Reference: .review/recipes/psa-platform/specs/08-workflow-expense-tracking.md (line 427)
 */

// =============================================================================
// DATE LIMIT CONSTANTS
// =============================================================================

/**
 * Maximum age in days for time entries without warning (30 days)
 * Reference: spec 07-workflow-time-tracking.md
 */
export const TIME_ENTRY_WARNING_DAYS = 30;

/**
 * Maximum age in days for time entries/expenses without admin approval (90 days)
 * Reference: spec 08-workflow-expense-tracking.md line 427
 */
export const MAX_ENTRY_AGE_DAYS = 90;

/**
 * Maximum timer duration in hours before auto-stop (12 hours)
 * Reference: spec 07-workflow-time-tracking.md line 300
 */
export const TIMER_MAX_HOURS = 12;

/**
 * Default hours rounding increment (0.25 = 15 minutes)
 * Reference: spec 07-workflow-time-tracking.md line 299
 */
export const DEFAULT_HOURS_ROUNDING_INCREMENT = 0.25;

/**
 * Alternative hours rounding increment (0.1 = 6 minutes)
 * Reference: spec 07-workflow-time-tracking.md line 299
 */
export const ALTERNATIVE_HOURS_ROUNDING_INCREMENT = 0.1;

/**
 * Milliseconds in one day
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Milliseconds in one hour
 */
const MS_PER_HOUR = 60 * 60 * 1000;

// =============================================================================
// DATE LIMIT CHECK TYPES
// =============================================================================

export interface DateLimitCheckResult {
  /** Whether the date is within acceptable limits */
  isValid: boolean;
  /** Whether a warning should be shown (30-90 day range) */
  hasWarning: boolean;
  /** Whether admin approval is required (>90 days) */
  requiresAdminApproval: boolean;
  /** Age of the entry in days */
  ageInDays: number;
  /** Human-readable message for display */
  message: string | null;
}

export interface TimerDurationCheckResult {
  /** The calculated hours from timer duration */
  hours: number;
  /** Whether the timer was auto-stopped due to exceeding limit */
  wasAutoStopped: boolean;
  /** Whether a warning should be shown */
  hasWarning: boolean;
  /** Human-readable message for display */
  message: string | null;
}

// =============================================================================
// DATE LIMIT CHECK FUNCTIONS
// =============================================================================

/**
 * Calculate the age of a date in days relative to a reference date.
 *
 * @param entryDate - The date to check (timestamp in ms)
 * @param referenceDate - The reference date (default: now)
 * @returns Age in days (positive if in the past, negative if in future)
 */
export function getEntryAgeInDays(
  entryDate: number,
  referenceDate: number = Date.now()
): number {
  const diff = referenceDate - entryDate;
  return Math.floor(diff / MS_PER_DAY);
}

/**
 * Check if a date is in the future.
 *
 * @param date - The date to check (timestamp in ms)
 * @param referenceDate - The reference date (default: now)
 * @returns True if the date is in the future
 */
export function isFutureDate(
  date: number,
  referenceDate: number = Date.now()
): boolean {
  // Allow entries for today (same calendar day)
  const todayStart = new Date(referenceDate);
  todayStart.setHours(0, 0, 0, 0);

  const entryDay = new Date(date);
  entryDay.setHours(0, 0, 0, 0);

  return entryDay.getTime() > todayStart.getTime();
}

/**
 * Check if a time entry or expense date is within acceptable limits.
 *
 * Returns validation result with warning (30-90 days) or admin approval required (>90 days).
 *
 * @param entryDate - The date of the entry (timestamp in ms)
 * @param referenceDate - The reference date for comparison (default: now)
 * @returns DateLimitCheckResult with validation details
 */
export function checkEntryDateLimits(
  entryDate: number,
  referenceDate: number = Date.now()
): DateLimitCheckResult {
  const ageInDays = getEntryAgeInDays(entryDate, referenceDate);

  // Future dates are invalid
  if (isFutureDate(entryDate, referenceDate)) {
    return {
      isValid: false,
      hasWarning: false,
      requiresAdminApproval: false,
      ageInDays,
      message: "Cannot submit entries for future dates",
    };
  }

  // More than 90 days old requires admin approval
  if (ageInDays > MAX_ENTRY_AGE_DAYS) {
    return {
      isValid: false,
      hasWarning: true,
      requiresAdminApproval: true,
      ageInDays,
      message: `Entry is ${ageInDays} days old and requires admin approval exception (limit: ${MAX_ENTRY_AGE_DAYS} days)`,
    };
  }

  // 30-90 days old shows warning but is valid
  if (ageInDays > TIME_ENTRY_WARNING_DAYS) {
    return {
      isValid: true,
      hasWarning: true,
      requiresAdminApproval: false,
      ageInDays,
      message: `Entry is ${ageInDays} days old (warning threshold: ${TIME_ENTRY_WARNING_DAYS} days)`,
    };
  }

  // Within normal limits
  return {
    isValid: true,
    hasWarning: false,
    requiresAdminApproval: false,
    ageInDays,
    message: null,
  };
}

/**
 * Check if a time entry date is within limits.
 * Alias for checkEntryDateLimits for semantic clarity.
 */
export function checkTimeEntryDateLimits(
  entryDate: number,
  referenceDate: number = Date.now()
): DateLimitCheckResult {
  return checkEntryDateLimits(entryDate, referenceDate);
}

/**
 * Check if an expense date is within limits.
 * Per spec line 427: "Expenses older than 90 days require approval exception"
 */
export function checkExpenseDateLimits(
  expenseDate: number,
  referenceDate: number = Date.now()
): DateLimitCheckResult {
  return checkEntryDateLimits(expenseDate, referenceDate);
}

/**
 * Check if admin approval exception is required for an entry date.
 *
 * @param entryDate - The date of the entry
 * @param referenceDate - The reference date (default: now)
 * @returns True if admin approval is required
 */
export function requiresAdminApprovalForDate(
  entryDate: number,
  referenceDate: number = Date.now()
): boolean {
  const ageInDays = getEntryAgeInDays(entryDate, referenceDate);
  return ageInDays > MAX_ENTRY_AGE_DAYS;
}

/**
 * Check if a date is within the warning threshold (30-90 days old).
 *
 * @param entryDate - The date of the entry
 * @param referenceDate - The reference date (default: now)
 * @returns True if the date triggers a warning
 */
export function isInWarningRange(
  entryDate: number,
  referenceDate: number = Date.now()
): boolean {
  const ageInDays = getEntryAgeInDays(entryDate, referenceDate);
  return ageInDays > TIME_ENTRY_WARNING_DAYS && ageInDays <= MAX_ENTRY_AGE_DAYS;
}

// =============================================================================
// TIMER DURATION CHECK FUNCTIONS
// =============================================================================

/**
 * Calculate timer duration and check against the 12-hour limit.
 *
 * Per spec line 300: "Timer auto-stops after 12 hours with warning"
 *
 * @param startTime - When the timer was started (timestamp in ms)
 * @param endTime - When the timer was stopped (default: now)
 * @returns TimerDurationCheckResult with calculated hours and auto-stop status
 */
export function checkTimerDuration(
  startTime: number,
  endTime: number = Date.now()
): TimerDurationCheckResult {
  const durationMs = endTime - startTime;
  const rawHours = durationMs / MS_PER_HOUR;

  // If timer exceeded 12 hours, auto-stop at 12 hours with warning
  if (rawHours > TIMER_MAX_HOURS) {
    return {
      hours: TIMER_MAX_HOURS,
      wasAutoStopped: true,
      hasWarning: true,
      message: `Timer exceeded ${TIMER_MAX_HOURS} hours and was auto-stopped. Original duration: ${rawHours.toFixed(2)} hours.`,
    };
  }

  // Round to 2 decimal places
  const roundedHours = Math.round(rawHours * 100) / 100;

  // Warning if approaching limit (>10 hours)
  if (roundedHours > 10) {
    return {
      hours: roundedHours,
      wasAutoStopped: false,
      hasWarning: true,
      message: `Timer duration ${roundedHours} hours is approaching the ${TIMER_MAX_HOURS} hour limit.`,
    };
  }

  return {
    hours: roundedHours,
    wasAutoStopped: false,
    hasWarning: false,
    message: null,
  };
}

/**
 * Get the effective timer hours, auto-stopped at 12-hour limit.
 *
 * @param startTime - When the timer was started
 * @param endTime - When the timer was stopped (default: now)
 * @returns Hours (capped at TIMER_MAX_HOURS)
 */
export function getTimerHours(
  startTime: number,
  endTime: number = Date.now()
): number {
  const result = checkTimerDuration(startTime, endTime);
  return result.hours;
}

/**
 * Check if a timer duration would be auto-stopped.
 *
 * @param startTime - When the timer was started
 * @param endTime - When the timer was stopped (default: now)
 * @returns True if the timer would be auto-stopped
 */
export function wouldTimerAutoStop(
  startTime: number,
  endTime: number = Date.now()
): boolean {
  const durationMs = endTime - startTime;
  const hours = durationMs / MS_PER_HOUR;
  return hours > TIMER_MAX_HOURS;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate a time entry date and throw if invalid.
 *
 * @param date - The entry date
 * @param hasAdminOverride - Whether admin approval has been granted
 * @throws Error if date is invalid and no admin override
 */
export function validateTimeEntryDate(
  date: number,
  hasAdminOverride = false
): void {
  const result = checkTimeEntryDateLimits(date);

  // Future dates are always blocked
  if (isFutureDate(date)) {
    throw new Error("Cannot submit time entries for future dates");
  }

  // Old entries require admin approval
  if (result.requiresAdminApproval && !hasAdminOverride) {
    throw new Error(result.message ?? "Entry is too old and requires admin approval");
  }
}

/**
 * Validate an expense date and throw if invalid.
 *
 * @param date - The expense date
 * @param hasAdminOverride - Whether admin approval has been granted
 * @throws Error if date is invalid and no admin override
 */
export function validateExpenseDate(
  date: number,
  hasAdminOverride = false
): void {
  const result = checkExpenseDateLimits(date);

  // Future dates are always blocked
  if (isFutureDate(date)) {
    throw new Error("Cannot submit expenses for future dates");
  }

  // Old entries require admin approval
  if (result.requiresAdminApproval && !hasAdminOverride) {
    throw new Error(result.message ?? "Expense is too old and requires admin approval");
  }
}

/**
 * Get warning message for date if applicable.
 *
 * @param date - The entry date
 * @returns Warning message or null
 */
export function getDateWarningMessage(date: number): string | null {
  const result = checkEntryDateLimits(date);
  return result.hasWarning ? result.message : null;
}

// =============================================================================
// HOURS ROUNDING FUNCTIONS
// =============================================================================

/**
 * Round hours to the nearest increment.
 *
 * Per spec 07-workflow-time-tracking.md line 299:
 * "Hours rounded to nearest 0.25 (15 min) or 0.1 (6 min) based on org setting"
 *
 * @param hours - The raw hours value
 * @param increment - The rounding increment (default: 0.25 = 15 minutes)
 * @returns Hours rounded to the nearest increment
 *
 * @example
 * roundHours(1.33) // Returns 1.25 (rounds down)
 * roundHours(1.38) // Returns 1.5 (rounds up)
 * roundHours(1.33, 0.1) // Returns 1.3 (rounds to nearest 0.1)
 */
export function roundHours(
  hours: number,
  increment: number = DEFAULT_HOURS_ROUNDING_INCREMENT
): number {
  if (increment <= 0) {
    throw new Error("Rounding increment must be positive");
  }
  // Round to nearest increment
  return Math.round(hours / increment) * increment;
}

/**
 * Round hours down (floor) to the nearest increment.
 *
 * Use this for conservative billing where partial increments are not charged.
 *
 * @param hours - The raw hours value
 * @param increment - The rounding increment (default: 0.25)
 * @returns Hours rounded down to the nearest increment
 */
export function roundHoursDown(
  hours: number,
  increment: number = DEFAULT_HOURS_ROUNDING_INCREMENT
): number {
  if (increment <= 0) {
    throw new Error("Rounding increment must be positive");
  }
  return Math.floor(hours / increment) * increment;
}

/**
 * Round hours up (ceiling) to the nearest increment.
 *
 * Use this for billing where any work in an increment counts as full increment.
 *
 * @param hours - The raw hours value
 * @param increment - The rounding increment (default: 0.25)
 * @returns Hours rounded up to the nearest increment
 */
export function roundHoursUp(
  hours: number,
  increment: number = DEFAULT_HOURS_ROUNDING_INCREMENT
): number {
  if (increment <= 0) {
    throw new Error("Rounding increment must be positive");
  }
  return Math.ceil(hours / increment) * increment;
}

/**
 * Check if hours are already rounded to the given increment.
 *
 * @param hours - The hours value to check
 * @param increment - The rounding increment (default: 0.25)
 * @returns True if hours are already at a valid increment
 */
export function isHoursRounded(
  hours: number,
  increment: number = DEFAULT_HOURS_ROUNDING_INCREMENT
): boolean {
  if (increment <= 0) {
    throw new Error("Rounding increment must be positive");
  }
  // Check if the value divided by increment is effectively a whole number
  // Use small epsilon for floating point comparison
  const divided = hours / increment;
  return Math.abs(divided - Math.round(divided)) < 0.0001;
}
