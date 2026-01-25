/// <reference types="vite/client" />
/**
 * Invoices API Tests
 *
 * Tests for invoice CRUD operations, line items, payments, and status transitions
 * via the API layer.
 *
 * Key test scenarios:
 * - Listing invoices with filtering (project, company, status)
 * - Getting invoices with enriched details (line items, payments)
 * - Creating and updating invoice drafts
 * - Adding line items with totals recalculation
 * - Finalizing invoices (invoice number generation, status transition)
 * - Sending invoices (delivery method tracking)
 * - Recording payments (partial and full payment handling)
 * - Authorization checks
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

// All scopes needed for invoice tests
const STAFF_SCOPES = ['dealToDelivery:staff']
// Finance scopes for operations like voiding invoices (per spec 02-authorization.md)
const FINANCE_SCOPES = [
  'dealToDelivery:staff',
  'dealToDelivery:invoices:void',
  'dealToDelivery:invoices:create',
  'dealToDelivery:invoices:edit',
  'dealToDelivery:invoices:finalize',
  'dealToDelivery:invoices:send',
  'dealToDelivery:invoices:view:all',
]

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
 * Creates test data (company, project) required for invoice creation
 */
async function setupInvoicePrerequisites(
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
      endDate: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days from now
      managerId: userId,
      createdAt: Date.now(),
    })
  })

  // Create a budget for the project
  const budgetId = await t.run(async (ctx) => {
    return await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: 'TimeAndMaterials',
      totalAmount: 6500_00, // $6,500
      createdAt: Date.now(),
    })
  })

  return { companyId, projectId, budgetId }
}

/**
 * Creates an invoice directly in the database (for testing queries)
 */
async function createInvoiceDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>,
  overrides: Partial<{
    status: Doc<'invoices'>['status']
    method: Doc<'invoices'>['method']
    subtotal: number
    tax: number
    total: number
    number: string
    sentAt: number
    viewedAt: number
    paidAt: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('invoices', {
      organizationId: orgId,
      projectId,
      companyId,
      status: overrides.status ?? 'Draft',
      method: overrides.method ?? 'TimeAndMaterials',
      subtotal: overrides.subtotal ?? 0,
      tax: overrides.tax ?? 0,
      total: overrides.total ?? 0,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
      createdAt: Date.now(),
      number: overrides.number,
      sentAt: overrides.sentAt,
      viewedAt: overrides.viewedAt,
      paidAt: overrides.paidAt,
    })
  })
}

/**
 * Creates an invoice line item directly
 */
async function createLineItemDirectly(
  t: ReturnType<typeof setup>,
  invoiceId: Id<'invoices'>,
  overrides: Partial<{
    description: string
    quantity: number
    rate: number
    amount: number
  }> = {}
) {
  const quantity = overrides.quantity ?? 10
  const rate = overrides.rate ?? 150_00 // $150/hr
  const amount = overrides.amount ?? quantity * rate

  return await t.run(async (ctx) => {
    return await ctx.db.insert('invoiceLineItems', {
      invoiceId,
      description: overrides.description ?? 'Consulting Services',
      quantity,
      rate,
      amount,
      sortOrder: 0,
    })
  })
}

/**
 * Creates a billable time entry directly
 */
