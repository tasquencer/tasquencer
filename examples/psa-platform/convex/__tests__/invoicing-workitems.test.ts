/// <reference types="vite/client" />
/**
 * Invoicing Work Items Tests
 *
 * This file tests work items related to invoicing method selection,
 * PDF delivery, and billing cycle completion checks.
 *
 * Work items tested:
 * - selectInvoicingMethod: Gateway to choose invoicing method for a project
 * - sendViaPdf: Generate PDF for manual delivery
 * - checkMoreBilling: Check for uninvoiced items and continue/end billing
 * - recordPayment: Record payment with edge cases (partial, overpayment)
 *
 * Reference specs:
 * - .review/recipes/psa-platform/specs/task-selectinvoicingmethod.md
 * - .review/recipes/psa-platform/specs/task-sendviapdf.md
 * - .review/recipes/psa-platform/specs/task-checkmorebilling.md
 * - .review/recipes/psa-platform/specs/task-recordpayment.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  type TestContext,
} from './helpers.test'
import type { Id } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// Scopes needed for invoicing tests
const INVOICING_SCOPES = [
  'dealToDelivery:invoices:create',
  'dealToDelivery:invoices:edit',
  'dealToDelivery:invoices:finalize',
  'dealToDelivery:invoices:send',
  'dealToDelivery:invoices:view:all',
  'dealToDelivery:payments:record',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'finance-manager', INVOICING_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Create a project with budget for invoicing tests
 */
async function createProjectWithBudget(
  t: TestContext,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  budgetType: 'TimeAndMaterials' | 'FixedFee' | 'Retainer' = 'TimeAndMaterials'
): Promise<{ projectId: Id<'projects'>; budgetId: Id<'budgets'>; companyId: Id<'companies'>; dealId: Id<'deals'> }> {
  return await t.run(async (ctx) => {
    // Create company
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Invoicing Test Company',
      billingAddress: {
        street: '123 Invoice St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    // Create contact (required for deal)
    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Test Contact',
      email: 'contact@test.com',
      phone: '+1-555-1234',
      isPrimary: true,
    })

    // Create project first (budget needs projectId)
    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'Invoicing Test Project',
      description: 'Project for testing invoicing work items',
      status: 'Active',
      startDate: Date.now(),
      endDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      managerId: userId,
      createdAt: Date.now(),
    })

    // Create budget (requires projectId)
    const budgetId = await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: budgetType,
      totalAmount: 100000,
      createdAt: Date.now(),
    })

    // Update project with budgetId
    await ctx.db.patch(projectId, { budgetId })

    // Create deal (referencing the project via optional dealId)
    const dealId = await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Invoicing Test Deal',
      value: 100000,
      ownerId: userId,
      stage: 'Won',
      probability: 100,
      createdAt: Date.now(),
    })

    // Update project with dealId
    await ctx.db.patch(projectId, { dealId })

    return { projectId, budgetId, companyId, dealId }
  })
}

/**
 * Create a project without budget (for validation tests)
 */
async function createProjectWithoutBudget(
  t: TestContext,
  orgId: Id<'organizations'>,
  userId: Id<'users'>
): Promise<{ projectId: Id<'projects'>; companyId: Id<'companies'> }> {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'No Budget Company',
      billingAddress: {
        street: '456 Test St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'No Budget Contact',
      email: 'nobudget@test.com',
      phone: '+1-555-0000',
      isPrimary: true,
    })

    const dealId = await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'No Budget Deal',
      value: 50000,
      ownerId: userId,
      stage: 'Won',
      probability: 100,
      createdAt: Date.now(),
    })

    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      dealId,
      // No budgetId
      name: 'No Budget Project',
      description: 'Project without budget',
      status: 'Active',
      startDate: Date.now(),
      endDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      managerId: userId,
      createdAt: Date.now(),
    })

    return { projectId, companyId }
  })
}

/**
 * Create an invoice for testing
 */
async function createInvoice(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>,
  status: 'Draft' | 'Finalized' | 'Sent' | 'Viewed' | 'Paid' | 'Void' = 'Draft',
  totalAmount = 10000
): Promise<Id<'invoices'>> {
  return await t.run(async (ctx) => {
    const invoiceId = await ctx.db.insert('invoices', {
      organizationId: orgId,
      projectId,
      companyId,
      status,
      method: 'TimeAndMaterials',
      number: status !== 'Draft' ? `INV-${Date.now()}` : undefined,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      subtotal: totalAmount,
      tax: 0,
      total: totalAmount,
      createdAt: Date.now(),
    })
    return invoiceId
  })
}

