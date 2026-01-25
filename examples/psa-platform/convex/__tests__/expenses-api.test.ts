/// <reference types="vite/client" />
/**
 * Expenses API Tests
 *
 * Tests for expense CRUD operations, submission, and approval workflows
 * via the API layer.
 *
 * Key test scenarios:
 * - Listing expenses with filtering (project, user, status, type)
 * - Getting expense by ID
 * - Getting project expense summary
 * - Creating expenses with all types (Software, Travel, Materials, Subcontractor, Other)
 * - Updating expenses (only Draft status allowed)
 * - Submitting expenses for approval
 * - Approving expenses with optional adjustments
 * - Rejecting expenses with reason/issues
 * - Authorization checks
 * - Cross-organization isolation
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for expense tests
const STAFF_SCOPES = ['dealToDelivery:staff']

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates test data (company, project) required for expense creation
 */
async function setupExpensePrerequisites(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>
) {
  const companyId = await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })

  const projectId = await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'Test Project',
      status: 'Active',
      startDate: Date.now(),
      endDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
      managerId: userId,
      createdAt: Date.now(),
    })
  })

  return { companyId, projectId }
}

/**
 * Creates an expense directly in the database (for testing queries)
 */
async function createExpenseDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  overrides: Partial<{
    type: Doc<'expenses'>['type']
    amount: number
    currency: string
    billable: boolean
    markupRate: number
    receiptUrl: string
    status: Doc<'expenses'>['status']
    date: number
    description: string
    approvedBy: Id<'users'>
    approvedAt: number
    rejectionComments: string
    invoiceId: Id<'invoices'>
    vendorInfo: { name: string; taxId?: string }
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('expenses', {
      organizationId: orgId,
      projectId,
      userId,
      type: overrides.type ?? 'Other',
      amount: overrides.amount ?? 5000, // $50.00
      currency: overrides.currency ?? 'USD',
      billable: overrides.billable ?? true,
      markupRate: overrides.markupRate,
      receiptUrl: overrides.receiptUrl,
      status: overrides.status ?? 'Draft',
      date: overrides.date ?? Date.now(),
      description: overrides.description ?? 'Test expense',
      approvedBy: overrides.approvedBy,
      approvedAt: overrides.approvedAt,
      rejectionComments: overrides.rejectionComments,
      invoiceId: overrides.invoiceId,
      vendorInfo: overrides.vendorInfo,
      createdAt: Date.now(),
    })
  })
}

// =============================================================================
// listExpenses Tests
// =============================================================================

describe('listExpenses', () => {
  it('returns expenses for organization (defaults to current user)', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create expenses for the current user
    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Expense 1',
      amount: 1000,
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Expense 2',
      amount: 2000,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {})

    expect(result.length).toBe(2)
    expect(result.some((e) => e.description === 'Expense 1')).toBe(true)
    expect(result.some((e) => e.description === 'Expense 2')).toBe(true)
  })

  it('filters by projectId', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId, companyId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create another project
    const project2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('projects', {
        organizationId: orgId,
        companyId,
        name: 'Project 2',
        status: 'Active',
        startDate: Date.now(),
        managerId: userId,
        createdAt: Date.now(),
      })
    })

    await createExpenseDirectly(t, orgId, projectId, userId, { description: 'Project 1 expense' })
    await createExpenseDirectly(t, orgId, project2Id, userId, { description: 'Project 2 expense' })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {
      projectId,
    })

    expect(result.length).toBe(1)
    expect(result[0].description).toBe('Project 1 expense')
  })

  it('filters by userId', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create another user
    const user2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        organizationId: orgId,
        email: 'user2@example.com',
        name: 'User 2',
        role: 'staff',
        costRate: 10000,
        billRate: 15000,
        skills: [],
        department: 'Engineering',
        location: 'Remote',
        isActive: true,
      })
    })

    await createExpenseDirectly(t, orgId, projectId, userId, { description: 'User 1 expense' })
    await createExpenseDirectly(t, orgId, projectId, user2Id, { description: 'User 2 expense' })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {
      userId,
    })

    expect(result.length).toBe(1)
    expect(result[0].description).toBe('User 1 expense')
  })

  it('filters by status', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Draft expense',
      status: 'Draft',
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Submitted expense',
      status: 'Submitted',
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Approved expense',
      status: 'Approved',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {
      status: 'Submitted',
    })

    expect(result.length).toBe(1)
    expect(result[0].description).toBe('Submitted expense')
  })

  it('filters by type', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Travel expense',
      type: 'Travel',
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Software expense',
      type: 'Software',
    })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {
      type: 'Travel',
    })

    expect(result.length).toBe(1)
    expect(result[0].description).toBe('Travel expense')
  })

  it('returns empty array when no expenses match', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {})

    expect(result).toEqual([])
  })
})

