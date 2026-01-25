/**
 * Invoices API
 *
 * Domain-specific queries and mutations for invoice management.
 * These wrap domain functions with authorization and provide
 * helper mutations for work item handlers.
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 * TENET-WF-EXEC: Invoice voiding is workflow-driven for proper audit trails.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import { internal } from '../../../_generated/api'
import type { Doc, Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import { assertUserHasScope } from '../../../authorization'
import {
  getInvoice as getInvoiceFromDb,
  insertInvoice,
  updateInvoice,
  listInvoicesByProject,
  listInvoicesByCompany,
  listInvoicesByStatus,
  insertInvoiceLineItem,
  listLineItemsByInvoice,
  insertPayment,
  listPaymentsByInvoice,
  listBillableUninvoicedTimeEntries,
  listBillableUninvoicedExpenses,
  recalculateInvoiceTotals,
  finalizeInvoice as finalizeInvoiceDb,
  markInvoiceSent,
  markInvoiceViewed as markInvoiceViewedDb,
  canVoidInvoice,
} from '../db'

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Lists invoices with optional filters.
 * Supports filtering by project, company, or status.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - Optional: Filter by project
 * @param args.companyId - Optional: Filter by company
 * @param args.status - Optional: Filter by status
 * @param args.organizationId - Required when filtering by status
 * @returns Array of invoices (limited to 50)
 */
export const listInvoices = query({
  args: {
    projectId: v.optional(v.id('projects')),
    companyId: v.optional(v.id('companies')),
    status: v.optional(
      v.union(
        v.literal('Draft'),
        v.literal('Finalized'),
        v.literal('Sent'),
        v.literal('Viewed'),
        v.literal('Paid'),
        v.literal('Void')
      )
    ),
    organizationId: v.optional(v.id('organizations')),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Priority: projectId > companyId > status
    if (args.projectId) {
      return await listInvoicesByProject(ctx.db, args.projectId)
    }

    if (args.companyId) {
      return await listInvoicesByCompany(ctx.db, args.companyId)
    }

    if (args.status && args.organizationId) {
      return await listInvoicesByStatus(ctx.db, args.organizationId, args.status)
    }

    // If no filters provided but organizationId given, return draft invoices by default
    if (args.organizationId) {
      return await listInvoicesByStatus(ctx.db, args.organizationId, 'Draft')
    }

    return []
  },
})

/**
 * Gets an invoice by ID with its line items and payments.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID
 * @returns The invoice with lineItems and payments arrays, or null
 */
export const getInvoice = query({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      return null
    }

    const lineItems = await listLineItemsByInvoice(ctx.db, args.invoiceId)
    const payments = await listPaymentsByInvoice(ctx.db, args.invoiceId)

    return {
      ...invoice,
      lineItems,
      payments,
    }
  },
})

/**
 * Gets uninvoiced billable time entries and expenses for a project.
 * Used when creating invoice drafts to show available items.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns Object with timeEntries and expenses arrays
 */
export const getUninvoicedItems = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const timeEntries = await listBillableUninvoicedTimeEntries(ctx.db, args.projectId)
    const expenses = await listBillableUninvoicedExpenses(ctx.db, args.projectId)

    return {
      timeEntries,
      expenses,
    }
  },
})

/**
 * Gets payments for a specific invoice.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID
 * @returns Array of payments
 */
export const getInvoicePayments = query({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await listPaymentsByInvoice(ctx.db, args.invoiceId)
  },
})

// =============================================================================
// MUTATIONS (Helper mutations for work item handlers)
// =============================================================================

/**
 * Creates an invoice draft.
 * Used by invoice generation work items to create new invoices.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @param args.companyId - The company ID
 * @param args.organizationId - The organization ID
 * @param args.method - The invoicing method
 * @param args.dueDate - The due date timestamp
 * @returns The new invoice ID
 */