async function createBillableTimeEntry(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('timeEntries', {
      organizationId: orgId,
      projectId,
      userId,
      date: Date.now(),
      hours: 8,
      status: 'Approved',
      billable: true,
      notes: 'Development work',
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates a billable expense directly
 */
async function createBillableExpense(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  userId: Id<'users'>
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('expenses', {
      organizationId: orgId,
      projectId,
      userId,
      date: Date.now(),
      amount: 500_00, // $500
      type: 'Software',
      currency: 'USD',
      status: 'Approved',
      billable: true,
      description: 'Software license',
      markupRate: 1.1, // 10% markup
      createdAt: Date.now(),
    })
  })
}

// =============================================================================
// listInvoices Tests
// =============================================================================

describe('Invoices API', () => {
  describe('listInvoices', () => {
    it('should return invoices filtered by project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create another project
      const otherProjectId = await t.run(async (ctx) => {
        return await ctx.db.insert('projects', {
          organizationId: orgId,
          companyId,
          name: 'Other Project',
          status: 'Active',
          startDate: Date.now(),
          managerId: userId,
          createdAt: Date.now(),
        })
      })

      // Create invoices for different projects
      await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createInvoiceDirectly(t, orgId, otherProjectId, companyId)

      const invoices = await t.query(api.workflows.dealToDelivery.api.invoices.listInvoices, {
        projectId,
      })

      expect(invoices).toHaveLength(1)
    })

    it('should return invoices filtered by company', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create another company
      const otherCompanyId = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Other Company',
          billingAddress: { street: '2', city: 'B', state: 'B', postalCode: '2', country: 'B' },
          paymentTerms: 30,
        })
      })

      // Create invoices for different companies
      await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createInvoiceDirectly(t, orgId, projectId, otherCompanyId)

      const invoices = await t.query(api.workflows.dealToDelivery.api.invoices.listInvoices, {
        companyId,
      })

      expect(invoices).toHaveLength(1)
    })

    it('should return invoices filtered by status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create invoices with different statuses
      await createInvoiceDirectly(t, orgId, projectId, companyId, { status: 'Draft' })
      await createInvoiceDirectly(t, orgId, projectId, companyId, { status: 'Finalized' })
      await createInvoiceDirectly(t, orgId, projectId, companyId, { status: 'Sent' })

      const draftInvoices = await t.query(api.workflows.dealToDelivery.api.invoices.listInvoices, {
        status: 'Draft',
        organizationId: orgId,
      })

      expect(draftInvoices).toHaveLength(1)
    })

    it('should return empty array when no invoices match filters', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoices = await t.query(api.workflows.dealToDelivery.api.invoices.listInvoices, {
        projectId,
      })

      expect(invoices).toHaveLength(0)
    })
  })

  // =============================================================================
  // getInvoice Tests
  // =============================================================================

  describe('getInvoice', () => {
    it('should return invoice with line items and payments', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create invoice with line items and payments
      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        subtotal: 1500_00,
        total: 1500_00,
      })

      await createLineItemDirectly(t, invoiceId, {
        description: 'Service A',
        quantity: 10,
        rate: 150_00,
      })

      // Create a payment
      await t.run(async (ctx) => {
        await ctx.db.insert('payments', {
          organizationId: orgId,
          invoiceId,
          amount: 500_00,
          date: Date.now(),
          method: 'Check',
          reference: 'CHK-001',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
      })

      const invoice = await t.query(api.workflows.dealToDelivery.api.invoices.getInvoice, {
        invoiceId,
      })

      expect(invoice).not.toBeNull()
      expect(invoice?.lineItems).toHaveLength(1)
      expect(invoice?.payments).toHaveLength(1)
      expect(invoice?.lineItems[0].description).toBe('Service A')
      expect(invoice?.payments[0].amount).toBe(500_00)
    })

    it('should return empty line items and payments for invoice with none', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      const invoice = await t.query(api.workflows.dealToDelivery.api.invoices.getInvoice, {
        invoiceId,
      })

      expect(invoice).not.toBeNull()
      expect(invoice?.lineItems).toHaveLength(0)
      expect(invoice?.payments).toHaveLength(0)
    })
  })

  // =============================================================================
  // getUninvoicedItems Tests
  // =============================================================================

  describe('getUninvoicedItems', () => {
    it('should return uninvoiced time entries and expenses', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create billable time entries and expenses
      await createBillableTimeEntry(t, orgId, projectId, userId)
      await createBillableExpense(t, orgId, projectId, userId)

      const items = await t.query(api.workflows.dealToDelivery.api.invoices.getUninvoicedItems, {
        projectId,
      })

      expect(items.timeEntries).toHaveLength(1)
      expect(items.expenses).toHaveLength(1)
    })

    it('should not include already invoiced items', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create an invoice
      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      // Create time entry that is already invoiced
      await t.run(async (ctx) => {
        await ctx.db.insert('timeEntries', {
          organizationId: orgId,
          projectId,
          userId,
          date: Date.now(),
          hours: 8,
          status: 'Approved',
          billable: true,
          notes: 'Invoiced work',
          invoiceId, // Already invoiced
          createdAt: Date.now(),
        })
      })

      // Create uninvoiced entry
      await createBillableTimeEntry(t, orgId, projectId, userId)

      const items = await t.query(api.workflows.dealToDelivery.api.invoices.getUninvoicedItems, {
        projectId,
      })

      // Should only find the uninvoiced entry
      expect(items.timeEntries).toHaveLength(1)
    })
  })

  // =============================================================================
  // createInvoiceDraft Tests
  // =============================================================================

  describe('createInvoiceDraft', () => {
    it('should create a new invoice draft', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const dueDate = Date.now() + 30 * 24 * 60 * 60 * 1000

      const invoiceId = await t.mutation(
        api.workflows.dealToDelivery.api.invoices.createInvoiceDraft,
        {
          projectId,
          companyId,
          organizationId: orgId,
          method: 'TimeAndMaterials',
          dueDate,
        }
      )

      expect(invoiceId).toBeDefined()

      // Verify invoice was created correctly
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice).not.toBeNull()
      expect(invoice?.status).toBe('Draft')
      expect(invoice?.method).toBe('TimeAndMaterials')
      expect(invoice?.subtotal).toBe(0)
      expect(invoice?.total).toBe(0)
    })

    it('should support different invoicing methods', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await t.mutation(
        api.workflows.dealToDelivery.api.invoices.createInvoiceDraft,
        {
          projectId,
          companyId,
          organizationId: orgId,
          method: 'Milestone',
          dueDate: Date.now(),
        }
      )

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.method).toBe('Milestone')
    })
  })

  // =============================================================================
  // updateInvoiceDraft Tests
  // =============================================================================

  describe('updateInvoiceDraft', () => {
    it('should update due date', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)
      const newDueDate = Date.now() + 60 * 24 * 60 * 60 * 1000 // 60 days

      await t.mutation(api.workflows.dealToDelivery.api.invoices.updateInvoiceDraft, {
        invoiceId,
        dueDate: newDueDate,
      })

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.dueDate).toBe(newDueDate)
    })

    it('should update invoicing method', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        method: 'TimeAndMaterials',
      })

      await t.mutation(api.workflows.dealToDelivery.api.invoices.updateInvoiceDraft, {
        invoiceId,
        method: 'FixedFee',
      })

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.method).toBe('FixedFee')
    })

    it('should reject update for non-Draft invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.updateInvoiceDraft, {
          invoiceId,
          dueDate: Date.now(),
        })
      ).rejects.toThrow('Can only update invoices in Draft status')
    })
  })

  // =============================================================================
  // addInvoiceLineItem Tests
  // =============================================================================

  describe('addInvoiceLineItem', () => {
    it('should add line item and calculate amount', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      const lineItemId = await t.mutation(
        api.workflows.dealToDelivery.api.invoices.addInvoiceLineItem,
        {
          invoiceId,
          description: 'Development Services',
          quantity: 10,
          rate: 150_00, // $150/hr
        }
      )

      expect(lineItemId).toBeDefined()

      // Verify line item was created correctly
      const lineItem = await t.run(async (ctx) => {
        return await ctx.db.get(lineItemId)
      })

      expect(lineItem?.description).toBe('Development Services')
      expect(lineItem?.quantity).toBe(10)
      expect(lineItem?.rate).toBe(150_00)
      expect(lineItem?.amount).toBe(1500_00) // 10 * $150 = $1500
    })

    it('should recalculate invoice totals after adding line item', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      // Add first line item
      await t.mutation(api.workflows.dealToDelivery.api.invoices.addInvoiceLineItem, {
        invoiceId,
        description: 'Service A',
        quantity: 5,
        rate: 100_00,
      })

      // Add second line item
      await t.mutation(api.workflows.dealToDelivery.api.invoices.addInvoiceLineItem, {
        invoiceId,
        description: 'Service B',
        quantity: 10,
        rate: 200_00,
      })

      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      // Total should be: (5 * $100) + (10 * $200) = $500 + $2000 = $2500
      expect(invoice?.subtotal).toBe(2500_00)
      expect(invoice?.total).toBe(2500_00)
    })

    it('should reject adding line items to non-Draft invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.addInvoiceLineItem, {
          invoiceId,
          description: 'Should Fail',
          quantity: 1,
          rate: 100_00,
        })
      ).rejects.toThrow('Can only add line items to invoices in Draft status')
    })
  })

  // =============================================================================
  // finalizeInvoice Tests
  // =============================================================================

  describe('finalizeInvoice', () => {
    it('should finalize invoice and generate invoice number', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createLineItemDirectly(t, invoiceId)

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
        invoiceId,
      })

      expect(result.finalized).toBe(true)
      expect(result.invoiceNumber).toBeDefined()
      expect(result.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/) // INV-YYYY-NNNNN format

      // Verify invoice status changed
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.status).toBe('Finalized')
      expect(invoice?.number).toBe(result.invoiceNumber)
    })

    it('should reject finalization of invoice without line items', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)
      // No line items added

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
          invoiceId,
        })
      ).rejects.toThrow('Invoice must have at least one line item to finalize')
    })

    it('should reject finalization of non-Draft invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
          invoiceId,
        })
      ).rejects.toThrow('Only Draft invoices can be finalized')
    })

    it('should generate unique invoice numbers (5 digit padding)', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      // Create and finalize first invoice
      const invoice1Id = await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createLineItemDirectly(t, invoice1Id)
      const result1 = await t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
        invoiceId: invoice1Id,
      })

      // Create and finalize second invoice
      const invoice2Id = await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createLineItemDirectly(t, invoice2Id)
      const result2 = await t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
        invoiceId: invoice2Id,
      })

      // Invoice numbers should be different and have 5 digit sequence
      expect(result1.invoiceNumber).not.toBe(result2.invoiceNumber)

      // Extract sequence numbers and verify they're incrementing
      const seq1 = parseInt(result1.invoiceNumber.split('-')[2])
      const seq2 = parseInt(result2.invoiceNumber.split('-')[2])
      expect(seq2).toBeGreaterThan(seq1)
    })
  })

  // =============================================================================
  // sendInvoice Tests
  // =============================================================================

  describe('sendInvoice', () => {
    it('should send invoice via email and return tracking ID', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.sendInvoice, {
        invoiceId,
        method: 'email',
        recipientEmail: 'client@test.com',
      })

      expect(result.sent).toBe(true)
      expect(result.trackingId).toBeDefined()
      expect(result.trackingId).toMatch(/^TRK-/) // Tracking ID format

      // Verify invoice status changed to Sent
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.status).toBe('Sent')
    })

    it('should support PDF delivery method', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.sendInvoice, {
        invoiceId,
        method: 'pdf',
      })

      expect(result.sent).toBe(true)
    })

    it('should support portal delivery method', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.sendInvoice, {
        invoiceId,
        method: 'portal',
      })

      expect(result.sent).toBe(true)
    })

    it('should reject sending non-Finalized invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.sendInvoice, {
          invoiceId,
          method: 'email',
        })
      ).rejects.toThrow('Only Finalized invoices can be sent')
    })
  })

  // =============================================================================
  // recordPayment Tests
  // =============================================================================

  describe('recordPayment', () => {
    it('should record partial payment', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        total: 1000_00, // $1000 total
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
        invoiceId,
        organizationId: orgId,
        amount: 500_00, // $500 payment
        date: Date.now(),
        method: 'Check',
        reference: 'CHK-123',
      })

      expect(result.paymentId).toBeDefined()
      expect(result.isPaid).toBe(false) // Not fully paid

      // Verify invoice is still Sent (not Paid)
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.status).toBe('Sent')
    })

    it('should mark invoice as Paid when fully paid', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        total: 1000_00,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
        invoiceId,
        organizationId: orgId,
        amount: 1000_00, // Full payment
        date: Date.now(),
        method: 'ACH',
      })

      expect(result.isPaid).toBe(true)

      // Verify invoice status changed to Paid
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.status).toBe('Paid')
      expect(invoice?.paidAt).toBeDefined()
    })

    it('should handle multiple partial payments summing to full payment', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        total: 1000_00,
      })

      // First partial payment
      const result1 = await t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
        invoiceId,
        organizationId: orgId,
        amount: 400_00,
        date: Date.now(),
        method: 'Check',
      })
      expect(result1.isPaid).toBe(false)

      // Second partial payment
      const result2 = await t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
        invoiceId,
        organizationId: orgId,
        amount: 600_00,
        date: Date.now(),
        method: 'Check',
      })
      expect(result2.isPaid).toBe(true)

      // Verify invoice is now Paid
      const invoice = await t.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })

      expect(invoice?.status).toBe('Paid')
    })

    it('should reject payment for Draft invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
          invoiceId,
          organizationId: orgId,
          amount: 100_00,
          date: Date.now(),
          method: 'Cash',
        })
      ).rejects.toThrow('Cannot record payment for invoice in Draft status')
    })

    it('should reject payment for Void invoices', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Void',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
          invoiceId,
          organizationId: orgId,
          amount: 100_00,
          date: Date.now(),
          method: 'Cash',
        })
      ).rejects.toThrow('Cannot record payment for invoice in Void status')
    })
  })

  // =============================================================================
  // getInvoicePayments Tests
  // =============================================================================

  describe('getInvoicePayments', () => {
    it('should return payments for invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
      })

      // Create payments
      await t.run(async (ctx) => {
        await ctx.db.insert('payments', {
          organizationId: orgId,
          invoiceId,
          amount: 300_00,
          date: Date.now(),
          method: 'Check',
          reference: 'CHK-001',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
        await ctx.db.insert('payments', {
          organizationId: orgId,
          invoiceId,
          amount: 200_00,
          date: Date.now(),
          method: 'ACH',
          syncedToAccounting: false,
          createdAt: Date.now(),
        })
      })

      const payments = await t.query(
        api.workflows.dealToDelivery.api.invoices.getInvoicePayments,
        {
          invoiceId,
        }
      )

      expect(payments).toHaveLength(2)
      expect(payments.reduce((sum, p) => sum + p.amount, 0)).toBe(500_00)
    })

    it('should return empty array when no payments exist', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      const payments = await t.query(
        api.workflows.dealToDelivery.api.invoices.getInvoicePayments,
        {
          invoiceId,
        }
      )

      expect(payments).toHaveLength(0)
    })
  })

  // =============================================================================
  // Authorization Tests
  // =============================================================================

  describe('Authorization', () => {
    it('should allow listInvoices with staff scope', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // This should work with proper scopes
      const invoices = await t.query(api.workflows.dealToDelivery.api.invoices.listInvoices, {})
      expect(Array.isArray(invoices)).toBe(true)
    })

    it('should allow getInvoice with staff scope', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)

      const invoice = await t.query(api.workflows.dealToDelivery.api.invoices.getInvoice, {
        invoiceId,
      })

      expect(invoice).not.toBeNull()
    })

    it('should allow createInvoiceDraft with staff scope', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await t.mutation(
        api.workflows.dealToDelivery.api.invoices.createInvoiceDraft,
        {
          projectId,
          companyId,
          organizationId: orgId,
          method: 'TimeAndMaterials',
          dueDate: Date.now(),
        }
      )

      expect(invoiceId).toBeDefined()
    })

    it('should allow finalizeInvoice with staff scope', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId)
      await createLineItemDirectly(t, invoiceId)

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.finalizeInvoice, {
        invoiceId,
      })

      expect(result.finalized).toBe(true)
    })

    it('should allow recordPayment with staff scope', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        total: 1000_00,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.recordPayment, {
        invoiceId,
        organizationId: orgId,
        amount: 500_00,
        date: Date.now(),
        method: 'Check',
      })

      expect(result.paymentId).toBeDefined()
    })
  })

  // =============================================================================
  // voidInvoice Tests
  // Reference: spec 11-workflow-invoice-generation.md line 444: "Void not delete"
  // =============================================================================

  describe('voidInvoice', () => {
    it('should void a Finalized invoice', async () => {
      const t = setup()
      // Use FINANCE_SCOPES since voidInvoice requires dealToDelivery:invoices:void
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
        invoiceId,
        reason: 'Client requested cancellation',
      })

      expect(result.voided).toBe(true)
      expect(result.voidedAt).toBeDefined()
      expect(result.canVoid).toBe(true)
      // TENET-WF-EXEC: Verify workflow ID is returned
      expect(result.workflowId).toBeDefined()

      // Verify invoice status is now Void
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice?.status).toBe('Void')
      expect(invoice?.voidReason).toBe('Client requested cancellation')
    })

    it('should void a Sent invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
        invoiceId,
      })

      expect(result.voided).toBe(true)

      // Verify invoice status is now Void
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice?.status).toBe('Void')
    })

    it('should void a Viewed invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Viewed',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
        invoiceId,
      })

      expect(result.voided).toBe(true)

      // Verify invoice status is now Void
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice?.status).toBe('Void')
    })

    it('should reject voiding a Draft invoice (should delete instead)', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
          invoiceId,
        })
      ).rejects.toThrow('Draft invoices should be deleted, not voided')
    })

    it('should reject voiding a Paid invoice (requires reversal first)', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Paid',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
          invoiceId,
        })
      ).rejects.toThrow('Cannot void a paid invoice')
    })

    it('should return success for already voided invoice (idempotent)', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Void',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
        invoiceId,
      })

      expect(result.voided).toBe(true)
      expect(result.canVoid).toBe(false) // Already was voided
    })

    it('should record voidedBy and voidedAt fields', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'finance-user',
        FINANCE_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
      })

      const beforeVoid = Date.now()
      await t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
        invoiceId,
        reason: 'Test void reason',
      })

      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice?.voidedBy).toBe(userId)
      expect(invoice?.voidedAt).toBeGreaterThanOrEqual(beforeVoid)
      expect(invoice?.voidReason).toBe('Test void reason')
    })

    it('should reject voiding without invoices:void scope', async () => {
      const t = setup()
      // Regular staff user without void scope
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.voidInvoice, {
          invoiceId,
        })
      ).rejects.toThrow('does not have scope dealToDelivery:invoices:void')
    })
  })

  // =============================================================================
  // checkCanVoidInvoice Tests
  // =============================================================================

  describe('checkCanVoidInvoice', () => {
    it('should return canVoid: true for Finalized invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Finalized',
      })

      const result = await t.query(api.workflows.dealToDelivery.api.invoices.checkCanVoidInvoice, {
        invoiceId,
      })

      expect(result.canVoid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should return canVoid: false for Draft invoice with reason', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      const result = await t.query(api.workflows.dealToDelivery.api.invoices.checkCanVoidInvoice, {
        invoiceId,
      })

      expect(result.canVoid).toBe(false)
      expect(result.reason).toContain('delete')
    })

    it('should return canVoid: false for Paid invoice with reason', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Paid',
      })

      const result = await t.query(api.workflows.dealToDelivery.api.invoices.checkCanVoidInvoice, {
        invoiceId,
      })

      expect(result.canVoid).toBe(false)
      expect(result.reason).toContain('reversal')
    })

    it('should return canVoid: false for already Void invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Void',
      })

      const result = await t.query(api.workflows.dealToDelivery.api.invoices.checkCanVoidInvoice, {
        invoiceId,
      })

      expect(result.canVoid).toBe(false)
      expect(result.reason).toContain('already voided')
    })
  })

  // =============================================================================
  // markInvoiceViewed Tests
  // Per spec 12-workflow-billing-phase.md lines 386-391: "When client views invoice,
  // update viewedAt timestamp and status to 'Viewed'."
  // =============================================================================

  describe('markInvoiceViewed', () => {
    it('should transition Sent invoice to Viewed status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
        sentAt: Date.now() - 1000,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.markInvoiceViewed, {
        invoiceId,
      })

      expect(result.viewed).toBe(true)
      expect(result.viewedAt).toBeDefined()
      expect(result.viewedAt).toBeGreaterThan(0)

      // Verify the invoice status changed
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice!.status).toBe('Viewed')
      expect(invoice!.viewedAt).toBeDefined()
    })

    it('should be idempotent for already Viewed invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const originalViewedAt = Date.now() - 5000
      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Viewed',
        viewedAt: originalViewedAt,
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.markInvoiceViewed, {
        invoiceId,
      })

      // Should return viewed=true but with original timestamp (idempotent)
      expect(result.viewed).toBe(true)
      expect(result.viewedAt).toBe(originalViewedAt)

      // Verify the timestamp wasn't updated
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice!.viewedAt).toBe(originalViewedAt)
    })

    it('should not change status for Paid invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Paid',
        paidAt: Date.now(),
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.markInvoiceViewed, {
        invoiceId,
      })

      // Should return viewed=false since it's not in Viewed status
      expect(result.viewed).toBe(false)
      expect(result.viewedAt).toBeNull()

      // Verify status unchanged
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice!.status).toBe('Paid')
    })

    it('should not change status for Draft invoice', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Draft',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.invoices.markInvoiceViewed, {
        invoiceId,
      })

      // Should return viewed=false since Draft can't be viewed
      expect(result.viewed).toBe(false)

      // Verify status unchanged
      const invoice = await t.run(async (ctx) => ctx.db.get(invoiceId))
      expect(invoice!.status).toBe('Draft')
    })

    it('should require authorization', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { companyId, projectId } = await setupInvoicePrerequisites(t, orgId, userId)

      const invoiceId = await createInvoiceDirectly(t, orgId, projectId, companyId, {
        status: 'Sent',
      })

      // Setup user without scopes
      await setupUserWithRole(t, 'no-scopes-user', [])

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.invoices.markInvoiceViewed, {
          invoiceId,
        })
      ).rejects.toThrow()
    })
  })
})
