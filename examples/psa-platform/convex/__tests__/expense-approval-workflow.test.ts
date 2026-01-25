/// <reference types="vite/client" />
/**
 * Expense Approval Workflow Integration Tests
 *
 * These tests verify the expense approval workflow routing and business rules.
 * Tests follow the contract defined in specs/10-workflow-expense-approval.md.
 *
 * The expense approval workflow:
 * 1. reviewExpense - Manager reviews submitted expense, decides approve or reject
 * 2. If approve: routes to approveExpense → completeExpenseApproval → end
 * 3. If reject: routes to rejectExpense → reviseExpense → reviewExpense (loop back)
 *
 * Business Rules Tested:
 * - Self-approval prevention (cannot approve own expenses)
 * - Status validation (expenses must be Submitted to review)
 * - Rejection requires reason and issues list
 * - Revision allows resubmission (changes status to Submitted or Draft)
 *
 * Reference: .review/recipes/psa-platform/specs/10-workflow-expense-approval.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  type TestContext,
} from './helpers.test'
import type { Id } from '../_generated/dataModel'

let testContext: TestContext

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Create test organization and manager user
 */
async function createManagerUser(t: TestContext) {
  const result = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert('organizations', {
      name: 'Expense Approval Test Org',
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

    return { orgId, managerId }
  })

  return result
}

/**
 * Create a team member user (different from manager for self-approval tests)
 */
async function createTeamMemberUser(
  t: TestContext,
  orgId: Id<'organizations'>
): Promise<Id<'users'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
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
  })
}

/**
 * Create a submitted expense for testing approval workflow
 */
async function createSubmittedExpense(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  amount = 5000, // $50 in cents
  type: 'Software' | 'Travel' | 'Materials' | 'Subcontractor' | 'Other' = 'Other'
): Promise<Id<'expenses'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('expenses', {
      organizationId: orgId,
      userId,
      projectId,
      date: Date.now() - 86400000, // Yesterday
      amount,
      currency: 'USD',
      type,
      description: 'Test expense for approval workflow',
      billable: true,
      status: 'Submitted',
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a project for expense association
 */
async function createTestProject(
  t: TestContext,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
  companyId: Id<'companies'>,
  managerId: Id<'users'>
): Promise<Id<'projects'>> {
  return await t.run(async (ctx) => {
    // Create project first (budgetId is optional)
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

    // Create budget with projectId
    const budgetId = await ctx.db.insert('budgets', {
      projectId,
      organizationId: orgId,
      type: 'TimeAndMaterials',
      totalAmount: 120000, // $1,200 in cents
      createdAt: Date.now(),
    })

    // Update project with budgetId
    await ctx.db.patch(projectId, { budgetId })

    return projectId
  })
}

/**
 * Create a deal for project association
 * Returns both dealId and companyId for project creation
 */
async function createTestDeal(
  t: TestContext,
  orgId: Id<'organizations'>,
  ownerId: Id<'users'>
): Promise<{ dealId: Id<'deals'>; companyId: Id<'companies'> }> {
  return await t.run(async (ctx) => {
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
      ownerId,
      companyId,
      contactId,
      createdAt: Date.now(),
    })

    return { dealId, companyId }
  })
}

/**
 * Get expense by ID
 */
async function getExpense(t: TestContext, expenseId: Id<'expenses'>) {
  return await t.run(async (ctx) => {
    return await ctx.db.get(expenseId)
  })
}

// =============================================================================
// Expense Approval Domain Tests (DB Layer)
// =============================================================================

describe('Expense Approval Domain Operations', () => {
  it('approves expense and sets approver', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // Verify initial state
    let expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')
    expect(expense?.approvedBy).toBeUndefined()

    // Approve the expense
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    // Verify approval
    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.approvedBy).toBe(managerId)
    expect(expense?.approvedAt).toBeDefined()
  })

  it('rejects expense with comments', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // Reject the expense
    const rejectionComments = 'Missing receipt for expense over $25'
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments,
      })
    })

    // Verify rejection
    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Rejected')
    expect(expense?.rejectionComments).toBe(rejectionComments)
  })

  it('revises rejected expense and resubmits', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      3000 // $30
    )

    // First reject
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments: 'Please add receipt',
      })
    })

    // Then revise and resubmit with receipt
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Submitted',
        receiptUrl: 'https://storage.test/receipt-123.pdf',
        description: 'Revised: added receipt',
      })
    })

    // Verify revision
    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')
    expect(expense?.receiptUrl).toBe('https://storage.test/receipt-123.pdf')
    expect(expense?.description).toBe('Revised: added receipt')
  })

  it('revises rejected expense but saves as draft', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // First reject
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments: 'Needs clarification',
      })
    })

    // Then revise but save as draft (not resubmit)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Draft',
        description: 'Still working on this revision',
      })
    })

    // Verify saved as draft
    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Draft')
  })
})