// =============================================================================
// getExpense Tests
// =============================================================================

describe('getExpense', () => {
  it('returns expense by ID', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Test expense',
      amount: 12500,
      type: 'Travel',
      billable: true,
      markupRate: 1.1,
    })

    const result = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })

    expect(result).not.toBeNull()
    expect(result?.description).toBe('Test expense')
    expect(result?.amount).toBe(12500)
    expect(result?.type).toBe('Travel')
    expect(result?.billable).toBe(true)
    expect(result?.markupRate).toBe(1.1)
  })

  it('returns null for non-existent expense (deleted)', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create an expense, then delete it to get a valid but non-existent ID
    const tempId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'temp expense',
    })

    // Delete the expense
    await t.run(async (ctx) => {
      await ctx.db.delete(tempId)
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId: tempId,
    })

    expect(expense).toBeNull()
  })
})

// =============================================================================
// getProjectExpenseSummary Tests
// =============================================================================

describe('getProjectExpenseSummary', () => {
  it('returns expense totals for project', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create expenses with different statuses and billability
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 10000, // $100
      billable: true,
      status: 'Approved',
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 5000, // $50
      billable: false,
      status: 'Approved',
    })
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 3000, // $30
      billable: true,
      status: 'Draft',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.expenses.getProjectExpenseSummary,
      { projectId }
    )

    expect(result.total).toBe(18000) // $180 total
    expect(result.billable).toBe(13000) // $100 + $30 billable
    expect(result.approved).toBe(15000) // $100 + $50 approved
  })

  it('applies markup rate to billable amount', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create billable expense with 10% markup
    await createExpenseDirectly(t, orgId, projectId, userId, {
      amount: 10000, // $100
      billable: true,
      markupRate: 1.1, // 10% markup
      status: 'Approved',
    })

    const result = await t.query(
      api.workflows.dealToDelivery.api.expenses.getProjectExpenseSummary,
      { projectId }
    )

    expect(result.total).toBe(10000) // Raw total
    expect(result.billable).toBe(11000) // $100 * 1.1 = $110 billable
    expect(result.approved).toBe(10000)
  })

  it('returns zeros for project with no expenses', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const result = await t.query(
      api.workflows.dealToDelivery.api.expenses.getProjectExpenseSummary,
      { projectId }
    )

    expect(result.total).toBe(0)
    expect(result.billable).toBe(0)
    expect(result.approved).toBe(0)
  })
})

// =============================================================================
// createExpense Tests
// =============================================================================