export const createInvoiceDraft = mutation({
  args: {
    projectId: v.id('projects'),
    companyId: v.id('companies'),
    organizationId: v.id('organizations'),
    method: v.union(
      v.literal('TimeAndMaterials'),
      v.literal('FixedFee'),
      v.literal('Milestone'),
      v.literal('Recurring')
    ),
    dueDate: v.number(),
  },
  handler: async (ctx, args): Promise<Id<'invoices'>> => {
    await requirePsaStaffMember(ctx)

    const invoiceId = await insertInvoice(ctx.db, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      companyId: args.companyId,
      status: 'Draft',
      method: args.method,
      subtotal: 0,
      tax: 0,
      total: 0,
      dueDate: args.dueDate,
      createdAt: Date.now(),
    })

    return invoiceId
  },
})

/**
 * Updates an invoice draft.
 * Used by editDraft work item to modify invoice details.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID
 * @param args.dueDate - Optional: New due date
 * @param args.method - Optional: New invoicing method
 * @param args.taxRate - Optional: Tax rate to apply (recalculates totals)
 */
export const updateInvoiceDraft = mutation({
  args: {
    invoiceId: v.id('invoices'),
    dueDate: v.optional(v.number()),
    method: v.optional(
      v.union(
        v.literal('TimeAndMaterials'),
        v.literal('FixedFee'),
        v.literal('Milestone'),
        v.literal('Recurring')
      )
    ),
    taxRate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    if (invoice.status !== 'Draft') {
      throw new Error('Can only update invoices in Draft status')
    }

    const updates: Partial<Omit<Doc<'invoices'>, '_id' | '_creationTime' | 'organizationId'>> = {}

    if (args.dueDate !== undefined) {
      updates.dueDate = args.dueDate
    }

    if (args.method !== undefined) {
      updates.method = args.method
    }

    if (Object.keys(updates).length > 0) {
      await updateInvoice(ctx.db, args.invoiceId, updates)
    }

    // Recalculate totals if tax rate provided
    if (args.taxRate !== undefined) {
      await recalculateInvoiceTotals(ctx.db, args.invoiceId, args.taxRate)
    }
  },
})

/**
 * Adds a line item to an invoice.
 * Used by invoice generation work items to add billable items.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID
 * @param args.description - Line item description
 * @param args.quantity - Quantity (hours or units)
 * @param args.rate - Rate in cents
 * @param args.timeEntryIds - Optional: Associated time entry IDs
 * @param args.expenseIds - Optional: Associated expense IDs
 * @param args.sortOrder - Optional: Sort order (defaults to 0)
 * @returns The new line item ID
 */
export const addInvoiceLineItem = mutation({
  args: {
    invoiceId: v.id('invoices'),
    description: v.string(),
    quantity: v.number(),
    rate: v.number(),
    timeEntryIds: v.optional(v.array(v.id('timeEntries'))),
    expenseIds: v.optional(v.array(v.id('expenses'))),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<'invoiceLineItems'>> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    if (invoice.status !== 'Draft') {
      throw new Error('Can only add line items to invoices in Draft status')
    }

    const amount = Math.round(args.quantity * args.rate)

    const lineItemId = await insertInvoiceLineItem(ctx.db, {
      invoiceId: args.invoiceId,
      description: args.description,
      quantity: args.quantity,
      rate: args.rate,
      amount,
      timeEntryIds: args.timeEntryIds,
      expenseIds: args.expenseIds,
      sortOrder: args.sortOrder ?? 0,
    })

    // Recalculate invoice totals after adding line item
    await recalculateInvoiceTotals(ctx.db, args.invoiceId)

    return lineItemId
  },
})

/**
 * Records a payment against an invoice.
 * Used by recordPayment work item to track payments.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID
 * @param args.organizationId - The organization ID
 * @param args.amount - Payment amount in cents
 * @param args.date - Payment date timestamp
 * @param args.method - Payment method (e.g., "Check", "ACH", "Credit Card")
 * @param args.reference - Optional: Payment reference/check number
 * @returns Object with paymentId and whether invoice is now fully paid
 */
