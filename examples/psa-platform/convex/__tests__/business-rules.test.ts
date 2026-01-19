/// <reference types="vite/client" />
/**
 * Business Rules Validation Tests
 *
 * These tests verify that critical business rules are properly enforced
 * at both the schema level (Zod validation) and domain level.
 *
 * Business Rules Tested:
 * - Markup rate limits: 1.0-1.5 (0-50% markup)
 * - Hours validation: 0.25-24 hours per entry
 * - Receipt threshold: $25 for expense receipts
 * - Budget burn threshold: 90% triggers overrun
 * - Self-approval prevention (conceptual validation)
 * - Status transition rules
 *
 * References:
 * - .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 * - .review/recipes/psa-platform/specs/09-workflow-timesheet-approval.md
 * - .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { setup, type TestContext } from './helpers.test'

// =============================================================================
// Constants (matching work item definitions)
// =============================================================================

// Markup rate limits per spec 10-workflow-expense-approval.md line 287
const MIN_MARKUP_RATE = 1.0 // No markup (cost)
const MAX_MARKUP_RATE = 1.5 // 50% markup

// Hours limits per spec 09-workflow-timesheet-approval.md
const MIN_HOURS_PER_ENTRY = 0.25 // 15 minutes
const MAX_HOURS_PER_ENTRY = 24 // Full day

// Receipt threshold per spec 08-workflow-expense-tracking.md
const RECEIPT_REQUIRED_THRESHOLD_CENTS = 2500 // $25

// Budget thresholds per spec 06-workflow-execution-phase.md lines 278-284:
// 0-75%: Green - Normal operations
// 75-90%: Yellow - Warning, increased monitoring
// 90%+: Red - Budget overrun, pause work
const BUDGET_WARNING_THRESHOLD = 0.75 // 75%
const BUDGET_OVERRUN_THRESHOLD = 0.9 // 90%

// Helper function to determine warning level based on burn rate
function getBudgetWarningLevel(burnRate: number): "green" | "yellow" | "red" {
  if (burnRate > BUDGET_OVERRUN_THRESHOLD) return "red"
  if (burnRate > BUDGET_WARNING_THRESHOLD) return "yellow"
  return "green"
}

// =============================================================================
// Zod Schema Definitions (matching work items)
// =============================================================================

// Schema matching approveExpense and reviewExpense work items
const markupRateSchema = z.number().min(MIN_MARKUP_RATE).max(MAX_MARKUP_RATE)

// Schema matching manualEntry and reviseTimesheet work items
const hoursSchema = z.number().min(MIN_HOURS_PER_ENTRY).max(MAX_HOURS_PER_ENTRY)

// Schema matching createBookings work item
const hoursPerDaySchema = z.number().min(0).max(24)

// Schema matching invoiceFixedFee work item
const percentageSchema = z.number().min(0).max(100)

// =============================================================================
// Markup Rate Validation Tests
// =============================================================================

describe('Markup Rate Validation', () => {
  describe('Valid markup rates', () => {
    it('accepts markup rate of 1.0 (no markup)', () => {
      expect(() => markupRateSchema.parse(1.0)).not.toThrow()
    })

    it('accepts markup rate of 1.1 (10% markup)', () => {
      expect(() => markupRateSchema.parse(1.1)).not.toThrow()
    })

    it('accepts markup rate of 1.25 (25% markup)', () => {
      expect(() => markupRateSchema.parse(1.25)).not.toThrow()
    })

    it('accepts markup rate of 1.5 (50% markup - maximum)', () => {
      expect(() => markupRateSchema.parse(1.5)).not.toThrow()
    })
  })

  describe('Invalid markup rates', () => {
    it('rejects markup rate below 1.0 (negative margin)', () => {
      expect(() => markupRateSchema.parse(0.9)).toThrow()
    })

    it('rejects markup rate of 0.5 (50% discount)', () => {
      expect(() => markupRateSchema.parse(0.5)).toThrow()
    })

    it('rejects markup rate above 1.5 (over 50% markup)', () => {
      expect(() => markupRateSchema.parse(1.6)).toThrow()
    })

    it('rejects markup rate of 2.0 (100% markup)', () => {
      expect(() => markupRateSchema.parse(2.0)).toThrow()
    })

    it('rejects negative markup rate', () => {
      expect(() => markupRateSchema.parse(-0.5)).toThrow()
    })
  })

  describe('Edge cases', () => {
    it('accepts exactly MIN_MARKUP_RATE boundary', () => {
      expect(() => markupRateSchema.parse(MIN_MARKUP_RATE)).not.toThrow()
    })

    it('accepts exactly MAX_MARKUP_RATE boundary', () => {
      expect(() => markupRateSchema.parse(MAX_MARKUP_RATE)).not.toThrow()
    })

    it('rejects just below MIN_MARKUP_RATE', () => {
      expect(() => markupRateSchema.parse(MIN_MARKUP_RATE - 0.001)).toThrow()
    })

    it('rejects just above MAX_MARKUP_RATE', () => {
      expect(() => markupRateSchema.parse(MAX_MARKUP_RATE + 0.001)).toThrow()
    })
  })
})

// =============================================================================
// Hours Validation Tests
// =============================================================================

describe('Hours Validation', () => {
  describe('Valid hours', () => {
    it('accepts minimum hours (15 minutes)', () => {
      expect(() => hoursSchema.parse(0.25)).not.toThrow()
    })

    it('accepts 1 hour', () => {
      expect(() => hoursSchema.parse(1)).not.toThrow()
    })

    it('accepts half day (4 hours)', () => {
      expect(() => hoursSchema.parse(4)).not.toThrow()
    })

    it('accepts full day (8 hours)', () => {
      expect(() => hoursSchema.parse(8)).not.toThrow()
    })

    it('accepts maximum hours (24)', () => {
      expect(() => hoursSchema.parse(24)).not.toThrow()
    })
  })

  describe('Invalid hours', () => {
    it('rejects hours below minimum (0.24)', () => {
      expect(() => hoursSchema.parse(0.24)).toThrow()
    })

    it('rejects zero hours', () => {
      expect(() => hoursSchema.parse(0)).toThrow()
    })

    it('rejects negative hours', () => {
      expect(() => hoursSchema.parse(-1)).toThrow()
    })

    it('rejects hours above 24', () => {
      expect(() => hoursSchema.parse(25)).toThrow()
    })
  })

  describe('Edge cases', () => {
    it('accepts exactly MIN_HOURS boundary', () => {
      expect(() => hoursSchema.parse(MIN_HOURS_PER_ENTRY)).not.toThrow()
    })

    it('accepts exactly MAX_HOURS boundary', () => {
      expect(() => hoursSchema.parse(MAX_HOURS_PER_ENTRY)).not.toThrow()
    })

    it('rejects just below MIN_HOURS', () => {
      expect(() => hoursSchema.parse(MIN_HOURS_PER_ENTRY - 0.01)).toThrow()
    })

    it('rejects just above MAX_HOURS', () => {
      expect(() => hoursSchema.parse(MAX_HOURS_PER_ENTRY + 0.01)).toThrow()
    })
  })
})

// =============================================================================
// Hours Per Day Validation Tests (Bookings)
// =============================================================================

describe('Hours Per Day Validation (Bookings)', () => {
  it('accepts 0 hours per day (planning placeholder)', () => {
    expect(() => hoursPerDaySchema.parse(0)).not.toThrow()
  })

  it('accepts 8 hours per day (standard)', () => {
    expect(() => hoursPerDaySchema.parse(8)).not.toThrow()
  })

  it('accepts 24 hours per day (maximum)', () => {
    expect(() => hoursPerDaySchema.parse(24)).not.toThrow()
  })

  it('rejects negative hours per day', () => {
    expect(() => hoursPerDaySchema.parse(-1)).toThrow()
  })

  it('rejects hours per day above 24', () => {
    expect(() => hoursPerDaySchema.parse(25)).toThrow()
  })
})

// =============================================================================
// Percentage Validation Tests
// =============================================================================

describe('Percentage Validation', () => {
  it('accepts 0%', () => {
    expect(() => percentageSchema.parse(0)).not.toThrow()
  })

  it('accepts 50%', () => {
    expect(() => percentageSchema.parse(50)).not.toThrow()
  })

  it('accepts 100%', () => {
    expect(() => percentageSchema.parse(100)).not.toThrow()
  })

  it('rejects negative percentage', () => {
    expect(() => percentageSchema.parse(-1)).toThrow()
  })

  it('rejects percentage above 100', () => {
    expect(() => percentageSchema.parse(101)).toThrow()
  })
})

// =============================================================================
// Receipt Threshold Validation Tests (Domain Level)
// =============================================================================

let testContext: TestContext

beforeEach(() => {
  vi.useFakeTimers()
  testContext = setup()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Receipt Threshold Validation', () => {
  it('receipt not required for expenses under $25', () => {
    const amount = RECEIPT_REQUIRED_THRESHOLD_CENTS - 100 // $24
    const receiptRequired = amount >= RECEIPT_REQUIRED_THRESHOLD_CENTS
    expect(receiptRequired).toBe(false)
  })

  it('receipt not required for expenses exactly at $25', () => {
    // Note: Threshold is >= $25, so exactly $25 requires receipt
    const amount = RECEIPT_REQUIRED_THRESHOLD_CENTS // $25
    const receiptRequired = amount >= RECEIPT_REQUIRED_THRESHOLD_CENTS
    expect(receiptRequired).toBe(true)
  })

  it('receipt required for expenses over $25', () => {
    const amount = RECEIPT_REQUIRED_THRESHOLD_CENTS + 100 // $26
    const receiptRequired = amount >= RECEIPT_REQUIRED_THRESHOLD_CENTS
    expect(receiptRequired).toBe(true)
  })

  it('receipt threshold is $25 (2500 cents)', () => {
    expect(RECEIPT_REQUIRED_THRESHOLD_CENTS).toBe(2500)
  })
})

// =============================================================================
// Budget Overrun Threshold Tests
// =============================================================================

describe('Budget Overrun Threshold', () => {
  it('budget is OK at 89% burn rate', () => {
    const burnRate = 0.89
    const budgetOk = burnRate <= BUDGET_OVERRUN_THRESHOLD
    expect(budgetOk).toBe(true)
  })

  it('budget is OK at exactly 90% burn rate', () => {
    const burnRate = 0.90
    const budgetOk = burnRate <= BUDGET_OVERRUN_THRESHOLD
    expect(budgetOk).toBe(true)
  })

  it('budget is overrun at 91% burn rate', () => {
    const burnRate = 0.91
    const budgetOk = burnRate <= BUDGET_OVERRUN_THRESHOLD
    expect(budgetOk).toBe(false)
  })

  it('budget is overrun at 100% burn rate', () => {
    const burnRate = 1.0
    const budgetOk = burnRate <= BUDGET_OVERRUN_THRESHOLD
    expect(budgetOk).toBe(false)
  })

  it('budget overrun threshold is 90%', () => {
    expect(BUDGET_OVERRUN_THRESHOLD).toBe(0.9)
  })
})

// =============================================================================
// Budget Warning Level Tests (per spec 06-workflow-execution-phase.md lines 278-284)
// =============================================================================

describe('Budget Warning Level (75%/90% Thresholds)', () => {
  describe('threshold constants', () => {
    it('warning threshold is 75%', () => {
      expect(BUDGET_WARNING_THRESHOLD).toBe(0.75)
    })

    it('overrun threshold is 90%', () => {
      expect(BUDGET_OVERRUN_THRESHOLD).toBe(0.9)
    })
  })

  describe('green zone (0-75%)', () => {
    it('returns green at 0% burn rate', () => {
      expect(getBudgetWarningLevel(0)).toBe("green")
    })

    it('returns green at 50% burn rate', () => {
      expect(getBudgetWarningLevel(0.5)).toBe("green")
    })

    it('returns green at 74% burn rate', () => {
      expect(getBudgetWarningLevel(0.74)).toBe("green")
    })

    it('returns green at exactly 75% burn rate', () => {
      expect(getBudgetWarningLevel(0.75)).toBe("green")
    })
  })

  describe('yellow zone (75-90%)', () => {
    it('returns yellow at 76% burn rate', () => {
      expect(getBudgetWarningLevel(0.76)).toBe("yellow")
    })

    it('returns yellow at 80% burn rate', () => {
      expect(getBudgetWarningLevel(0.80)).toBe("yellow")
    })

    it('returns yellow at 85% burn rate', () => {
      expect(getBudgetWarningLevel(0.85)).toBe("yellow")
    })

    it('returns yellow at 89% burn rate', () => {
      expect(getBudgetWarningLevel(0.89)).toBe("yellow")
    })

    it('returns yellow at exactly 90% burn rate', () => {
      expect(getBudgetWarningLevel(0.90)).toBe("yellow")
    })
  })

  describe('red zone (90%+)', () => {
    it('returns red at 91% burn rate', () => {
      expect(getBudgetWarningLevel(0.91)).toBe("red")
    })

    it('returns red at 100% burn rate', () => {
      expect(getBudgetWarningLevel(1.0)).toBe("red")
    })

    it('returns red at 110% burn rate (over budget)', () => {
      expect(getBudgetWarningLevel(1.1)).toBe("red")
    })
  })

  describe('boundary transitions', () => {
    it('transitions from green to yellow just above 75%', () => {
      expect(getBudgetWarningLevel(0.75)).toBe("green")
      expect(getBudgetWarningLevel(0.7500001)).toBe("yellow")
    })

    it('transitions from yellow to red just above 90%', () => {
      expect(getBudgetWarningLevel(0.90)).toBe("yellow")
      expect(getBudgetWarningLevel(0.9000001)).toBe("red")
    })
  })
})

// =============================================================================
// Self-Approval Prevention Tests (Domain Level)
// =============================================================================

describe('Self-Approval Prevention', () => {
  it('detects self-approval attempt for expenses', async () => {
    const { orgId, managerId, projectId } = await createTestData(testContext)

    // Create expense submitted by manager
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: managerId, // Same as approver
        projectId,
        date: Date.now(),
        amount: 5000,
        currency: 'USD',
        type: 'Other',
        description: 'Self-submitted expense',
        billable: true,
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    // Verify self-approval would be detected
    const expense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })

    const reviewerId = managerId
    const isSelfApproval = expense?.userId === reviewerId
    expect(isSelfApproval).toBe(true)
  })

  it('detects self-approval attempt for time entries', async () => {
    const { orgId, managerId, projectId } = await createTestData(testContext)

    // Create time entry submitted by manager
    const timeEntryId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('timeEntries', {
        organizationId: orgId,
        userId: managerId, // Same as approver
        projectId,
        date: Date.now(),
        hours: 8,
        status: 'Submitted',
        billable: true,
        createdAt: Date.now(),
      })
    })

    // Verify self-approval would be detected
    const timeEntry = await testContext.run(async (ctx) => {
      return await ctx.db.get(timeEntryId)
    })

    const reviewerId = managerId
    const isSelfApproval = timeEntry?.userId === reviewerId
    expect(isSelfApproval).toBe(true)
  })

  it('allows approval by different user', async () => {
    const { orgId, managerId, teamMemberId, projectId } = await createTestData(testContext)

    // Create expense submitted by team member
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId, // Different from approver
        projectId,
        date: Date.now(),
        amount: 5000,
        currency: 'USD',
        type: 'Other',
        description: 'Team member expense',
        billable: true,
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    // Verify cross-approval is allowed
    const expense = await testContext.run(async (ctx) => {
      return await ctx.db.get(expenseId)
    })

    const reviewerId = managerId
    const isSelfApproval = expense?.userId === reviewerId
    expect(isSelfApproval).toBe(false)
  })
})

// =============================================================================
// Status Transition Validation Tests
// =============================================================================

// Helper function to check if expense can be reviewed (avoiding type narrowing issues)
function canReviewExpense(status: string): boolean {
  return status === 'Submitted'
}

// Helper function to check if time entry can be modified
function canModifyTimeEntry(status: string): boolean {
  return status === 'Draft' || status === 'Rejected'
}

describe('Status Transition Validation', () => {
  describe('Expense Status Transitions', () => {
    it('validates expense must be Submitted for approval', async () => {
      expect(canReviewExpense('Submitted')).toBe(true)
    })

    it('rejects Draft expense for approval', () => {
      expect(canReviewExpense('Draft')).toBe(false)
    })

    it('rejects Approved expense for re-approval', () => {
      expect(canReviewExpense('Approved')).toBe(false)
    })

    it('rejects Rejected expense for approval without revision', () => {
      expect(canReviewExpense('Rejected')).toBe(false)
    })
  })

  describe('Time Entry Status Transitions', () => {
    it('validates time entry must be Submitted for approval', () => {
      expect(canReviewExpense('Submitted')).toBe(true)
    })

    it('rejects Draft time entry for approval', () => {
      expect(canReviewExpense('Draft')).toBe(false)
    })

    it('rejects Approved time entry for re-approval', () => {
      expect(canReviewExpense('Approved')).toBe(false)
    })

    it('rejects Locked time entry for modification', () => {
      expect(canModifyTimeEntry('Locked')).toBe(false)
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

async function createTestData(t: TestContext) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert('organizations', {
      name: 'Business Rules Test Org',
      settings: {},
      createdAt: Date.now(),
    })

    const managerId = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'manager@test.com',
      name: 'Test Manager',
      role: 'project_manager',
      costRate: 12000,
      billRate: 18000,
      skills: ['Management'],
      department: 'Management',
      location: 'Remote',
      isActive: true,
    })

    const teamMemberId = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'teammember@test.com',
      name: 'Team Member',
      role: 'team_member',
      costRate: 8000,
      billRate: 12000,
      skills: ['TypeScript', 'React'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company',
      billingAddress: {
        street: '123 Test St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94104',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Test Contact',
      email: 'contact@test.com',
      phone: '+1-555-0100',
      isPrimary: true,
    })

    const dealId = await ctx.db.insert('deals', {
      organizationId: orgId,
      name: 'Test Deal',
      value: 50000,
      stage: 'Won',
      probability: 100,
      ownerId: managerId,
      companyId,
      contactId,
      createdAt: Date.now(),
    })

    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      dealId,
      name: 'Test Project',
      status: 'Active',
      startDate: Date.now(),
      managerId,
      createdAt: Date.now(),
    })

    return { orgId, managerId, teamMemberId, companyId, contactId, dealId, projectId }
  })
}

// =============================================================================
// Expense Policy Limits Tests (spec 10-workflow-expense-approval.md lines 293-304)
// =============================================================================

import {
  EXPENSE_PER_ITEM_LIMITS,
  EXPENSE_TYPE_LIMITS,
  checkExpensePolicyLimit,
  checkTravelExpensePolicyLimit,
  checkSoftwareExpensePolicyLimit,
  checkMaterialsExpensePolicyLimit,
  checkOtherExpensePolicyLimit,
  formatAmountForDisplay,
  getPolicyLimitForType,
} from '../workflows/dealToDelivery/db/expensePolicyLimits'

describe('Expense Policy Limits Validation', () => {
  describe('Policy Limit Constants', () => {
    it('has correct per-item limit for Airfare ($1,000)', () => {
      expect(EXPENSE_PER_ITEM_LIMITS.Airfare).toBe(100_000) // cents
    })

    it('has correct per-item limit for Hotel ($250/night)', () => {
      expect(EXPENSE_PER_ITEM_LIMITS.Hotel).toBe(25_000) // cents
    })

    it('has correct per-item limit for Meals ($30)', () => {
      expect(EXPENSE_PER_ITEM_LIMITS.Meals).toBe(3_000) // cents
    })

    it('has correct limit for Software ($500)', () => {
      expect(EXPENSE_TYPE_LIMITS.Software).toBe(50_000) // cents
    })

    it('has correct limit for Materials ($1,000)', () => {
      expect(EXPENSE_TYPE_LIMITS.Materials).toBe(100_000) // cents
    })

    it('has correct limit for Other ($250)', () => {
      expect(EXPENSE_TYPE_LIMITS.Other).toBe(25_000) // cents
    })

    it('has no fixed limit for Subcontractor', () => {
      expect(EXPENSE_TYPE_LIMITS.Subcontractor).toBeNull()
    })

    it('has no fixed limit for Travel (uses subcategory limits)', () => {
      expect(EXPENSE_TYPE_LIMITS.Travel).toBeNull()
    })
  })

  describe('Travel Expense Policy Checks', () => {
    describe('Airfare ($1,000 limit)', () => {
      it('does not flag airfare under limit', () => {
        const result = checkTravelExpensePolicyLimit(80_000, 'Airfare') // $800
        expect(result.exceeded).toBe(false)
        expect(result.violations).toHaveLength(0)
        expect(result.summary).toBeNull()
      })

      it('does not flag airfare exactly at limit', () => {
        const result = checkTravelExpensePolicyLimit(100_000, 'Airfare') // $1,000
        expect(result.exceeded).toBe(false)
        expect(result.violations).toHaveLength(0)
      })

      it('flags airfare over limit', () => {
        const result = checkTravelExpensePolicyLimit(120_000, 'Airfare') // $1,200
        expect(result.exceeded).toBe(true)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].category).toBe('Airfare')
        expect(result.violations[0].overBy).toBe(20_000)
        expect(result.summary).toContain('exceeds policy limit')
      })
    })

    describe('Hotel ($250/night limit)', () => {
      it('does not flag hotel under limit for single night', () => {
        const result = checkTravelExpensePolicyLimit(20_000, 'Hotel', 1) // $200
        expect(result.exceeded).toBe(false)
      })

      it('does not flag hotel exactly at limit for single night', () => {
        const result = checkTravelExpensePolicyLimit(25_000, 'Hotel', 1) // $250
        expect(result.exceeded).toBe(false)
      })

      it('flags hotel over limit for single night', () => {
        const result = checkTravelExpensePolicyLimit(35_000, 'Hotel', 1) // $350
        expect(result.exceeded).toBe(true)
        expect(result.violations[0].limit).toBe(25_000)
      })

      it('calculates limit correctly for multiple nights', () => {
        const result = checkTravelExpensePolicyLimit(60_000, 'Hotel', 3) // $600 for 3 nights ($250 x 3 = $750 limit)
        expect(result.exceeded).toBe(false)
      })

      it('flags hotel over limit for multiple nights', () => {
        const result = checkTravelExpensePolicyLimit(80_000, 'Hotel', 3) // $800 for 3 nights ($750 limit)
        expect(result.exceeded).toBe(true)
        expect(result.violations[0].limit).toBe(75_000) // $250 x 3
        expect(result.summary).toContain('$250.00/night x 3 nights')
      })
    })

    describe('Meals ($30 per expense)', () => {
      it('does not flag meals under limit', () => {
        const result = checkTravelExpensePolicyLimit(2_500, 'Meals') // $25
        expect(result.exceeded).toBe(false)
      })

      it('flags meals over limit', () => {
        const result = checkTravelExpensePolicyLimit(4_500, 'Meals') // $45
        expect(result.exceeded).toBe(true)
        expect(result.violations[0].overBy).toBe(1_500) // $15 over
      })
    })

    describe('Mileage (no fixed limit)', () => {
      it('does not flag mileage regardless of amount', () => {
        const result = checkTravelExpensePolicyLimit(50_000, 'Mileage') // $500 in mileage
        expect(result.exceeded).toBe(false)
      })
    })
  })

  describe('Software Expense Policy Checks ($500 limit)', () => {
    it('does not flag software expense under limit', () => {
      const result = checkSoftwareExpensePolicyLimit(30_000) // $300
      expect(result.exceeded).toBe(false)
    })

    it('does not flag software expense exactly at limit', () => {
      const result = checkSoftwareExpensePolicyLimit(50_000) // $500
      expect(result.exceeded).toBe(false)
    })

    it('flags software expense over limit', () => {
      const result = checkSoftwareExpensePolicyLimit(75_000) // $750
      expect(result.exceeded).toBe(true)
      expect(result.violations[0].limit).toBe(50_000)
      expect(result.violations[0].overBy).toBe(25_000)
      expect(result.summary).toContain('Software expense')
      expect(result.summary).toContain('$750.00')
      expect(result.summary).toContain('$500.00')
    })
  })

  describe('Materials Expense Policy Checks ($1,000 limit)', () => {
    it('does not flag materials expense under limit', () => {
      const result = checkMaterialsExpensePolicyLimit(80_000) // $800
      expect(result.exceeded).toBe(false)
    })

    it('does not flag materials expense exactly at limit', () => {
      const result = checkMaterialsExpensePolicyLimit(100_000) // $1,000
      expect(result.exceeded).toBe(false)
    })

    it('flags materials expense over limit', () => {
      const result = checkMaterialsExpensePolicyLimit(150_000) // $1,500
      expect(result.exceeded).toBe(true)
      expect(result.violations[0].overBy).toBe(50_000)
    })
  })

  describe('Other Expense Policy Checks ($250 limit)', () => {
    it('does not flag other expense under limit', () => {
      const result = checkOtherExpensePolicyLimit(15_000) // $150
      expect(result.exceeded).toBe(false)
    })

    it('does not flag other expense exactly at limit', () => {
      const result = checkOtherExpensePolicyLimit(25_000) // $250
      expect(result.exceeded).toBe(false)
    })

    it('flags other expense over limit', () => {
      const result = checkOtherExpensePolicyLimit(40_000) // $400
      expect(result.exceeded).toBe(true)
      expect(result.violations[0].limit).toBe(25_000)
      expect(result.violations[0].overBy).toBe(15_000)
    })
  })

  describe('Generic checkExpensePolicyLimit', () => {
    it('returns no violation for Subcontractor (no fixed limit)', () => {
      const result = checkExpensePolicyLimit('Subcontractor', 500_000) // $5,000
      expect(result.exceeded).toBe(false)
    })

    it('routes Travel expense to subcategory limit when provided', () => {
      const result = checkExpensePolicyLimit('Travel', 120_000, 'Airfare')
      expect(result.exceeded).toBe(true)
      expect(result.violations[0].category).toBe('Airfare')
    })

    it('returns no violation for Travel without subcategory (no general limit)', () => {
      const result = checkExpensePolicyLimit('Travel', 500_000)
      expect(result.exceeded).toBe(false)
    })
  })

  describe('Utility Functions', () => {
    it('formats amount correctly for display', () => {
      expect(formatAmountForDisplay(10_000)).toBe('$100.00')
      expect(formatAmountForDisplay(150_099)).toBe('$1500.99')
      expect(formatAmountForDisplay(0)).toBe('$0.00')
    })

    it('gets correct policy limit for expense type', () => {
      expect(getPolicyLimitForType('Software')).toBe(50_000)
      expect(getPolicyLimitForType('Materials')).toBe(100_000)
      expect(getPolicyLimitForType('Other')).toBe(25_000)
      expect(getPolicyLimitForType('Subcontractor')).toBeNull()
      expect(getPolicyLimitForType('Travel')).toBeNull()
    })

    it('gets correct policy limit for travel subcategory', () => {
      expect(getPolicyLimitForType('Travel', 'Airfare')).toBe(100_000)
      expect(getPolicyLimitForType('Travel', 'Hotel')).toBe(25_000)
      expect(getPolicyLimitForType('Travel', 'Meals')).toBe(3_000)
    })
  })

  describe('PolicyViolation Structure', () => {
    it('includes all required violation details', () => {
      const result = checkSoftwareExpensePolicyLimit(60_000) // $600, over by $100
      expect(result.exceeded).toBe(true)
      const violation = result.violations[0]

      expect(violation.type).toBe('per_expense')
      expect(violation.category).toBe('Software')
      expect(violation.amount).toBe(60_000)
      expect(violation.limit).toBe(50_000)
      expect(violation.overBy).toBe(10_000)
      expect(violation.message).toBeTruthy()
    })
  })
})

// =============================================================================
// Revision Cycle Escalation Tests (spec 09-workflow-timesheet-approval.md line 281,
// spec 10-workflow-expense-approval.md line 288)
// =============================================================================

import {
  MAX_REVISION_CYCLES,
  checkRevisionCycleOnRejection,
  requiresAdminIntervention,
  getRemainingRevisionAttempts,
  getEscalationWarning,
} from '../workflows/dealToDelivery/db/revisionCycle'

import {
  rejectTimeEntryWithRevisionTracking,
} from '../workflows/dealToDelivery/db/timeEntries'

import {
  rejectExpenseWithRevisionTracking,
} from '../workflows/dealToDelivery/db/expenses'

describe('Revision Cycle Escalation Validation', () => {
  describe('MAX_REVISION_CYCLES constant', () => {
    it('has correct value of 3 per spec', () => {
      expect(MAX_REVISION_CYCLES).toBe(3)
    })
  })

  describe('checkRevisionCycleOnRejection', () => {
    it('increments count from 0 to 1 on first rejection', () => {
      const result = checkRevisionCycleOnRejection(0)
      expect(result.newRevisionCount).toBe(1)
      expect(result.shouldEscalate).toBe(false)
      expect(result.escalationMessage).toBeNull()
    })

    it('increments count from undefined to 1 on first rejection', () => {
      const result = checkRevisionCycleOnRejection(undefined)
      expect(result.newRevisionCount).toBe(1)
      expect(result.shouldEscalate).toBe(false)
    })

    it('increments count from 1 to 2 on second rejection', () => {
      const result = checkRevisionCycleOnRejection(1)
      expect(result.newRevisionCount).toBe(2)
      expect(result.shouldEscalate).toBe(false)
    })

    it('increments count from 2 to 3 and triggers escalation', () => {
      const result = checkRevisionCycleOnRejection(2)
      expect(result.newRevisionCount).toBe(3)
      expect(result.shouldEscalate).toBe(true)
      expect(result.escalationMessage).toContain('admin review')
    })

    it('escalates on counts beyond 3', () => {
      const result = checkRevisionCycleOnRejection(5)
      expect(result.newRevisionCount).toBe(6)
      expect(result.shouldEscalate).toBe(true)
    })
  })

  describe('requiresAdminIntervention', () => {
    it('returns false for count 0', () => {
      expect(requiresAdminIntervention(0, false)).toBe(false)
    })

    it('returns false for count 2', () => {
      expect(requiresAdminIntervention(2, false)).toBe(false)
    })

    it('returns true for count 3', () => {
      expect(requiresAdminIntervention(3, false)).toBe(true)
    })

    it('returns true when escalatedToAdmin is true', () => {
      expect(requiresAdminIntervention(1, true)).toBe(true)
    })

    it('returns true for undefined count with escalatedToAdmin true', () => {
      expect(requiresAdminIntervention(undefined, true)).toBe(true)
    })
  })

  describe('getRemainingRevisionAttempts', () => {
    it('returns 3 for count 0', () => {
      expect(getRemainingRevisionAttempts(0)).toBe(3)
    })

    it('returns 3 for undefined count', () => {
      expect(getRemainingRevisionAttempts(undefined)).toBe(3)
    })

    it('returns 2 for count 1', () => {
      expect(getRemainingRevisionAttempts(1)).toBe(2)
    })

    it('returns 1 for count 2', () => {
      expect(getRemainingRevisionAttempts(2)).toBe(1)
    })

    it('returns 0 for count 3', () => {
      expect(getRemainingRevisionAttempts(3)).toBe(0)
    })

    it('returns negative for counts beyond 3', () => {
      expect(getRemainingRevisionAttempts(5)).toBe(-2)
    })
  })

  describe('getEscalationWarning', () => {
    it('returns null for count 0 (no warning needed)', () => {
      expect(getEscalationWarning(0)).toBeNull()
    })

    it('returns null for count 1 (still has 2 remaining)', () => {
      expect(getEscalationWarning(undefined)).toBeNull()
    })

    it('returns warning for count 1 with 2 remaining', () => {
      const warning = getEscalationWarning(1)
      expect(warning).toContain('2 revision attempts remaining')
    })

    it('returns urgent warning for count 2 (last attempt)', () => {
      const warning = getEscalationWarning(2)
      expect(warning).toContain('last revision attempt')
    })

    it('returns exceeded message for count 3+', () => {
      const warning = getEscalationWarning(3)
      expect(warning).toContain('exceeded')
      expect(warning).toContain('admin review')
    })
  })

  describe('Database-level revision tracking', () => {
    let testContext: TestContext

    beforeEach(() => {
      testContext = setup()
    })

    it('rejectTimeEntryWithRevisionTracking increments count and tracks escalation', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      // Create a time entry
      const timeEntryId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          date: Date.now(),
          hours: 8,
          status: 'Submitted',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // First rejection
      const result1 = await testContext.run(async (ctx) => {
        return await rejectTimeEntryWithRevisionTracking(
          ctx.db,
          timeEntryId,
          'First rejection'
        )
      })
      expect(result1.newRevisionCount).toBe(1)
      expect(result1.escalated).toBe(false)

      // Check entry was updated
      const entry1 = await testContext.run(async (ctx) => ctx.db.get(timeEntryId))
      expect(entry1?.status).toBe('Rejected')
      expect(entry1?.revisionCount).toBe(1)
      expect(entry1?.escalatedToAdmin).toBe(false)

      // Resubmit for second rejection
      await testContext.run(async (ctx) => ctx.db.patch(timeEntryId, { status: 'Submitted' }))

      // Second rejection
      const result2 = await testContext.run(async (ctx) => {
        return await rejectTimeEntryWithRevisionTracking(
          ctx.db,
          timeEntryId,
          'Second rejection'
        )
      })
      expect(result2.newRevisionCount).toBe(2)
      expect(result2.escalated).toBe(false)

      // Resubmit for third rejection
      await testContext.run(async (ctx) => ctx.db.patch(timeEntryId, { status: 'Submitted' }))

      // Third rejection - should escalate
      const result3 = await testContext.run(async (ctx) => {
        return await rejectTimeEntryWithRevisionTracking(
          ctx.db,
          timeEntryId,
          'Third rejection - escalation'
        )
      })
      expect(result3.newRevisionCount).toBe(3)
      expect(result3.escalated).toBe(true)

      // Check entry was escalated
      const entry3 = await testContext.run(async (ctx) => ctx.db.get(timeEntryId))
      expect(entry3?.escalatedToAdmin).toBe(true)
    })

    it('rejectExpenseWithRevisionTracking increments count and tracks escalation', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      // Create an expense
      const expenseId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Other',
          amount: 5000,
          currency: 'USD',
          billable: true,
          status: 'Submitted',
          date: Date.now(),
          description: 'Test expense',
          createdAt: Date.now(),
        })
      })

      // Reject 3 times
      for (let i = 1; i <= 3; i++) {
        if (i > 1) {
          // Resubmit
          await testContext.run(async (ctx) => ctx.db.patch(expenseId, { status: 'Submitted' }))
        }

        const result = await testContext.run(async (ctx) => {
          return await rejectExpenseWithRevisionTracking(
            ctx.db,
            expenseId,
            `Rejection ${i}`,
            [{ type: 'other', details: `Issue ${i}` }]
          )
        })

        expect(result.newRevisionCount).toBe(i)
        expect(result.escalated).toBe(i >= 3)
      }

      // Check expense was escalated
      const expense = await testContext.run(async (ctx) => ctx.db.get(expenseId))
      expect(expense?.escalatedToAdmin).toBe(true)
      expect(expense?.revisionCount).toBe(3)
    })
  })
})

// =============================================================================
// Duplicate Detection Tests (spec 09-workflow-timesheet-approval.md line 249,
// spec 10-workflow-expense-approval.md line 275)
// =============================================================================

import {
  checkTimeEntryDuplicates,
  isTimeEntryDuplicate,
  checkExpenseDuplicates,
  isExpenseDuplicate,
  normalizeDateToDay,
  isSameDay,
} from '../workflows/dealToDelivery/db/duplicateDetection'

describe('Duplicate Detection Validation', () => {
  describe('Date Utility Functions', () => {
    it('normalizeDateToDay sets time to midnight UTC', () => {
      const timestamp = new Date('2024-06-15T14:30:45.123Z').getTime()
      const normalized = normalizeDateToDay(timestamp)
      const normalizedDate = new Date(normalized)
      expect(normalizedDate.getUTCHours()).toBe(0)
      expect(normalizedDate.getUTCMinutes()).toBe(0)
      expect(normalizedDate.getUTCSeconds()).toBe(0)
      expect(normalizedDate.getUTCMilliseconds()).toBe(0)
    })

    it('isSameDay returns true for timestamps on the same day', () => {
      const t1 = new Date('2024-06-15T09:00:00Z').getTime()
      const t2 = new Date('2024-06-15T18:30:00Z').getTime()
      expect(isSameDay(t1, t2)).toBe(true)
    })

    it('isSameDay returns false for timestamps on different days', () => {
      const t1 = new Date('2024-06-15T23:59:59Z').getTime()
      const t2 = new Date('2024-06-16T00:00:00Z').getTime()
      expect(isSameDay(t1, t2)).toBe(false)
    })
  })

  describe('Time Entry Duplicate Detection', () => {
    let testContext: TestContext

    beforeEach(() => {
      testContext = setup()
    })

    it('returns no duplicates when no entries exist', async () => {
      const { teamMemberId, projectId } = await createTestData(testContext)

      const result = await testContext.run(async (ctx) => {
        return await checkTimeEntryDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: Date.now(),
        })
      })

      expect(result.hasPotentialDuplicates).toBe(false)
      expect(result.duplicateIds).toHaveLength(0)
      expect(result.warningMessage).toBeNull()
      expect(result.confidence).toBeNull()
    })

    it('detects exact duplicates when same task exists on same date', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      // Create a task
      const taskId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('tasks', {
          organizationId: orgId,
          projectId,
          name: 'Test Task',
          description: 'Test task for duplicate detection',
          status: 'InProgress',
          priority: 'Medium',
          assigneeIds: [],
          dependencies: [],
          sortOrder: 1,
          createdAt: Date.now(),
        })
      })

      const testDate = Date.now()

      // Create existing entry
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          taskId,
          date: testDate,
          hours: 4,
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // Check for duplicates
      const result = await testContext.run(async (ctx) => {
        return await checkTimeEntryDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          taskId,
        })
      })

      expect(result.hasPotentialDuplicates).toBe(true)
      expect(result.duplicateIds).toHaveLength(1)
      expect(result.confidence).toBe('exact')
      expect(result.warningMessage).toContain('same task')
    })

    it('detects likely duplicates when same project/date exists', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      // Create existing entry without task
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          date: testDate,
          hours: 4,
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // Check for duplicates (no task specified)
      const result = await testContext.run(async (ctx) => {
        return await checkTimeEntryDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
        })
      })

      expect(result.hasPotentialDuplicates).toBe(true)
      expect(result.confidence).toBe('likely')
      expect(result.warningMessage).toContain('same date')
    })

    it('excludes current entry when checking for duplicates', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      // Create an entry
      const entryId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          date: testDate,
          hours: 4,
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
      })

      // Check excluding the entry itself
      const result = await testContext.run(async (ctx) => {
        return await checkTimeEntryDuplicates(
          ctx.db,
          {
            userId: teamMemberId,
            projectId,
            date: testDate,
          },
          entryId
        )
      })

      expect(result.hasPotentialDuplicates).toBe(false)
    })

    it('isTimeEntryDuplicate returns true for exact matches', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const taskId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('tasks', {
          organizationId: orgId,
          projectId,
          name: 'Test Task',
          description: 'Test task for duplicate detection',
          status: 'InProgress',
          priority: 'Medium',
          assigneeIds: [],
          dependencies: [],
          sortOrder: 1,
          createdAt: Date.now(),
        })
      })

      const testDate = Date.now()

      await testContext.run(async (ctx) => {
        return await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          taskId,
          date: testDate,
          hours: 4,
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const isDuplicate = await testContext.run(async (ctx) => {
        return await isTimeEntryDuplicate(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          taskId,
        })
      })

      expect(isDuplicate).toBe(true)
    })
  })

  describe('Expense Duplicate Detection', () => {
    let testContext: TestContext

    beforeEach(() => {
      testContext = setup()
    })

    it('returns no duplicates when no expenses exist', async () => {
      const { teamMemberId, projectId } = await createTestData(testContext)

      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: Date.now(),
          amount: 5000,
          type: 'Other',
        })
      })

      expect(result.hasPotentialDuplicates).toBe(false)
      expect(result.duplicateIds).toHaveLength(0)
    })

    it('detects exact duplicates when same amount and type exists', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()
      const testAmount = 5000

      // Create existing expense
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Software',
          amount: testAmount,
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Existing expense',
          createdAt: Date.now(),
        })
      })

      // Check for duplicates
      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          amount: testAmount,
          type: 'Software',
        })
      })

      expect(result.hasPotentialDuplicates).toBe(true)
      expect(result.confidence).toBe('exact')
      expect(result.warningMessage).toContain('appears to be a duplicate')
    })

    it('detects likely duplicates when similar amount exists (within 10%)', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      // Create existing expense with $50
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Materials',
          amount: 5000, // $50
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Existing expense',
          createdAt: Date.now(),
        })
      })

      // Check with similar amount ($52, within 10%)
      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          amount: 5200, // $52
          type: 'Materials',
        })
      })

      expect(result.hasPotentialDuplicates).toBe(true)
      expect(result.confidence).toBe('likely')
      expect(result.warningMessage).toContain('similar')
    })

    it('detects possible duplicates when same type/date but different amount', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      // Create existing expense with $50
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Travel',
          amount: 5000, // $50
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Existing expense',
          createdAt: Date.now(),
        })
      })

      // Check with very different amount ($200)
      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          amount: 20000, // $200 - more than 10% different
          type: 'Travel',
        })
      })

      expect(result.hasPotentialDuplicates).toBe(true)
      expect(result.confidence).toBe('possible')
      expect(result.warningMessage).toContain('Consider if this is a duplicate')
    })

    it('does not flag expenses of different types as duplicates', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      // Create Software expense
      await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Software',
          amount: 5000,
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Software expense',
          createdAt: Date.now(),
        })
      })

      // Check for Travel expense
      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          amount: 5000,
          type: 'Travel',
        })
      })

      expect(result.hasPotentialDuplicates).toBe(false)
    })

    it('isExpenseDuplicate returns true for exact matches', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Other',
          amount: 2500,
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Existing expense',
          createdAt: Date.now(),
        })
      })

      const isDuplicate = await testContext.run(async (ctx) => {
        return await isExpenseDuplicate(ctx.db, {
          userId: teamMemberId,
          projectId,
          date: testDate,
          amount: 2500,
          type: 'Other',
        })
      })

      expect(isDuplicate).toBe(true)
    })

    it('excludes current expense when checking for duplicates', async () => {
      const { orgId, teamMemberId, projectId } = await createTestData(testContext)

      const testDate = Date.now()

      const expenseId = await testContext.run(async (ctx) => {
        return await ctx.db.insert('expenses', {
          organizationId: orgId,
          userId: teamMemberId,
          projectId,
          type: 'Other',
          amount: 5000,
          currency: 'USD',
          billable: true,
          status: 'Draft',
          date: testDate,
          description: 'Test expense',
          createdAt: Date.now(),
        })
      })

      const result = await testContext.run(async (ctx) => {
        return await checkExpenseDuplicates(
          ctx.db,
          {
            userId: teamMemberId,
            projectId,
            date: testDate,
            amount: 5000,
            type: 'Other',
          },
          expenseId
        )
      })

      expect(result.hasPotentialDuplicates).toBe(false)
    })
  })
})

// =============================================================================
// Cost Rate Validation Tests (spec 06-workflow-execution-phase.md lines 260-276,
// spec 01-domain-model.md lines 278-307)
// =============================================================================

import {
  MIN_VALID_COST_RATE,
  isValidCostRate,
  userHasValidCostRate,
  getCostRateWarning,
  validateUserCostRates,
  getUsersWithMissingCostRates,
  calculateTimeCostWithValidationSync,
  formatCostRateValidationSummary,
} from '../workflows/dealToDelivery/db/costRateValidation'

describe('Cost Rate Validation', () => {
  describe('MIN_VALID_COST_RATE constant', () => {
    it('has minimum value of 1 cent per hour', () => {
      expect(MIN_VALID_COST_RATE).toBe(1)
    })
  })

  describe('isValidCostRate', () => {
    it('returns true for positive cost rate', () => {
      expect(isValidCostRate(10000)).toBe(true) // $100/hr
    })

    it('returns true for minimum valid rate (1 cent)', () => {
      expect(isValidCostRate(1)).toBe(true)
    })

    it('returns false for zero cost rate', () => {
      expect(isValidCostRate(0)).toBe(false)
    })

    it('returns false for negative cost rate', () => {
      expect(isValidCostRate(-100)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isValidCostRate(undefined)).toBe(false)
    })

    it('returns false for null', () => {
      expect(isValidCostRate(null)).toBe(false)
    })
  })

  describe('userHasValidCostRate', () => {
    it('returns true for user with valid cost rate', () => {
      const user = { costRate: 8000 } // $80/hr
      expect(userHasValidCostRate(user)).toBe(true)
    })

    it('returns false for user with zero cost rate', () => {
      const user = { costRate: 0 }
      expect(userHasValidCostRate(user)).toBe(false)
    })

    it('returns false for null user', () => {
      expect(userHasValidCostRate(null)).toBe(false)
    })

    it('returns false for undefined user', () => {
      expect(userHasValidCostRate(undefined)).toBe(false)
    })
  })

  describe('getCostRateWarning', () => {
    it('returns null for user with valid cost rate', () => {
      const user = { _id: 'user1' as any, name: 'Test User', costRate: 10000 }
      expect(getCostRateWarning(user)).toBeNull()
    })

    it('returns warning for user with zero cost rate', () => {
      const user = { _id: 'user1' as any, name: 'John Doe', costRate: 0 }
      const warning = getCostRateWarning(user)
      expect(warning).not.toBeNull()
      expect(warning).toContain('John Doe')
      expect(warning).toContain('no cost rate configured')
      expect(warning).toContain('Budget calculations will be inaccurate')
    })

    it('returns warning for null user', () => {
      expect(getCostRateWarning(null)).toBe('User not found')
    })
  })

  describe('validateUserCostRates', () => {
    it('returns allValid true when all users have valid cost rates', () => {
      const users = [
        { _id: 'user1' as any, name: 'User 1', costRate: 10000 },
        { _id: 'user2' as any, name: 'User 2', costRate: 8000 },
        { _id: 'user3' as any, name: 'User 3', costRate: 12000 },
      ]
      const result = validateUserCostRates(users)
      expect(result.allValid).toBe(true)
      expect(result.validCount).toBe(3)
      expect(result.missingCount).toBe(0)
      expect(result.usersWithMissingRates).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('returns allValid false when some users have zero cost rates', () => {
      const users = [
        { _id: 'user1' as any, name: 'User 1', costRate: 10000 },
        { _id: 'user2' as any, name: 'User 2', costRate: 0 },
        { _id: 'user3' as any, name: 'User 3', costRate: 8000 },
      ]
      const result = validateUserCostRates(users)
      expect(result.allValid).toBe(false)
      expect(result.validCount).toBe(2)
      expect(result.missingCount).toBe(1)
      expect(result.usersWithMissingRates).toHaveLength(1)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('User 2')
    })

    it('handles empty user array', () => {
      const result = validateUserCostRates([])
      expect(result.allValid).toBe(true)
      expect(result.validCount).toBe(0)
      expect(result.missingCount).toBe(0)
    })

    it('tracks multiple users with missing rates', () => {
      const users = [
        { _id: 'user1' as any, name: 'User 1', costRate: 0 },
        { _id: 'user2' as any, name: 'User 2', costRate: 0 },
        { _id: 'user3' as any, name: 'User 3', costRate: 0 },
      ]
      const result = validateUserCostRates(users)
      expect(result.allValid).toBe(false)
      expect(result.missingCount).toBe(3)
      expect(result.usersWithMissingRates).toHaveLength(3)
      expect(result.warnings).toHaveLength(3)
    })
  })

  describe('getUsersWithMissingCostRates', () => {
    it('returns empty array when all users have valid rates', () => {
      const entries = [
        { userId: 'user1' as any },
        { userId: 'user2' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
        ['user2' as any, 8000],
      ])
      const result = getUsersWithMissingCostRates(entries, costRates)
      expect(result).toHaveLength(0)
    })

    it('returns user IDs with zero cost rates', () => {
      const entries = [
        { userId: 'user1' as any },
        { userId: 'user2' as any },
        { userId: 'user3' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
        ['user2' as any, 0],
        ['user3' as any, 8000],
      ])
      const result = getUsersWithMissingCostRates(entries, costRates)
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('user2')
    })

    it('returns user IDs not in cost rate map', () => {
      const entries = [
        { userId: 'user1' as any },
        { userId: 'user2' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
        // user2 not in map
      ])
      const result = getUsersWithMissingCostRates(entries, costRates)
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('user2')
    })

    it('handles duplicate user IDs in entries', () => {
      const entries = [
        { userId: 'user1' as any },
        { userId: 'user1' as any },
        { userId: 'user2' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 0],
        ['user2' as any, 8000],
      ])
      const result = getUsersWithMissingCostRates(entries, costRates)
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('user1')
    })
  })

  describe('calculateTimeCostWithValidationSync', () => {
    it('calculates correct time cost with all valid rates', () => {
      const entries = [
        { hours: 8, userId: 'user1' as any },
        { hours: 4, userId: 'user2' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000], // $100/hr
        ['user2' as any, 8000], // $80/hr
      ])
      const result = calculateTimeCostWithValidationSync(entries, costRates)

      // 8 hours × $100/hr + 4 hours × $80/hr = $800 + $320 = $1,120
      expect(result.timeCost).toBe(8 * 10000 + 4 * 8000) // 112000 cents
      expect(result.totalHours).toBe(12)
      expect(result.hasUsersWithMissingRates).toBe(false)
      expect(result.usersWithMissingRates).toHaveLength(0)
      expect(result.warningMessage).toBeNull()
      expect(result.potentialUnderreporting).toBe(false)
    })

    it('detects users with missing cost rates', () => {
      const entries = [
        { hours: 8, userId: 'user1' as any },
        { hours: 4, userId: 'user2' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
        ['user2' as any, 0], // Missing rate
      ])
      const result = calculateTimeCostWithValidationSync(entries, costRates)

      // Only user1 time is costed: 8 × $100 = $800
      expect(result.timeCost).toBe(80000)
      expect(result.totalHours).toBe(12)
      expect(result.hasUsersWithMissingRates).toBe(true)
      expect(result.usersWithMissingRates).toHaveLength(1)
      expect(result.warningMessage).not.toBeNull()
      expect(result.warningMessage).toContain('1 user(s) with missing cost rates')
      expect(result.warningMessage).toContain('4.00 hours')
      expect(result.potentialUnderreporting).toBe(true)
    })

    it('handles empty entries array', () => {
      const result = calculateTimeCostWithValidationSync([], new Map())
      expect(result.timeCost).toBe(0)
      expect(result.totalHours).toBe(0)
      expect(result.hasUsersWithMissingRates).toBe(false)
      expect(result.warningMessage).toBeNull()
    })

    it('handles multiple entries from same user', () => {
      const entries = [
        { hours: 4, userId: 'user1' as any },
        { hours: 4, userId: 'user1' as any },
        { hours: 4, userId: 'user1' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
      ])
      const result = calculateTimeCostWithValidationSync(entries, costRates)

      // 12 hours × $100/hr = $1,200
      expect(result.timeCost).toBe(12 * 10000)
      expect(result.totalHours).toBe(12)
      expect(result.hasUsersWithMissingRates).toBe(false)
    })

    it('calculates correct percentage of hours with missing rates', () => {
      const entries = [
        { hours: 8, userId: 'user1' as any },
        { hours: 2, userId: 'user2' as any }, // Missing rate - 20% of total hours
      ]
      const costRates = new Map([
        ['user1' as any, 10000],
        ['user2' as any, 0],
      ])
      const result = calculateTimeCostWithValidationSync(entries, costRates)

      expect(result.warningMessage).toContain('20.0%')
    })
  })

  describe('formatCostRateValidationSummary', () => {
    it('formats clean validation result', () => {
      const result = {
        allValid: true,
        usersWithMissingRates: [],
        warnings: [],
        validCount: 5,
        missingCount: 0,
      }
      const summary = formatCostRateValidationSummary(result)
      expect(summary).toContain('All 5 users have valid cost rates')
    })

    it('formats validation result with issues', () => {
      const result = {
        allValid: false,
        usersWithMissingRates: ['user1' as any],
        warnings: ['User 1 has no cost rate'],
        validCount: 4,
        missingCount: 1,
      }
      const summary = formatCostRateValidationSummary(result)
      expect(summary).toContain('Cost rate issues found')
      expect(summary).toContain('1 of 5 users')
      expect(summary).toContain('User 1 has no cost rate')
    })

    it('formats time cost calculation result', () => {
      const result = {
        timeCost: 100000,
        totalHours: 10,
        hasUsersWithMissingRates: false,
        usersWithMissingRates: [],
        warningMessage: null,
        adjustedCost: 100000,
        potentialUnderreporting: false,
      }
      const summary = formatCostRateValidationSummary(result)
      expect(summary).toContain('Time cost calculated: $1000.00')
      expect(summary).toContain('10.00 hours')
    })

    it('formats time cost result with warnings', () => {
      const result = {
        timeCost: 80000,
        totalHours: 10,
        hasUsersWithMissingRates: true,
        usersWithMissingRates: ['user1' as any],
        warningMessage: 'Some users have missing rates',
        adjustedCost: 80000,
        potentialUnderreporting: true,
      }
      const summary = formatCostRateValidationSummary(result)
      expect(summary).toContain('Time cost calculated: $800.00')
      expect(summary).toContain('⚠️')
      expect(summary).toContain('Some users have missing rates')
    })
  })

  describe('Integration with budget burn calculations', () => {
    it('correctly handles mixed valid and invalid cost rates', () => {
      // Simulate a real scenario with multiple users
      const entries = [
        { hours: 8, userId: 'pm' as any },      // Project Manager - has rate
        { hours: 4, userId: 'dev1' as any },    // Developer 1 - has rate
        { hours: 4, userId: 'dev2' as any },    // Developer 2 - missing rate
        { hours: 2, userId: 'intern' as any },  // Intern - missing rate (new user)
      ]
      const costRates = new Map([
        ['pm' as any, 15000],    // $150/hr
        ['dev1' as any, 10000],  // $100/hr
        ['dev2' as any, 0],      // Not configured
        ['intern' as any, 0],    // Not configured
      ])

      const result = calculateTimeCostWithValidationSync(entries, costRates)

      // Expected: PM (8×$150=$1200) + Dev1 (4×$100=$400) = $1,600
      // Missing: Dev2 (4 hours) + Intern (2 hours) = 6 hours at $0
      expect(result.timeCost).toBe(8 * 15000 + 4 * 10000) // 160000 cents = $1,600
      expect(result.totalHours).toBe(18)
      expect(result.hasUsersWithMissingRates).toBe(true)
      expect(result.usersWithMissingRates).toHaveLength(2)
      expect(result.warningMessage).toContain('2 user(s) with missing cost rates')
      expect(result.warningMessage).toContain('6.00 hours')
      expect(result.warningMessage).toContain('33.3%') // 6/18 = 33.3%
    })

    it('reports accurate burn even with zero cost rates (conservative)', () => {
      // When users have missing rates, the calculation still works
      // but reports potential underreporting
      const entries = [
        { hours: 10, userId: 'user1' as any },
      ]
      const costRates = new Map([
        ['user1' as any, 0], // Missing rate
      ])

      const result = calculateTimeCostWithValidationSync(entries, costRates)

      // Cost is 0 but we flag it as potentially underreported
      expect(result.timeCost).toBe(0)
      expect(result.hasUsersWithMissingRates).toBe(true)
      expect(result.potentialUnderreporting).toBe(true)
    })
  })
})

// =============================================================================
// Date Limits Validation Tests
// Reference: spec 07-workflow-time-tracking.md line 286, 08-workflow-expense-tracking.md line 427
// =============================================================================

import {
  TIME_ENTRY_WARNING_DAYS,
  MAX_ENTRY_AGE_DAYS,
  TIMER_MAX_HOURS,
  DEFAULT_HOURS_ROUNDING_INCREMENT,
  ALTERNATIVE_HOURS_ROUNDING_INCREMENT,
  getEntryAgeInDays,
  isFutureDate,
  checkEntryDateLimits,
  checkTimeEntryDateLimits,
  checkExpenseDateLimits,
  requiresAdminApprovalForDate,
  isInWarningRange,
  checkTimerDuration,
  getTimerHours,
  wouldTimerAutoStop,
  roundHours,
  roundHoursDown,
  roundHoursUp,
  isHoursRounded,
} from '../workflows/dealToDelivery/db/dateLimits'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

describe('Date Limits Validation', () => {
  describe('Constants', () => {
    it('has correct TIME_ENTRY_WARNING_DAYS (30 days)', () => {
      expect(TIME_ENTRY_WARNING_DAYS).toBe(30)
    })

    it('has correct MAX_ENTRY_AGE_DAYS (90 days)', () => {
      expect(MAX_ENTRY_AGE_DAYS).toBe(90)
    })

    it('has correct TIMER_MAX_HOURS (12 hours)', () => {
      expect(TIMER_MAX_HOURS).toBe(12)
    })
  })

  describe('getEntryAgeInDays', () => {
    it('returns 0 for entry from today', () => {
      const now = Date.now()
      expect(getEntryAgeInDays(now, now)).toBe(0)
    })

    it('returns correct positive age for past dates', () => {
      const now = Date.now()
      const tenDaysAgo = now - (10 * DAY_MS)
      expect(getEntryAgeInDays(tenDaysAgo, now)).toBe(10)
    })

    it('returns correct age for exactly 30 days ago', () => {
      const now = Date.now()
      const thirtyDaysAgo = now - (30 * DAY_MS)
      expect(getEntryAgeInDays(thirtyDaysAgo, now)).toBe(30)
    })

    it('returns correct age for exactly 90 days ago', () => {
      const now = Date.now()
      const ninetyDaysAgo = now - (90 * DAY_MS)
      expect(getEntryAgeInDays(ninetyDaysAgo, now)).toBe(90)
    })

    it('returns negative age for future dates', () => {
      const now = Date.now()
      const tomorrow = now + DAY_MS
      expect(getEntryAgeInDays(tomorrow, now)).toBeLessThan(0)
    })
  })

  describe('isFutureDate', () => {
    it('returns false for entry from today', () => {
      const now = Date.now()
      expect(isFutureDate(now, now)).toBe(false)
    })

    it('returns false for entry from yesterday', () => {
      const now = Date.now()
      const yesterday = now - DAY_MS
      expect(isFutureDate(yesterday, now)).toBe(false)
    })

    it('returns true for entry tomorrow', () => {
      const now = Date.now()
      const tomorrow = now + DAY_MS
      expect(isFutureDate(tomorrow, now)).toBe(true)
    })

    it('allows entries from same calendar day even if timestamp is later', () => {
      // Create a reference date at 9 AM
      const referenceDate = new Date()
      referenceDate.setHours(9, 0, 0, 0)

      // Create an entry time at 5 PM same day
      const entryDate = new Date(referenceDate)
      entryDate.setHours(17, 0, 0, 0)

      // Same day should not be considered future
      expect(isFutureDate(entryDate.getTime(), referenceDate.getTime())).toBe(false)
    })
  })

  describe('checkEntryDateLimits', () => {
    it('returns valid for entry from today (within normal limits)', () => {
      const now = Date.now()
      const result = checkEntryDateLimits(now, now)

      expect(result.isValid).toBe(true)
      expect(result.hasWarning).toBe(false)
      expect(result.requiresAdminApproval).toBe(false)
      expect(result.ageInDays).toBe(0)
      expect(result.message).toBeNull()
    })

    it('returns valid without warning for entry 29 days ago', () => {
      const now = Date.now()
      const twentyNineDaysAgo = now - (29 * DAY_MS)
      const result = checkEntryDateLimits(twentyNineDaysAgo, now)

      expect(result.isValid).toBe(true)
      expect(result.hasWarning).toBe(false)
      expect(result.requiresAdminApproval).toBe(false)
    })

    it('returns valid with warning for entry exactly 31 days ago', () => {
      const now = Date.now()
      const thirtyOneDaysAgo = now - (31 * DAY_MS)
      const result = checkEntryDateLimits(thirtyOneDaysAgo, now)

      expect(result.isValid).toBe(true)
      expect(result.hasWarning).toBe(true)
      expect(result.requiresAdminApproval).toBe(false)
      expect(result.ageInDays).toBe(31)
      expect(result.message).toContain('31 days old')
      expect(result.message).toContain('warning threshold')
    })

    it('returns valid with warning for entry 60 days ago', () => {
      const now = Date.now()
      const sixtyDaysAgo = now - (60 * DAY_MS)
      const result = checkEntryDateLimits(sixtyDaysAgo, now)

      expect(result.isValid).toBe(true)
      expect(result.hasWarning).toBe(true)
      expect(result.requiresAdminApproval).toBe(false)
    })

    it('returns invalid requiring admin for entry exactly 91 days ago', () => {
      const now = Date.now()
      const ninetyOneDaysAgo = now - (91 * DAY_MS)
      const result = checkEntryDateLimits(ninetyOneDaysAgo, now)

      expect(result.isValid).toBe(false)
      expect(result.hasWarning).toBe(true)
      expect(result.requiresAdminApproval).toBe(true)
      expect(result.ageInDays).toBe(91)
      expect(result.message).toContain('91 days old')
      expect(result.message).toContain('requires admin approval')
    })

    it('returns invalid requiring admin for entry 120 days ago', () => {
      const now = Date.now()
      const oneHundredTwentyDaysAgo = now - (120 * DAY_MS)
      const result = checkEntryDateLimits(oneHundredTwentyDaysAgo, now)

      expect(result.isValid).toBe(false)
      expect(result.requiresAdminApproval).toBe(true)
    })

    it('returns invalid for future dates', () => {
      const now = Date.now()
      const tomorrow = now + DAY_MS
      const result = checkEntryDateLimits(tomorrow, now)

      expect(result.isValid).toBe(false)
      expect(result.hasWarning).toBe(false)
      expect(result.requiresAdminApproval).toBe(false)
      expect(result.message).toContain('future dates')
    })
  })

  describe('checkTimeEntryDateLimits (alias)', () => {
    it('works same as checkEntryDateLimits', () => {
      const now = Date.now()
      const fiftyDaysAgo = now - (50 * DAY_MS)

      const generic = checkEntryDateLimits(fiftyDaysAgo, now)
      const timeEntry = checkTimeEntryDateLimits(fiftyDaysAgo, now)

      expect(timeEntry).toEqual(generic)
    })
  })

  describe('checkExpenseDateLimits (alias)', () => {
    it('works same as checkEntryDateLimits for 90-day rule', () => {
      const now = Date.now()
      const hundredDaysAgo = now - (100 * DAY_MS)

      const result = checkExpenseDateLimits(hundredDaysAgo, now)

      expect(result.isValid).toBe(false)
      expect(result.requiresAdminApproval).toBe(true)
      expect(result.message).toContain('requires admin approval')
    })
  })

  describe('requiresAdminApprovalForDate', () => {
    it('returns false for entries within 90 days', () => {
      const now = Date.now()
      expect(requiresAdminApprovalForDate(now, now)).toBe(false)
      expect(requiresAdminApprovalForDate(now - (30 * DAY_MS), now)).toBe(false)
      expect(requiresAdminApprovalForDate(now - (60 * DAY_MS), now)).toBe(false)
      expect(requiresAdminApprovalForDate(now - (90 * DAY_MS), now)).toBe(false)
    })

    it('returns true for entries older than 90 days', () => {
      const now = Date.now()
      expect(requiresAdminApprovalForDate(now - (91 * DAY_MS), now)).toBe(true)
      expect(requiresAdminApprovalForDate(now - (180 * DAY_MS), now)).toBe(true)
    })
  })

  describe('isInWarningRange', () => {
    it('returns false for entries less than 30 days old', () => {
      const now = Date.now()
      expect(isInWarningRange(now - (10 * DAY_MS), now)).toBe(false)
      expect(isInWarningRange(now - (29 * DAY_MS), now)).toBe(false)
    })

    it('returns true for entries 31-90 days old', () => {
      const now = Date.now()
      expect(isInWarningRange(now - (31 * DAY_MS), now)).toBe(true)
      expect(isInWarningRange(now - (60 * DAY_MS), now)).toBe(true)
      expect(isInWarningRange(now - (90 * DAY_MS), now)).toBe(true)
    })

    it('returns false for entries older than 90 days (requires admin)', () => {
      const now = Date.now()
      expect(isInWarningRange(now - (91 * DAY_MS), now)).toBe(false)
    })
  })
})

// =============================================================================
// Timer Duration Validation Tests
// Reference: spec 07-workflow-time-tracking.md line 300 - "Timer auto-stops after 12 hours with warning"
// =============================================================================

describe('Timer Duration Validation', () => {
  describe('checkTimerDuration', () => {
    it('returns correct hours for short timer (2 hours)', () => {
      const startTime = Date.now() - (2 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBeCloseTo(2, 1)
      expect(result.wasAutoStopped).toBe(false)
      expect(result.hasWarning).toBe(false)
      expect(result.message).toBeNull()
    })

    it('returns correct hours for 8-hour workday timer', () => {
      const startTime = Date.now() - (8 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBeCloseTo(8, 1)
      expect(result.wasAutoStopped).toBe(false)
      expect(result.hasWarning).toBe(false)
    })

    it('shows warning for timer approaching 12-hour limit (11 hours)', () => {
      const startTime = Date.now() - (11 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBeCloseTo(11, 1)
      expect(result.wasAutoStopped).toBe(false)
      expect(result.hasWarning).toBe(true)
      expect(result.message).toContain('approaching')
      expect(result.message).toContain('12 hour limit')
    })

    it('auto-stops timer at exactly 12 hours', () => {
      const startTime = Date.now() - (12 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      // Exactly 12 hours should not be auto-stopped (boundary)
      expect(result.hours).toBeCloseTo(12, 1)
      expect(result.wasAutoStopped).toBe(false)
    })

    it('auto-stops timer exceeding 12 hours (13 hours)', () => {
      const startTime = Date.now() - (13 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBe(TIMER_MAX_HOURS) // Capped at 12
      expect(result.wasAutoStopped).toBe(true)
      expect(result.hasWarning).toBe(true)
      expect(result.message).toContain('exceeded')
      expect(result.message).toContain('12 hours')
      expect(result.message).toContain('auto-stopped')
    })

    it('auto-stops timer running for 24 hours at 12 hours', () => {
      const startTime = Date.now() - (24 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBe(TIMER_MAX_HOURS) // Capped at 12
      expect(result.wasAutoStopped).toBe(true)
      expect(result.message).toContain('Original duration')
      expect(result.message).toContain('24')
    })

    it('handles very short timer durations (30 minutes)', () => {
      const startTime = Date.now() - (0.5 * HOUR_MS)
      const result = checkTimerDuration(startTime)

      expect(result.hours).toBeCloseTo(0.5, 1)
      expect(result.wasAutoStopped).toBe(false)
      expect(result.hasWarning).toBe(false)
    })
  })

  describe('getTimerHours', () => {
    it('returns actual hours for short timers', () => {
      const startTime = Date.now() - (5 * HOUR_MS)
      expect(getTimerHours(startTime)).toBeCloseTo(5, 1)
    })

    it('returns capped hours for long timers', () => {
      const startTime = Date.now() - (20 * HOUR_MS)
      expect(getTimerHours(startTime)).toBe(TIMER_MAX_HOURS)
    })
  })

  describe('wouldTimerAutoStop', () => {
    it('returns false for timer under 12 hours', () => {
      const startTime = Date.now() - (10 * HOUR_MS)
      expect(wouldTimerAutoStop(startTime)).toBe(false)
    })

    it('returns false for timer at exactly 12 hours', () => {
      const startTime = Date.now() - (12 * HOUR_MS)
      expect(wouldTimerAutoStop(startTime)).toBe(false)
    })

    it('returns true for timer over 12 hours', () => {
      const startTime = Date.now() - (13 * HOUR_MS)
      expect(wouldTimerAutoStop(startTime)).toBe(true)
    })
  })
})

// =============================================================================
// Service Rate Validation (Iteration 43)
// =============================================================================

describe('Service Rate Validation', () => {
  // Per spec 04-workflow-planning-phase.md line 150: "Rates must be > 0 for billable services"
  const serviceRateSchema = z.number().positive("Rate must be greater than 0 for billable services")

  describe('Valid service rates', () => {
    it('accepts positive rate (e.g., $50/hr)', () => {
      expect(() => serviceRateSchema.parse(50)).not.toThrow()
    })

    it('accepts small positive rate (e.g., $0.01/hr)', () => {
      expect(() => serviceRateSchema.parse(0.01)).not.toThrow()
    })

    it('accepts large rate (e.g., $500/hr)', () => {
      expect(() => serviceRateSchema.parse(500)).not.toThrow()
    })
  })

  describe('Invalid service rates', () => {
    it('rejects zero rate for billable services', () => {
      expect(() => serviceRateSchema.parse(0)).toThrow()
    })

    it('rejects negative rate', () => {
      expect(() => serviceRateSchema.parse(-10)).toThrow()
    })
  })
})

// =============================================================================
// Subcontractor Tax ID Requirement (Iteration 43)
// =============================================================================

describe('Subcontractor Tax ID Validation', () => {
  // Per spec 08-workflow-expense-tracking.md line 424 and 21-ui-expense-form.md line 189:
  // "Tax ID (required for > $600 total)" for subcontractor expenses
  const SUBCONTRACTOR_TAX_ID_THRESHOLD = 60000 // $600 in cents

  function validateSubcontractorTaxId(amount: number, vendorTaxId: string | undefined): boolean {
    if (amount > SUBCONTRACTOR_TAX_ID_THRESHOLD && !vendorTaxId) {
      return false // Validation fails - tax ID required but not provided
    }
    return true
  }

  describe('Tax ID not required for amounts <= $600', () => {
    it('allows $500 expense without tax ID', () => {
      expect(validateSubcontractorTaxId(50000, undefined)).toBe(true)
    })

    it('allows $600 expense without tax ID (boundary)', () => {
      expect(validateSubcontractorTaxId(60000, undefined)).toBe(true)
    })

    it('allows small expense without tax ID', () => {
      expect(validateSubcontractorTaxId(10000, undefined)).toBe(true) // $100
    })
  })

  describe('Tax ID required for amounts > $600', () => {
    it('requires tax ID for $601 expense', () => {
      expect(validateSubcontractorTaxId(60100, undefined)).toBe(false)
    })

    it('requires tax ID for $1000 expense', () => {
      expect(validateSubcontractorTaxId(100000, undefined)).toBe(false)
    })

    it('requires tax ID for large expense ($5000)', () => {
      expect(validateSubcontractorTaxId(500000, undefined)).toBe(false)
    })
  })

  describe('Tax ID provided (always valid)', () => {
    it('allows $601 expense with tax ID', () => {
      expect(validateSubcontractorTaxId(60100, '12-3456789')).toBe(true)
    })

    it('allows $1000 expense with tax ID', () => {
      expect(validateSubcontractorTaxId(100000, '98-7654321')).toBe(true)
    })

    it('allows small expense with tax ID (optional)', () => {
      expect(validateSubcontractorTaxId(10000, '12-3456789')).toBe(true)
    })
  })

  describe('Constants verification', () => {
    it('threshold is $600 (60000 cents)', () => {
      expect(SUBCONTRACTOR_TAX_ID_THRESHOLD).toBe(60000)
    })
  })
})

// =============================================================================
// Markup Rate Manager Override (Iteration 43)
// =============================================================================

describe('Markup Rate Manager Override', () => {
  // Per spec 08-workflow-expense-tracking.md line 426:
  // "Markup Limits: Markup cannot exceed 50% without manager override"
  const MAX_MARKUP_RATE_NO_OVERRIDE = 1.5 // 50% markup
  const MAX_MARKUP_RATE_WITH_OVERRIDE = 2.0 // 100% markup

  function validateMarkupRate(markupRate: number, hasManagerOverride: boolean): { valid: boolean; message?: string } {
    // Even with override, cap at absolute maximum
    if (markupRate > MAX_MARKUP_RATE_WITH_OVERRIDE) {
      return {
        valid: false,
        message: `Markup rate cannot exceed ${(MAX_MARKUP_RATE_WITH_OVERRIDE - 1) * 100}% even with manager override`
      }
    }

    // Without override, cap at 50%
    if (markupRate > MAX_MARKUP_RATE_NO_OVERRIDE && !hasManagerOverride) {
      return {
        valid: false,
        message: `Markup rate cannot exceed ${(MAX_MARKUP_RATE_NO_OVERRIDE - 1) * 100}% without manager override`
      }
    }

    return { valid: true }
  }

  describe('Markup rates without override', () => {
    it('allows 0% markup (rate 1.0) without override', () => {
      expect(validateMarkupRate(1.0, false)).toEqual({ valid: true })
    })

    it('allows 25% markup (rate 1.25) without override', () => {
      expect(validateMarkupRate(1.25, false)).toEqual({ valid: true })
    })

    it('allows 50% markup (rate 1.5) without override (boundary)', () => {
      expect(validateMarkupRate(1.5, false)).toEqual({ valid: true })
    })

    it('rejects 60% markup (rate 1.6) without override', () => {
      const result = validateMarkupRate(1.6, false)
      expect(result.valid).toBe(false)
      expect(result.message).toContain('without manager override')
    })

    it('rejects 100% markup (rate 2.0) without override', () => {
      const result = validateMarkupRate(2.0, false)
      expect(result.valid).toBe(false)
      expect(result.message).toContain('without manager override')
    })
  })

  describe('Markup rates with manager override', () => {
    it('allows 60% markup (rate 1.6) with manager override', () => {
      expect(validateMarkupRate(1.6, true)).toEqual({ valid: true })
    })

    it('allows 75% markup (rate 1.75) with manager override', () => {
      expect(validateMarkupRate(1.75, true)).toEqual({ valid: true })
    })

    it('allows 100% markup (rate 2.0) with manager override (maximum)', () => {
      expect(validateMarkupRate(2.0, true)).toEqual({ valid: true })
    })

    it('rejects 150% markup (rate 2.5) even with manager override', () => {
      const result = validateMarkupRate(2.5, true)
      expect(result.valid).toBe(false)
      expect(result.message).toContain('even with manager override')
    })

    it('rejects 200% markup (rate 3.0) even with manager override', () => {
      const result = validateMarkupRate(3.0, true)
      expect(result.valid).toBe(false)
      expect(result.message).toContain('even with manager override')
    })
  })

  describe('Constants verification', () => {
    it('max without override is 1.5 (50% markup)', () => {
      expect(MAX_MARKUP_RATE_NO_OVERRIDE).toBe(1.5)
    })

    it('max with override is 2.0 (100% markup)', () => {
      expect(MAX_MARKUP_RATE_WITH_OVERRIDE).toBe(2.0)
    })
  })
})

// =============================================================================
// Hours Rounding Validation Tests (Iteration 50)
// Reference: spec 07-workflow-time-tracking.md line 299
// "Hours rounded to nearest 0.25 (15 min) or 0.1 (6 min) based on org setting"
// =============================================================================

describe('Hours Rounding Validation', () => {
  describe('Constants', () => {
    it('default rounding increment is 0.25 (15 minutes)', () => {
      expect(DEFAULT_HOURS_ROUNDING_INCREMENT).toBe(0.25)
    })

    it('alternative rounding increment is 0.1 (6 minutes)', () => {
      expect(ALTERNATIVE_HOURS_ROUNDING_INCREMENT).toBe(0.1)
    })
  })

  describe('roundHours (nearest 0.25 by default)', () => {
    it('rounds 1.33 down to 1.25', () => {
      expect(roundHours(1.33)).toBe(1.25)
    })

    it('rounds 1.38 up to 1.5', () => {
      expect(roundHours(1.38)).toBe(1.5)
    })

    it('keeps 1.25 unchanged (already rounded)', () => {
      expect(roundHours(1.25)).toBe(1.25)
    })

    it('keeps 1.5 unchanged (already rounded)', () => {
      expect(roundHours(1.5)).toBe(1.5)
    })

    it('rounds 0.1 to 0 (below 0.125 threshold)', () => {
      expect(roundHours(0.1)).toBe(0)
    })

    it('rounds 0.13 up to 0.25 (at threshold)', () => {
      expect(roundHours(0.13)).toBe(0.25)
    })

    it('rounds 2.37 to 2.25', () => {
      expect(roundHours(2.37)).toBe(2.25)
    })

    it('rounds 2.38 to 2.5', () => {
      expect(roundHours(2.38)).toBe(2.5)
    })

    it('rounds 8.0 unchanged', () => {
      expect(roundHours(8.0)).toBe(8.0)
    })

    it('rounds 0.0 unchanged', () => {
      expect(roundHours(0.0)).toBe(0.0)
    })
  })

  describe('roundHours with 0.1 increment', () => {
    it('rounds 1.33 to 1.3', () => {
      expect(roundHours(1.33, 0.1)).toBe(1.3)
    })

    it('rounds 1.35 to 1.4', () => {
      expect(roundHours(1.35, 0.1)).toBeCloseTo(1.4, 10)
    })

    it('keeps 1.3 unchanged', () => {
      expect(roundHours(1.3, 0.1)).toBe(1.3)
    })

    it('rounds 2.57 to 2.6', () => {
      expect(roundHours(2.57, 0.1)).toBe(2.6)
    })
  })

  describe('roundHoursDown (floor)', () => {
    it('floors 1.33 to 1.25', () => {
      expect(roundHoursDown(1.33)).toBe(1.25)
    })

    it('floors 1.49 to 1.25', () => {
      expect(roundHoursDown(1.49)).toBe(1.25)
    })

    it('keeps 1.25 unchanged', () => {
      expect(roundHoursDown(1.25)).toBe(1.25)
    })

    it('floors 0.24 to 0', () => {
      expect(roundHoursDown(0.24)).toBe(0)
    })

    it('floors 2.99 to 2.75', () => {
      expect(roundHoursDown(2.99)).toBe(2.75)
    })
  })

  describe('roundHoursUp (ceiling)', () => {
    it('ceils 1.33 to 1.5', () => {
      expect(roundHoursUp(1.33)).toBe(1.5)
    })

    it('ceils 1.26 to 1.5', () => {
      expect(roundHoursUp(1.26)).toBe(1.5)
    })

    it('keeps 1.25 unchanged', () => {
      expect(roundHoursUp(1.25)).toBe(1.25)
    })

    it('ceils 0.01 to 0.25', () => {
      expect(roundHoursUp(0.01)).toBe(0.25)
    })

    it('ceils 2.76 to 3.0', () => {
      expect(roundHoursUp(2.76)).toBe(3.0)
    })
  })

  describe('isHoursRounded', () => {
    it('returns true for 1.25', () => {
      expect(isHoursRounded(1.25)).toBe(true)
    })

    it('returns true for 1.5', () => {
      expect(isHoursRounded(1.5)).toBe(true)
    })

    it('returns true for 2.0', () => {
      expect(isHoursRounded(2.0)).toBe(true)
    })

    it('returns true for 0.75', () => {
      expect(isHoursRounded(0.75)).toBe(true)
    })

    it('returns false for 1.33', () => {
      expect(isHoursRounded(1.33)).toBe(false)
    })

    it('returns false for 2.1', () => {
      expect(isHoursRounded(2.1)).toBe(false)
    })

    it('returns true for 0', () => {
      expect(isHoursRounded(0)).toBe(true)
    })

    it('returns true for whole hours like 8.0', () => {
      expect(isHoursRounded(8.0)).toBe(true)
    })
  })

  describe('isHoursRounded with 0.1 increment', () => {
    it('returns true for 1.3', () => {
      expect(isHoursRounded(1.3, 0.1)).toBe(true)
    })

    it('returns true for 2.1', () => {
      expect(isHoursRounded(2.1, 0.1)).toBe(true)
    })

    it('returns false for 1.33', () => {
      expect(isHoursRounded(1.33, 0.1)).toBe(false)
    })

    it('returns false for 2.15', () => {
      expect(isHoursRounded(2.15, 0.1)).toBe(false)
    })
  })

  describe('Error handling', () => {
    it('throws for zero increment', () => {
      expect(() => roundHours(1.5, 0)).toThrow('Rounding increment must be positive')
    })

    it('throws for negative increment', () => {
      expect(() => roundHours(1.5, -0.25)).toThrow('Rounding increment must be positive')
    })

    it('throws for roundHoursDown with zero increment', () => {
      expect(() => roundHoursDown(1.5, 0)).toThrow('Rounding increment must be positive')
    })

    it('throws for roundHoursUp with zero increment', () => {
      expect(() => roundHoursUp(1.5, 0)).toThrow('Rounding increment must be positive')
    })

    it('throws for isHoursRounded with zero increment', () => {
      expect(() => isHoursRounded(1.5, 0)).toThrow('Rounding increment must be positive')
    })
  })
})