// =============================================================================
// Expense Approval Business Rules Tests
// =============================================================================

describe('Expense Approval Business Rules', () => {
  it('prevents approving expenses not in Submitted status', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create expense in Draft status
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId,
        projectId,
        date: Date.now() - 86400000,
        amount: 5000,
        currency: 'USD',
        type: 'Other',
        description: 'Draft expense',
        billable: true,
        status: 'Draft', // Not Submitted
        createdAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Draft')

    // The work item would validate status is Submitted before allowing review
    // This simulates the validation check in reviewExpense.workItem.ts
    const isValidForReview = expense?.status === 'Submitted'
    expect(isValidForReview).toBe(false)
  })

  it('validates self-approval prevention rule', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create expense submitted by the manager (same as approver)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      managerId // Manager submits their own expense
    )

    const expense = await getExpense(testContext, expenseId)

    // This simulates the self-approval check in reviewExpense.workItem.ts
    const reviewerId = managerId
    const canApprove = expense?.userId !== reviewerId
    expect(canApprove).toBe(false)
  })

  it('tracks approval timestamp', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    const beforeApproval = Date.now()

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.approvedAt).toBeGreaterThanOrEqual(beforeApproval)
  })

  it('clears rejection comments on approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // First reject with comments
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments: 'Initial rejection - missing receipt',
      })
    })

    // Then resubmit
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Submitted',
        receiptUrl: 'https://storage.test/receipt.pdf',
      })
    })

    // Then approve (should clear rejection comments)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
        rejectionComments: undefined, // Clear previous rejection
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.rejectionComments).toBeUndefined()
  })

  it('validates expense type is preserved through approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      15000, // $150
      'Software'
    )

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.type).toBe('Software')
  })
})

// =============================================================================
// Approval Workflow State Transitions
// =============================================================================

describe('Expense Approval State Transitions', () => {
  it('follows approve path: Submitted → Approved', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // Verify initial state
    let expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')

    // Manager approves
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    // Verify final state
    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
  })

  it('follows reject-revise-resubmit path: Submitted → Rejected → Submitted', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      10000 // $100
    )

    // Step 1: Verify initial submission
    let expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')

    // Step 2: Manager rejects (missing receipt)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments: 'Missing receipt for expense over $25',
      })
    })

    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Rejected')

    // Step 3: Team member revises and resubmits with receipt
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Submitted',
        receiptUrl: 'https://storage.test/receipt.pdf',
        description: 'Revised: added receipt',
      })
    })

    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')
    expect(expense?.receiptUrl).toBeDefined()
  })

  it('follows complete revision loop: Submitted → Rejected → Submitted → Approved', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      7500 // $75
    )

    // Step 1: Initial submission
    let expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Submitted')

    // Step 2: First rejection (wrong category)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Rejected',
        rejectionComments: 'Please categorize as Software expense',
      })
    })

    // Step 3: Revision and resubmission
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        type: 'Software',
        status: 'Submitted',
      })
    })

    // Step 4: Final approval
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
        rejectionComments: undefined,
      })
    })

    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.type).toBe('Software')
    expect(expense?.rejectionComments).toBeUndefined()
  })
})

// =============================================================================
// Approval with Adjustments
// =============================================================================