describe('createExpense', () => {
  it('creates expense in Draft status', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
      projectId,
      type: 'Travel',
      amount: 15000,
      currency: 'USD',
      description: 'Flight to client site',
      date: Date.now(),
      billable: true,
    })

    expect(expenseId).toBeDefined()

    // Verify the created expense
    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.status).toBe('Draft')
    expect(expense?.type).toBe('Travel')
    expect(expense?.amount).toBe(15000)
    expect(expense?.description).toBe('Flight to client site')
    expect(expense?.billable).toBe(true)
  })

  it('creates expense with optional fields (receiptUrl, markupRate, vendorInfo)', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
      projectId,
      type: 'Subcontractor',
      amount: 50000,
      currency: 'USD',
      description: 'Contract work',
      date: Date.now(),
      billable: true,
      receiptUrl: 'https://storage.example.com/receipt.pdf',
      markupRate: 1.15,
      vendorInfo: {
        name: 'Acme Contractors',
        taxId: '12-3456789',
      },
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.receiptUrl).toBe('https://storage.example.com/receipt.pdf')
    expect(expense?.markupRate).toBe(1.15)
    expect(expense?.vendorInfo).toEqual({
      name: 'Acme Contractors',
      taxId: '12-3456789',
    })
  })

  it('creates all expense types', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const types = ['Software', 'Travel', 'Materials', 'Subcontractor', 'Other'] as const

    for (const type of types) {
      const expenseId = await t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
        projectId,
        type,
        amount: 1000,
        currency: 'USD',
        description: `${type} expense`,
        date: Date.now(),
        billable: true,
      })

      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.type).toBe(type)
    }
  })

  it('creates non-billable expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
      projectId,
      type: 'Other',
      amount: 2500,
      currency: 'USD',
      description: 'Internal expense',
      date: Date.now(),
      billable: false,
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.billable).toBe(false)
  })
})

// =============================================================================
// updateExpense Tests
// =============================================================================

describe('updateExpense', () => {
  it('updates draft expense fields', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Original description',
      amount: 1000,
      type: 'Other',
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.updateExpense, {
      expenseId,
      description: 'Updated description',
      amount: 2000,
      type: 'Travel',
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.description).toBe('Updated description')
    expect(expense?.amount).toBe(2000)
    expect(expense?.type).toBe('Travel')
  })

  it('rejects update of Submitted expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.updateExpense, {
        expenseId,
        description: 'Should fail',
      })
    ).rejects.toThrow('Can only update expenses in Draft status')
  })

  it('rejects update of Approved expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Approved',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.updateExpense, {
        expenseId,
        description: 'Should fail',
      })
    ).rejects.toThrow('Can only update expenses in Draft status')
  })

  it('updates multiple fields at once', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Original',
      amount: 1000,
      billable: false,
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.updateExpense, {
      expenseId,
      description: 'Updated',
      amount: 5000,
      billable: true,
      markupRate: 1.2,
      currency: 'EUR',
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.description).toBe('Updated')
    expect(expense?.amount).toBe(5000)
    expect(expense?.billable).toBe(true)
    expect(expense?.markupRate).toBe(1.2)
    expect(expense?.currency).toBe('EUR')
  })
})

// =============================================================================
// submitExpense Tests
// =============================================================================

describe('submitExpense', () => {
  it('submits draft expense under receipt threshold', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Amount under $25 (2500 cents) - no receipt required
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Valid expense under threshold',
      amount: 2000, // $20 - below $25 receipt threshold
      status: 'Draft',
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.status).toBe('Submitted')
  })

  it('submits draft expense over threshold with receipt', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Amount over $25 (2500 cents) with receipt attached
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Valid expense with receipt',
      amount: 5000, // $50 - above $25 receipt threshold
      receiptUrl: 'https://storage.example.com/receipt-123.pdf',
      status: 'Draft',
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.status).toBe('Submitted')
  })

  it('rejects submission without receipt for expenses over $25', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Amount over $25 (2500 cents) WITHOUT receipt - should fail
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Expense over threshold without receipt',
      amount: 5000, // $50 - above $25 receipt threshold
      status: 'Draft',
      // No receiptUrl
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })
    ).rejects.toThrow('Receipt is required for expenses over $25')
  })

  it('rejects submission of non-Draft expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })
    ).rejects.toThrow('Can only submit expenses in Draft status')
  })

  it('rejects submission with empty description', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: '   ', // Whitespace only
      amount: 5000,
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })
    ).rejects.toThrow('Expense must have a description before submission')
  })

  it('rejects submission with zero or negative amount', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Valid description',
      amount: 0,
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })
    ).rejects.toThrow('Expense must have a positive amount before submission')
  })
})