export const recordPayment = mutation({
  args: {
    invoiceId: v.id('invoices'),
    organizationId: v.id('organizations'),
    amount: v.number(),
    date: v.number(),
    method: v.string(),
    reference: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ paymentId: Id<'payments'>; isPaid: boolean }> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    if (invoice.status === 'Draft' || invoice.status === 'Void') {
      throw new Error(`Cannot record payment for invoice in ${invoice.status} status`)
    }

    const paymentId = await insertPayment(ctx.db, {
      organizationId: args.organizationId,
      invoiceId: args.invoiceId,
      amount: args.amount,
      date: args.date,
      method: args.method,
      reference: args.reference,
      syncedToAccounting: false,
      createdAt: Date.now(),
    })

    // Calculate total payments to check if invoice is fully paid
    const payments = await listPaymentsByInvoice(ctx.db, args.invoiceId)
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
    const isPaid = totalPaid >= invoice.total

    // Update invoice status to Paid if fully paid
    if (isPaid) {
      await updateInvoice(ctx.db, args.invoiceId, {
        status: 'Paid',
        paidAt: Date.now(),
      })
    }

    return { paymentId, isPaid }
  },
})

/**
 * Finalizes an invoice draft.
 * Generates an invoice number and locks linked time entries/expenses.
 * Used by finalizeInvoice work item and can be called directly for testing.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID to finalize
 * @param args.dueDate - Optional: Override due date
 * @returns Object with invoiceNumber and finalized status
 */
export const finalizeInvoice = mutation({
  args: {
    invoiceId: v.id('invoices'),
    dueDate: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ invoiceNumber: string; finalized: boolean }> => {
    const userId = await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    if (invoice.status !== 'Draft') {
      throw new Error(`Only Draft invoices can be finalized. Current status: ${invoice.status}`)
    }

    // Check invoice has line items
    const lineItems = await listLineItemsByInvoice(ctx.db, args.invoiceId)
    if (lineItems.length === 0) {
      throw new Error('Invoice must have at least one line item to finalize')
    }

    // Update optional fields before finalizing
    if (args.dueDate !== undefined) {
      await updateInvoice(ctx.db, args.invoiceId, { dueDate: args.dueDate })
    }

    // Finalize the invoice (generates number, sets status)
    const invoiceNumber = await finalizeInvoiceDb(ctx.db, args.invoiceId, userId)

    return { invoiceNumber, finalized: true }
  },
})

/**
 * Sends an invoice to the client.
 * Changes status from Finalized to Sent and records the delivery method.
 * Used by sendInvoice work item and can be called directly for testing.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID to send
 * @param args.method - Delivery method: "email", "pdf", or "portal"
 * @param args.recipientEmail - Optional: Email address for delivery
 * @param args.personalMessage - Optional: Personal message to include
 * @returns Object with sent status and optional tracking ID
 */