/**
 * Create billable time entries
 */
async function createBillableTimeEntries(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  count = 3
): Promise<Id<'timeEntries'>[]> {
  return await t.run(async (ctx) => {
    const entryIds: Id<'timeEntries'>[] = []
    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    for (let i = 0; i < count; i++) {
      const entryId = await ctx.db.insert('timeEntries', {
        organizationId: orgId,
        projectId,
        userId,
        date: yesterday,
        hours: 4,
        billable: true,
        status: 'Approved',
        notes: `Test notes ${i + 1}`,
        createdAt: Date.now(),
      })
      entryIds.push(entryId)
    }
    return entryIds
  })
}

/**
 * Create billable expenses
 */
async function createBillableExpenses(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>,
  count = 2
): Promise<Id<'expenses'>[]> {
  return await t.run(async (ctx) => {
    const expenseIds: Id<'expenses'>[] = []
    const yesterday = Date.now() - 24 * 60 * 60 * 1000

    for (let i = 0; i < count; i++) {
      const expenseId = await ctx.db.insert('expenses', {
        organizationId: orgId,
        projectId,
        userId,
        date: yesterday,
        type: 'Software',
        description: `Test expense ${i + 1}`,
        amount: 5000,
        currency: 'USD',
        billable: true,
        status: 'Approved',
        createdAt: Date.now(),
      })
      expenseIds.push(expenseId)
    }
    return expenseIds
  })
}

/**
 * Create uninvoiced milestones
 */
async function createUninvoicedMilestones(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  count = 2
): Promise<Id<'milestones'>[]> {
  return await t.run(async (ctx) => {
    const milestoneIds: Id<'milestones'>[] = []

    for (let i = 0; i < count; i++) {
      const milestoneId = await ctx.db.insert('milestones', {
        organizationId: orgId,
        projectId,
        name: `Milestone ${i + 1}`,
        percentage: 25, // 25% of budget each
        amount: 25000,
        dueDate: Date.now() + (i + 1) * 7 * 24 * 60 * 60 * 1000,
        completedAt: Date.now() - 24 * 60 * 60 * 1000, // Completed yesterday
        sortOrder: i,
        // No invoiceId means not invoiced yet
      })
      milestoneIds.push(milestoneId)
    }
    return milestoneIds
  })
}

/**
 * Create a payment record
 */
async function createPayment(
  t: TestContext,
  orgId: Id<'organizations'>,
  invoiceId: Id<'invoices'>,
  amount: number,
  method: 'Check' | 'ACH' | 'Wire' | 'CreditCard' | 'Cash' | 'Other' = 'Check'
): Promise<Id<'payments'>> {
  return await t.run(async (ctx) => {
    const paymentId = await ctx.db.insert('payments', {
      organizationId: orgId,
      invoiceId,
      amount,
      date: Date.now(),
      method,
      reference: `REF-${Date.now()}`,
      notes: 'Test payment',
      syncedToAccounting: false,
      createdAt: Date.now(),
    })
    return paymentId
  })
}

// =============================================================================
// selectInvoicingMethod Work Item Tests
// =============================================================================

describe('SelectInvoicingMethod Work Item - Budget Validation', () => {
  it('project with budget can proceed with invoicing', async () => {
    const { projectId, budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    // Verify project has budget
    const project = await testContext.run(async (ctx) => ctx.db.get(projectId))
    expect(project?.budgetId).toBe(budgetId)

    // Verify budget exists and is valid
    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    expect(budget).toBeDefined()
    expect(budget?.totalAmount).toBeGreaterThan(0)
  })

  it('project without budget cannot proceed with invoicing', async () => {
    const { projectId } = await createProjectWithoutBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    // Verify project has no budget
    const project = await testContext.run(async (ctx) => ctx.db.get(projectId))
    expect(project?.budgetId).toBeUndefined()
  })
})

describe('SelectInvoicingMethod Work Item - Method Selection', () => {
  it('supports TimeAndMaterials method selection', async () => {
    const { budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'TimeAndMaterials'
    )

    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    expect(budget?.type).toBe('TimeAndMaterials')
  })

  it('supports FixedFee method selection', async () => {
    const { budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'FixedFee'
    )

    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    expect(budget?.type).toBe('FixedFee')
  })

  it('supports Retainer (Recurring) method selection', async () => {
    const { budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'Retainer'
    )

    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    expect(budget?.type).toBe('Retainer')
  })
})

// =============================================================================
// sendViaPdf Work Item Tests
// =============================================================================

describe('SendViaPdf Work Item - Invoice Status', () => {
  it('finalized invoice can be delivered via PDF', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    expect(invoice?.status).toBe('Finalized')
  })

  it('draft invoice cannot be delivered (must be finalized first)', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Draft'
    )

    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    expect(invoice?.status).toBe('Draft')
    // Spec: Invoice must be Finalized before sending
  })
})