// =============================================================================
// approveExpense Tests
// =============================================================================

describe('approveExpense', () => {
  it('approves submitted expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, {
      expenseId,
    })

    expect(result.success).toBe(true)

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.status).toBe('Approved')
    expect(expense?.approvedAt).toBeDefined()
  })

  it('approves with billable adjustment', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      billable: true,
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, {
      expenseId,
      finalBillable: false,
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.billable).toBe(false)
    expect(expense?.status).toBe('Approved')
  })

  it('approves with markup rate adjustment', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      markupRate: 1.0,
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, {
      expenseId,
      finalMarkup: 1.25,
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.markupRate).toBe(1.25)
    expect(expense?.status).toBe('Approved')
  })

  it('rejects approval of non-Submitted expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, { expenseId })
    ).rejects.toThrow('Can only approve expenses in Submitted status')
  })

  it('rejects approval of already approved expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Approved',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, { expenseId })
    ).rejects.toThrow('Can only approve expenses in Submitted status')
  })
})

// =============================================================================
// rejectExpense Tests
// =============================================================================

describe('rejectExpense', () => {
  it('rejects submitted expense with reason', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
      expenseId,
      rejectionReason: 'Missing receipt',
    })

    expect(result.success).toBe(true)

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.status).toBe('Rejected')
    expect(expense?.rejectionComments).toBe('Missing receipt')
    expect(expense?.rejectedAt).toBeDefined()
  })

  it('rejects with detailed issues', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
      expenseId,
      rejectionReason: 'Multiple issues found',
      issues: [
        { type: 'receipt', details: 'Receipt is illegible' },
        { type: 'amount', details: 'Amount does not match receipt total' },
      ],
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.rejectionIssues).toHaveLength(2)
    expect(expense?.rejectionIssues?.[0].type).toBe('receipt')
    expect(expense?.rejectionIssues?.[1].details).toBe('Amount does not match receipt total')
  })

  it('rejects rejection of non-Submitted expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Draft',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
        expenseId,
        rejectionReason: 'Should fail',
      })
    ).rejects.toThrow('Can only reject expenses in Submitted status')
  })

  it('rejects rejection of already rejected expense', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Rejected',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
        expenseId,
        rejectionReason: 'Should fail',
      })
    ).rejects.toThrow('Can only reject expenses in Submitted status')
  })
})

// =============================================================================
// Authorization Tests
// =============================================================================

describe('Authorization', () => {
  it('listExpenses requires staff scope', async () => {
    const t = setup()
    // User without staff scope
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {})
    ).rejects.toThrow()
  })

  it('getExpense requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId)

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    ).rejects.toThrow()
  })

  it('createExpense requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
        projectId,
        type: 'Other',
        amount: 1000,
        currency: 'USD',
        description: 'Test',
        date: Date.now(),
        billable: true,
      })
    ).rejects.toThrow()
  })

  it('approveExpense requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, { expenseId })
    ).rejects.toThrow()
  })

  it('rejectExpense requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
        expenseId,
        rejectionReason: 'Test',
      })
    ).rejects.toThrow()
  })
})

// =============================================================================
// Cross-Organization Isolation Tests
// =============================================================================