export const sendInvoice = mutation({
  args: {
    invoiceId: v.id('invoices'),
    method: v.union(v.literal('email'), v.literal('pdf'), v.literal('portal')),
    recipientEmail: v.optional(v.string()),
    personalMessage: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: boolean; trackingId?: string }> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    if (invoice.status !== 'Finalized') {
      throw new Error(`Only Finalized invoices can be sent. Current status: ${invoice.status}`)
    }

    // Mark invoice as sent
    await markInvoiceSent(ctx.db, args.invoiceId)

    // Generate a tracking ID for the delivery
    const trackingId = `TRK-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    return { sent: true, trackingId }
  },
})

/**
 * Void an invoice (instead of deleting it).
 * Per spec 11-workflow-invoice-generation.md line 444: "Void not delete" for finalized invoices.
 *
 * TENET-WF-EXEC: Invoice voiding is now workflow-driven via the invoiceVoid workflow.
 * This creates proper audit trails through the Tasquencer work item system.
 *
 * Authorization: Requires dealToDelivery:invoices:void scope.
 *
 * Valid states for voiding: Finalized, Sent, Viewed
 * Cannot void: Draft (delete instead), Paid (requires reversal first)
 *
 * @param args.invoiceId - The invoice to void
 * @param args.reason - Optional: Reason for voiding the invoice
 * @returns Object with voided status, void details, and workflow ID
 */
export const voidInvoice = mutation({
  args: {
    invoiceId: v.id('invoices'),
    reason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ voided: boolean; voidedAt: number; canVoid: boolean; workflowId?: Id<'tasquencerWorkflows'> }> => {
    // TENET-AUTHZ: Require invoices:void scope (not just staff)
    await requirePsaStaffMember(ctx)
    await assertUserHasScope(ctx, 'dealToDelivery:invoices:void')

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    // Check if invoice can be voided (pre-flight validation before workflow)
    if (!canVoidInvoice(invoice)) {
      if (invoice.status === 'Draft') {
        throw new Error('Draft invoices should be deleted, not voided')
      }
      if (invoice.status === 'Paid') {
        throw new Error('Cannot void a paid invoice. Record a refund or reversal first.')
      }
      if (invoice.status === 'Void') {
        // Already voided - return success without error (idempotent)
        return {
          voided: true,
          voidedAt: invoice.voidedAt ?? Date.now(),
          canVoid: false,
        }
      }
      throw new Error(`Invoice in ${invoice.status} status cannot be voided`)
    }

    // TENET-WF-EXEC: Use workflow for invoice voiding to create audit trail
    // Step 1: Initialize the invoiceVoid root workflow
    const workflowId = await ctx.runMutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkflow,
      {
        payload: {},
      },
    )

    // Step 2: Initialize the voidInvoice work item
    const workItemId = await ctx.runMutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkItem,
      {
        target: {
          path: ['invoiceVoid', 'voidInvoice', 'voidInvoice'],
          parentWorkflowId: workflowId,
          parentTaskName: 'voidInvoice',
        },
        args: { name: 'voidInvoice' as const, payload: { invoiceId: args.invoiceId } },
      },
    )

    // Step 3: Start the voidInvoice work item
    await ctx.runMutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalStartInvoiceVoidWorkItem,
      {
        workItemId,
        args: { name: 'voidInvoice' as const },
      },
    )

    // Step 4: Complete the voidInvoice work item
    await ctx.runMutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalCompleteInvoiceVoidWorkItem,
      {
        workItemId,
        args: {
          name: 'voidInvoice' as const,
          payload: {
            invoiceId: args.invoiceId,
            reason: args.reason,
          },
        },
      },
    )

    return {
      voided: true,
      voidedAt: Date.now(),
      canVoid: true,
      workflowId,
    }
  },
})

/**
 * Check if an invoice can be voided.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice to check
 * @returns Object with canVoid flag and reason if not voidable
 */
export const checkCanVoidInvoice = query({
  args: {
    invoiceId: v.id('invoices'),
  },
  handler: async (ctx, args): Promise<{ canVoid: boolean; reason?: string }> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      return { canVoid: false, reason: 'Invoice not found' }
    }

    if (canVoidInvoice(invoice)) {
      return { canVoid: true }
    }

    if (invoice.status === 'Draft') {
      return { canVoid: false, reason: 'Draft invoices should be deleted, not voided' }
    }

    if (invoice.status === 'Paid') {
      return { canVoid: false, reason: 'Paid invoices require a reversal before voiding' }
    }

    if (invoice.status === 'Void') {
      return { canVoid: false, reason: 'Invoice is already voided' }
    }

    return { canVoid: false, reason: `Invoice in ${invoice.status} status cannot be voided` }
  },
})

/**
 * Marks an invoice as viewed by the client.
 * Per spec 12-workflow-billing-phase.md lines 386-391: "When client views invoice,
 * update viewedAt timestamp and status to 'Viewed'."
 *
 * This mutation is designed for use when clients view invoices via email links or portal.
 * If the invoice has already been viewed, this is a no-op (idempotent).
 *
 * Note: This endpoint requires staff scope for internal tracking.
 * For external client view tracking, a separate unauthenticated endpoint
 * with tracking token would be needed.
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.invoiceId - The invoice ID that was viewed
 * @returns Object with viewed status and timestamp
 */
export const markInvoiceViewed = mutation({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, args): Promise<{ viewed: boolean; viewedAt: number | null }> => {
    await requirePsaStaffMember(ctx)

    const invoice = await getInvoiceFromDb(ctx.db, args.invoiceId)
    if (!invoice) {
      throw new Error(`Invoice not found: ${args.invoiceId}`)
    }

    // Only mark as viewed if it's in Sent status
    // Don't change status if already Viewed, Paid, or Void
    if (invoice.status === 'Sent') {
      await markInvoiceViewedDb(ctx.db, args.invoiceId)
      return { viewed: true, viewedAt: Date.now() }
    }

    // Already viewed or in another status - return current state (idempotent)
    return { viewed: invoice.status === 'Viewed', viewedAt: invoice.viewedAt ?? null }
  },
})