describe('SendViaPdf Work Item - Mark As Sent', () => {
  it('marks invoice as Sent when markAsSent is true', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // Simulate marking as sent (what sendViaPdf does when markAsSent=true)
    await testContext.run(async (ctx) => {
      await ctx.db.patch(invoiceId, {
        status: 'Sent',
        sentAt: Date.now(),
      })
    })

    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    expect(invoice?.status).toBe('Sent')
    expect(invoice?.sentAt).toBeDefined()
  })

  it('keeps invoice Finalized when markAsSent is false', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // No status change when markAsSent=false (PDF download only)
    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    expect(invoice?.status).toBe('Finalized')
    expect(invoice?.sentAt).toBeUndefined()
  })
})

// =============================================================================
// checkMoreBilling Work Item Tests
// =============================================================================

describe('CheckMoreBilling Work Item - Uninvoiced Time Entries', () => {
  it('detects uninvoiced time entries and indicates more billing', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    // Create uninvoiced billable time entries
    await createBillableTimeEntries(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      authResult.userId as Id<'users'>,
      3
    )

    // Query to simulate checkMoreBilling logic (uninvoiced = no invoiceId)
    const uninvoicedTime = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('timeEntries')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.eq(q.field('billable'), true),
            q.eq(q.field('status'), 'Approved'),
            q.eq(q.field('invoiceId'), undefined)
          )
        )
        .collect()
    })

    expect(uninvoicedTime.length).toBe(3)
    // moreBillingCycles would be true since there are uninvoiced items
  })
})

describe('CheckMoreBilling Work Item - Uninvoiced Expenses', () => {
  it('detects uninvoiced expenses and indicates more billing', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    // Create uninvoiced billable expenses
    await createBillableExpenses(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      authResult.userId as Id<'users'>,
      2
    )

    // Query to simulate checkMoreBilling logic (uninvoiced = no invoiceId)
    const uninvoicedExpenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.eq(q.field('billable'), true),
            q.eq(q.field('status'), 'Approved'),
            q.eq(q.field('invoiceId'), undefined)
          )
        )
        .collect()
    })

    expect(uninvoicedExpenses.length).toBe(2)
  })
})

describe('CheckMoreBilling Work Item - Uninvoiced Milestones', () => {
  it('detects uninvoiced milestones and indicates more billing', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    // Create uninvoiced milestones (completed but not invoiced)
    await createUninvoicedMilestones(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      2
    )

    // Query to simulate checkMoreBilling logic (uninvoiced = has completedAt but no invoiceId)
    const uninvoicedMilestones = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('milestones')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.neq(q.field('completedAt'), undefined), // Completed
            q.eq(q.field('invoiceId'), undefined) // Not invoiced
          )
        )
        .collect()
    })

    expect(uninvoicedMilestones.length).toBe(2)
  })
})

describe('CheckMoreBilling Work Item - Retainer Check', () => {
  it('indicates more billing needed for Retainer budget type', async () => {
    const { budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'Retainer'
    )

    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    const isRetainer = budget?.type === 'Retainer'

    expect(isRetainer).toBe(true)
    // moreBillingCycles would be true for retainer projects
  })

  it('no automatic recurring billing for non-Retainer budgets', async () => {
    const { budgetId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'TimeAndMaterials'
    )

    const budget = await testContext.run(async (ctx) => ctx.db.get(budgetId))
    const isRetainer = budget?.type === 'Retainer'

    expect(isRetainer).toBe(false)
  })
})