describe('Cross-Organization Isolation', () => {
  it('does not return expenses from other organizations', async () => {
    const t = setup()

    // Create first org and user with expenses
    const { userId: user1Id, organizationId: org1Id } = await setupUserWithRole(
      t,
      'staff1',
      STAFF_SCOPES
    )
    const { projectId: project1Id } = await setupExpensePrerequisites(t, org1Id, user1Id)
    await createExpenseDirectly(t, org1Id, project1Id, user1Id, {
      description: 'Org 1 expense',
    })

    // Create second org
    const org2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('organizations', {
        name: 'Org 2',
        settings: {},
        createdAt: Date.now(),
      })
    })
    const user2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        organizationId: org2Id,
        email: 'user2@org2.com',
        name: 'User 2',
        role: 'staff',
        costRate: 10000,
        billRate: 15000,
        skills: [],
        department: 'Engineering',
        location: 'Remote',
        isActive: true,
      })
    })
    const { projectId: project2Id } = await setupExpensePrerequisites(t, org2Id, user2Id)
    await createExpenseDirectly(t, org2Id, project2Id, user2Id, {
      description: 'Org 2 expense',
    })

    // Query as first user should only see their org's expenses
    const result = await t.query(api.workflows.dealToDelivery.api.expenses.listExpenses, {
      projectId: project1Id,
    })

    expect(result.length).toBe(1)
    expect(result[0].description).toBe('Org 1 expense')
    expect(result.some((e) => e.description === 'Org 2 expense')).toBe(false)
  })
})

// =============================================================================
// Expense Lifecycle Tests
// =============================================================================

describe('Expense Lifecycle', () => {
  it('Draft → Submitted → Approved flow', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create expense with receipt (required for amounts > $25)
    const expenseId = await t.mutation(api.workflows.dealToDelivery.api.expenses.createExpense, {
      projectId,
      type: 'Travel',
      amount: 10000,
      currency: 'USD',
      description: 'Business trip',
      date: Date.now(),
      billable: true,
      receiptUrl: 'https://storage.example.com/receipt-lifecycle.pdf',
    })

    let expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    expect(expense?.status).toBe('Draft')

    // Submit
    await t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })

    expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    expect(expense?.status).toBe('Submitted')

    // Approve
    await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpense, { expenseId })

    expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    expect(expense?.status).toBe('Approved')
  })

  it('Draft → Submitted → Rejected → Resubmit flow', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create and submit
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      description: 'Needs correction',
      amount: 10000,
      status: 'Submitted',
    })

    // Reject
    await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpense, {
      expenseId,
      rejectionReason: 'Missing receipt',
    })

    let expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    expect(expense?.status).toBe('Rejected')

    // Fix and resubmit (update to Draft first, then submit)
    await t.run(async (ctx) => {
      await ctx.db.patch(expenseId, {
        status: 'Draft',
        receiptUrl: 'https://storage.example.com/receipt.pdf',
        rejectionComments: undefined,
      })
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.submitExpense, { expenseId })

    expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, { expenseId })
    expect(expense?.status).toBe('Submitted')
    expect(expense?.receiptUrl).toBe('https://storage.example.com/receipt.pdf')
  })
})

// =============================================================================
// Bulk Expense Approval Tests (approveExpenses, rejectExpenses)
// =============================================================================

describe('approveExpenses (bulk)', () => {
  it('approves multiple expenses in batch', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create 3 submitted expenses
    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 1',
      amount: 1000,
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 2',
      amount: 2000,
    })
    const expense3 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 3',
      amount: 3000,
    })

    // Bulk approve
    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
      expenseIds: [expense1, expense2, expense3],
    })

    expect(result.success).toBe(true)
    expect(result.approvedCount).toBe(3)

    // Verify all approved
    for (const expenseId of [expense1, expense2, expense3]) {
      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.status).toBe('Approved')
      expect(expense?.approvedBy).toBe(userId)
      expect(expense?.approvedAt).toBeDefined()
    }
  })

  it('applies billable adjustment to all expenses', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      billable: true,
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      billable: true,
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
      expenseIds: [expense1, expense2],
      finalBillable: false,
    })

    for (const expenseId of [expense1, expense2]) {
      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.billable).toBe(false)
      expect(expense?.status).toBe('Approved')
    }
  })

  it('applies markup rate adjustment to all expenses', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      markupRate: 1.0,
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      markupRate: 1.0,
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
      expenseIds: [expense1, expense2],
      finalMarkup: 1.3,
    })

    for (const expenseId of [expense1, expense2]) {
      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.markupRate).toBe(1.3)
      expect(expense?.status).toBe('Approved')
    }
  })

  it('fails if any expense is not in Submitted status', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Draft', // Not submitted
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
        expenseIds: [expense1, expense2],
      })
    ).rejects.toThrow('Cannot approve expense with status "Draft"')
  })

  it('returns 0 approvedCount for empty array', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
      expenseIds: [],
    })

    expect(result.success).toBe(true)
    expect(result.approvedCount).toBe(0)
  })

  it('requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.approveExpenses, {
        expenseIds: [expenseId],
      })
    ).rejects.toThrow()
  })
})