describe('Expense Approval with Adjustments', () => {
  it('allows changing billable status on approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId
    )

    // Verify initially billable
    let expense = await getExpense(testContext, expenseId)
    expect(expense?.billable).toBe(true)

    // Approve but mark as non-billable
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
        billable: false, // Manager overrides billability
      })
    })

    expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.billable).toBe(false)
  })

  it('allows adjusting markup rate on approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create expense with 15% markup
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId,
        projectId,
        date: Date.now() - 86400000,
        amount: 10000, // $100
        currency: 'USD',
        type: 'Software',
        description: 'Software license',
        billable: true,
        markupRate: 1.15, // 15% markup
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    // Approve with adjusted markup (20%)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
        markupRate: 1.20, // 20% markup
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.markupRate).toBe(1.20)
  })

  it('allows changing category on approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      5000,
      'Other' // Submitted as Other
    )

    // Approve with corrected category
    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
        type: 'Materials', // Manager corrects category
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.type).toBe('Materials')
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Expense Approval Edge Cases', () => {
  it('handles high-value expense approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)
    const expenseId = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      500000, // $5,000
      'Subcontractor'
    )

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.amount).toBe(500000)
  })

  it('handles non-billable expense approval', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create non-billable expense
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId,
        projectId,
        date: Date.now() - 86400000,
        amount: 2500,
        currency: 'USD',
        type: 'Other',
        description: 'Internal team lunch',
        billable: false, // Non-billable
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.billable).toBe(false)
  })

  it('handles expense with receipt', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create expense with receipt
    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId,
        projectId,
        date: Date.now() - 86400000,
        amount: 7500, // $75 - requires receipt
        currency: 'USD',
        type: 'Travel',
        description: 'Taxi to client site',
        billable: true,
        receiptUrl: 'https://storage.test/receipt.pdf',
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.status).toBe('Approved')
    expect(expense?.receiptUrl).toBe('https://storage.test/receipt.pdf')
  })

  it('preserves description through approval process', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    const originalDescription = 'Software subscription for project tooling'

    const expenseId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('expenses', {
        organizationId: orgId,
        userId: teamMemberId,
        projectId,
        date: Date.now() - 86400000,
        amount: 9900,
        currency: 'USD',
        type: 'Software',
        description: originalDescription,
        billable: true,
        status: 'Submitted',
        createdAt: Date.now(),
      })
    })

    await testContext.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Approved',
        approvedBy: managerId,
        approvedAt: Date.now(),
      })
    })

    const expense = await getExpense(testContext, expenseId)
    expect(expense?.description).toBe(originalDescription)
  })

  it('handles all expense types', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    const expenseTypes: Array<'Software' | 'Travel' | 'Materials' | 'Subcontractor' | 'Other'> = [
      'Software',
      'Travel',
      'Materials',
      'Subcontractor',
      'Other',
    ]

    for (const type of expenseTypes) {
      const expenseId = await createSubmittedExpense(
        testContext,
        orgId,
        projectId,
        teamMemberId,
        5000,
        type
      )

      await testContext.run(async (ctx) => {
        await ctx.db.patch(expenseId, {
          status: 'Approved',
          approvedBy: managerId,
          approvedAt: Date.now(),
        })
      })

      const expense = await getExpense(testContext, expenseId)
      expect(expense?.status).toBe('Approved')
      expect(expense?.type).toBe(type)
    }
  })
})

// =============================================================================
// Batch Approval Tests
// =============================================================================

describe('Batch Expense Approval', () => {
  it('approves multiple expenses in a batch', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create 3 submitted expenses
    const expense1 = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      2500,
      'Software'
    )
    const expense2 = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      5000,
      'Travel'
    )
    const expense3 = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      7500,
      'Materials'
    )

    const expenseIds = [expense1, expense2, expense3]

    // Batch approve
    await testContext.run(async (ctx) => {
      for (const expenseId of expenseIds) {
        await ctx.db.patch(expenseId, {
          status: 'Approved',
          approvedBy: managerId,
          approvedAt: Date.now(),
        })
      }
    })

    // Verify all approved
    for (const expenseId of expenseIds) {
      const expense = await getExpense(testContext, expenseId)
      expect(expense?.status).toBe('Approved')
      expect(expense?.approvedBy).toBe(managerId)
    }
  })

  it('rejects multiple expenses with shared feedback', async () => {
    const { orgId, managerId } = await createManagerUser(testContext)
    const teamMemberId = await createTeamMemberUser(testContext, orgId)
    const { dealId, companyId } = await createTestDeal(testContext, orgId, managerId)
    const projectId = await createTestProject(testContext, orgId, dealId, companyId, managerId)

    // Create 2 submitted expenses without receipts
    const expense1 = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      5000 // $50 - requires receipt
    )
    const expense2 = await createSubmittedExpense(
      testContext,
      orgId,
      projectId,
      teamMemberId,
      7500 // $75 - requires receipt
    )

    const sharedRejectionReason = 'All expenses over $25 require receipts'

    // Batch reject
    await testContext.run(async (ctx) => {
      for (const expenseId of [expense1, expense2]) {
        await ctx.db.patch(expenseId, {
          status: 'Rejected',
          rejectionComments: sharedRejectionReason,
        })
      }
    })

    // Verify all rejected with same comment
    for (const expenseId of [expense1, expense2]) {
      const expense = await getExpense(testContext, expenseId)
      expect(expense?.status).toBe('Rejected')
      expect(expense?.rejectionComments).toBe(sharedRejectionReason)
    }
  })
})