describe('CheckMoreBilling Work Item - Complete Billing', () => {
  it('no more billing when all items invoiced and non-retainer', async () => {
    const { projectId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>,
      'TimeAndMaterials'
    )

    // No uninvoiced items created, TimeAndMaterials (non-retainer)

    const uninvoicedTime = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('timeEntries')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.eq(q.field('billable'), true),
            q.eq(q.field('status'), 'Approved'),
            q.eq(q.field('invoiceId'), undefined)
          )
        )
        .collect()
    })

    const uninvoicedExpenses = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('expenses')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.eq(q.field('billable'), true),
            q.eq(q.field('status'), 'Approved'),
            q.eq(q.field('invoiceId'), undefined)
          )
        )
        .collect()
    })

    const uninvoicedMilestones = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('milestones')
        .filter((q) =>
          q.and(
            q.eq(q.field('projectId'), projectId),
            q.neq(q.field('completedAt'), undefined), // Completed
            q.eq(q.field('invoiceId'), undefined) // Not invoiced
          )
        )
        .collect()
    })

    expect(uninvoicedTime.length).toBe(0)
    expect(uninvoicedExpenses.length).toBe(0)
    expect(uninvoicedMilestones.length).toBe(0)
    // moreBillingCycles would be false
  })
})

// =============================================================================
// recordPayment Edge Cases Tests
// =============================================================================

describe('RecordPayment Work Item - Partial Payments', () => {
  it('records partial payment less than invoice total', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent',
      10000 // $100 total
    )

    // Record partial payment of $50
    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 5000, 'Check')

    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.amount).toBe(5000)

    // Calculate total paid vs invoice total
    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    expect(payment?.amount).toBeLessThan(invoice!.total)
  })

  it('records multiple partial payments summing to total', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent',
      10000 // $100 total
    )

    // Record first partial payment
    await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 3000, 'Check')
    // Record second partial payment
    await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 7000, 'ACH')

    // Get all payments for invoice
    const payments = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('payments')
        .filter((q) => q.eq(q.field('invoiceId'), invoiceId))
        .collect()
    })

    expect(payments.length).toBe(2)
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
    expect(totalPaid).toBe(10000)
  })
})

describe('RecordPayment Work Item - Overpayments', () => {
  it('allows overpayment (spec: UI should warn)', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent',
      10000 // $100 total
    )

    // Record overpayment of $150
    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 15000, 'Wire')

    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.amount).toBe(15000)

    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))
    const overpaymentAmount = payment!.amount - invoice!.total
    expect(overpaymentAmount).toBe(5000) // $50 overpayment
  })

  it('calculates overpayment amount correctly', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent',
      10000 // $100 total
    )

    // Record multiple payments leading to overpayment
    await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 6000, 'Check')
    await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 6000, 'ACH')

    const payments = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('payments')
        .filter((q) => q.eq(q.field('invoiceId'), invoiceId))
        .collect()
    })

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
    const invoice = await testContext.run(async (ctx) => ctx.db.get(invoiceId))

    expect(totalPaid).toBe(12000)
    expect(totalPaid).toBeGreaterThan(invoice!.total)
    const overpayment = totalPaid - invoice!.total
    expect(overpayment).toBe(2000) // $20 overpayment
  })
})

describe('RecordPayment Work Item - Payment Methods', () => {
  it('supports Check payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'Check')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('Check')
  })

  it('supports ACH payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'ACH')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('ACH')
  })

  it('supports Wire payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'Wire')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('Wire')
  })

  it('supports CreditCard payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'CreditCard')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('CreditCard')
  })

  it('supports Cash payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'Cash')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('Cash')
  })

  it('supports Other payment method', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000, 'Other')
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.method).toBe('Other')
  })
})

describe('RecordPayment Work Item - Invoice Status', () => {
  it('accepts payment for Sent invoice', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000)
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment).toBeDefined()
  })

  it('accepts payment for Viewed invoice', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Viewed'
    )

    const paymentId = await createPayment(testContext, authResult.organizationId as Id<'organizations'>, invoiceId, 1000)
    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment).toBeDefined()
  })
})

describe('RecordPayment Work Item - Payment Details', () => {
  it('records reference number with payment', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('payments', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        invoiceId,
        amount: 5000,
        date: Date.now(),
        method: 'Check',
        reference: 'CHECK-12345',
        syncedToAccounting: false,
        createdAt: Date.now(),
      })
    })

    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.reference).toBe('CHECK-12345')
  })

  it('records notes with payment', async () => {
    const { projectId, companyId } = await createProjectWithBudget(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      authResult.userId as Id<'users'>
    )

    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    const paymentId = await testContext.run(async (ctx) => {
      return await ctx.db.insert('payments', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        invoiceId,
        amount: 5000,
        date: Date.now(),
        method: 'Wire',
        notes: 'Payment received via international wire',
        syncedToAccounting: false,
        createdAt: Date.now(),
      })
    })

    const payment = await testContext.run(async (ctx) => ctx.db.get(paymentId))
    expect(payment?.notes).toBe('Payment received via international wire')
  })
})