describe('rejectExpenses (bulk)', () => {
  it('rejects multiple expenses with shared reason', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    // Create 3 submitted expenses
    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 1',
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 2',
    })
    const expense3 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
      description: 'Expense 3',
    })

    const rejectionReason = 'Missing receipts for all expenses'

    // Bulk reject
    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
      expenseIds: [expense1, expense2, expense3],
      rejectionReason,
    })

    expect(result.success).toBe(true)
    expect(result.rejectedCount).toBe(3)

    // Verify all rejected with same reason
    for (const expenseId of [expense1, expense2, expense3]) {
      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.status).toBe('Rejected')
      expect(expense?.rejectionComments).toBe(rejectionReason)
      expect(expense?.rejectedAt).toBeDefined()
    }
  })

  it('includes issues with rejection', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    const issues = [
      { type: 'receipt', details: 'Receipt missing' },
      { type: 'description', details: 'Description too vague' },
    ]

    await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
      expenseIds: [expense1, expense2],
      rejectionReason: 'Multiple issues found',
      issues,
    })

    for (const expenseId of [expense1, expense2]) {
      const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
        expenseId,
      })
      expect(expense?.status).toBe('Rejected')
      expect(expense?.rejectionIssues).toEqual(issues)
    }
  })

  it('fails if any expense is not in Submitted status', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expense1 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })
    const expense2 = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Approved', // Already approved
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
        expenseIds: [expense1, expense2],
        rejectionReason: 'Test rejection',
      })
    ).rejects.toThrow('Cannot reject expense with status "Approved"')
  })

  it('requires rejection reason', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
        expenseIds: [expenseId],
        rejectionReason: '', // Empty reason
      })
    ).rejects.toThrow('Rejection reason is required')
  })

  it('trims whitespace from rejection reason', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)

    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
      expenseIds: [expenseId],
      rejectionReason: '  Missing receipt  ',
    })

    const expense = await t.query(api.workflows.dealToDelivery.api.expenses.getExpense, {
      expenseId,
    })
    expect(expense?.rejectionComments).toBe('Missing receipt')
  })

  it('returns 0 rejectedCount for empty array', async () => {
    const t = setup()
    await setupUserWithRole(t, 'staff', STAFF_SCOPES)

    const result = await t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
      expenseIds: [],
      rejectionReason: 'Test rejection',
    })

    expect(result.success).toBe(true)
    expect(result.rejectedCount).toBe(0)
  })

  it('requires staff scope', async () => {
    const t = setup()
    const { userId, organizationId: orgId } = await setupUserWithRole(t, 'staff', STAFF_SCOPES)
    const { projectId } = await setupExpensePrerequisites(t, orgId, userId)
    const expenseId = await createExpenseDirectly(t, orgId, projectId, userId, {
      status: 'Submitted',
    })

    // Reset user to have no scopes
    vi.restoreAllMocks()
    await setupUserWithRole(t, 'guest', [])

    await expect(
      t.mutation(api.workflows.dealToDelivery.api.expenses.rejectExpenses, {
        expenseIds: [expenseId],
        rejectionReason: 'Test rejection',
      })
    ).rejects.toThrow()
  })
})
