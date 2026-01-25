/**
 * Database functions for invoices, line items, and payments
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type InvoiceStatus = Doc<"invoices">["status"];
export type InvoiceMethod = Doc<"invoices">["method"];

// Invoices

export async function insertInvoice(
  db: DatabaseWriter,
  invoice: Omit<Doc<"invoices">, "_id" | "_creationTime">
): Promise<Id<"invoices">> {
  return await db.insert("invoices", invoice);
}

export async function getInvoice(
  db: DatabaseReader,
  invoiceId: Id<"invoices">
): Promise<Doc<"invoices"> | null> {
  return await db.get(invoiceId);
}

export async function updateInvoiceStatus(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">,
  status: InvoiceStatus
): Promise<void> {
  const invoice = await db.get(invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }
  await db.patch(invoiceId, { status });
}

export async function updateInvoice(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">,
  updates: Partial<Omit<Doc<"invoices">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const invoice = await db.get(invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }
  await db.patch(invoiceId, updates);
}

export async function listInvoicesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 50
): Promise<Array<Doc<"invoices">>> {
  return await db
    .query("invoices")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(limit);
}

export async function listInvoicesByCompany(
  db: DatabaseReader,
  companyId: Id<"companies">,
  limit = 50
): Promise<Array<Doc<"invoices">>> {
  return await db
    .query("invoices")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(limit);
}

export async function listInvoicesByStatus(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  status: InvoiceStatus,
  limit = 50
): Promise<Array<Doc<"invoices">>> {
  return await db
    .query("invoices")
    .withIndex("by_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export async function getInvoiceByNumber(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  number: string
): Promise<Doc<"invoices"> | null> {
  return await db
    .query("invoices")
    .withIndex("by_number", (q) =>
      q.eq("organizationId", organizationId).eq("number", number)
    )
    .unique();
}

export async function getNextInvoiceNumber(
  db: DatabaseReader,
  organizationId: Id<"organizations">
): Promise<string> {
  const year = new Date().getFullYear();
  const invoices = await listInvoicesByStatus(db, organizationId, "Finalized", 1000);
  const thisYearInvoices = invoices.filter((i) =>
    i.number?.startsWith(`INV-${year}-`)
  );
  const sequence = thisYearInvoices.length + 1;
  // Per spec 11 line 408-409: INV-{YEAR}-{SEQUENCE} with 5-digit padding (e.g., INV-2024-00142)
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

export async function finalizeInvoice(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">,
  finalizedBy: Id<"users">
): Promise<string> {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }

  const invoiceNumber = await getNextInvoiceNumber(db, invoice.organizationId);

  await updateInvoice(db, invoiceId, {
    status: "Finalized",
    number: invoiceNumber,
    finalizedAt: Date.now(),
    finalizedBy,
  });

  return invoiceNumber;
}

/**
 * Mark an invoice as sent.
 *
 * Per spec 12-workflow-billing-phase.md line 397: "Send Once: Cannot re-send same invoice (must void and recreate)"
 * This function enforces the send-once rule by rejecting invoices that have already been sent.
 *
 * @param db - Database writer
 * @param invoiceId - The invoice to mark as sent
 * @throws Error if invoice has already been sent or is not in Finalized status
 */
export async function markInvoiceSent(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">
): Promise<void> {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }

  // Enforce send-once rule per spec 12-workflow-billing-phase.md line 397
  if (invoice.sentAt) {
    throw new Error(
      `Invoice ${invoice.number || invoiceId} has already been sent. ` +
        `To re-send, void this invoice and create a new one.`
    );
  }

  // Only finalized invoices can be sent
  if (invoice.status !== "Finalized") {
    throw new Error(
      `Cannot send invoice in ${invoice.status} status. Invoice must be finalized first.`
    );
  }

  await updateInvoice(db, invoiceId, {
    status: "Sent",
    sentAt: Date.now(),
  });
}

export async function markInvoiceViewed(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">
): Promise<void> {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }
  if (!invoice.viewedAt) {
    await updateInvoice(db, invoiceId, {
      status: "Viewed",
      viewedAt: Date.now(),
    });
  }
}

export async function markInvoicePaid(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">
): Promise<void> {
  await updateInvoice(db, invoiceId, {
    status: "Paid",
    paidAt: Date.now(),
  });
}

/**
 * Void an invoice (instead of deleting it).
 *
 * Per spec 11-workflow-invoice-generation.md line 444: "Void not delete" for finalized invoices.
 * Once finalized, invoices should never be deleted - they should be voided instead.
 *
 * @param db - Database writer
 * @param invoiceId - The invoice to void
 * @param voidedBy - User who is voiding the invoice
 * @param reason - Optional reason for voiding
 * @throws Error if invoice is Draft (can be deleted) or Paid (requires reversal)
 */
export async function voidInvoice(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">,
  voidedBy: Id<"users">,
  reason?: string
): Promise<void> {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId });
  }

  // Draft invoices can be deleted, no need to void
  if (invoice.status === "Draft") {
    throw new Error(
      "Draft invoices should be deleted, not voided. Use delete operation instead."
    );
  }

  // Already voided - no-op
  if (invoice.status === "Void") {
    return;
  }

  // Paid invoices require special handling (reversal/refund)
  if (invoice.status === "Paid") {
    throw new Error(
      "Cannot void a paid invoice directly. Record a refund or reversal first, then void."
    );
  }

  // Valid states for voiding: Finalized, Sent, Viewed
  await updateInvoice(db, invoiceId, {
    status: "Void",
    voidedAt: Date.now(),
    voidedBy,
    voidReason: reason,
  });
}

/**
 * Check if an invoice can be voided.
 *
 * @param invoice - The invoice to check
 * @returns true if the invoice can be voided
 */
export function canVoidInvoice(invoice: Doc<"invoices">): boolean {
  return (
    invoice.status === "Finalized" ||
    invoice.status === "Sent" ||
    invoice.status === "Viewed"
  );
}

// Invoice Line Items

export async function insertInvoiceLineItem(
  db: DatabaseWriter,
  lineItem: Omit<Doc<"invoiceLineItems">, "_id" | "_creationTime">
): Promise<Id<"invoiceLineItems">> {
  return await db.insert("invoiceLineItems", lineItem);
}

export async function getInvoiceLineItem(
  db: DatabaseReader,
  lineItemId: Id<"invoiceLineItems">
): Promise<Doc<"invoiceLineItems"> | null> {
  return await db.get(lineItemId);
}

export async function updateInvoiceLineItem(
  db: DatabaseWriter,
  lineItemId: Id<"invoiceLineItems">,
  updates: Partial<Omit<Doc<"invoiceLineItems">, "_id" | "_creationTime" | "invoiceId">>
): Promise<void> {
  const lineItem = await db.get(lineItemId);
  if (!lineItem) {
    throw new EntityNotFoundError("InvoiceLineItem", { lineItemId });
  }
  await db.patch(lineItemId, updates);
}

export async function deleteInvoiceLineItem(
  db: DatabaseWriter,
  lineItemId: Id<"invoiceLineItems">
): Promise<void> {
  await db.delete(lineItemId);
}

export async function listLineItemsByInvoice(
  db: DatabaseReader,
  invoiceId: Id<"invoices">
): Promise<Array<Doc<"invoiceLineItems">>> {
  return await db
    .query("invoiceLineItems")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
}

/**
 * Recalculate invoice totals from line items
 */
export async function recalculateInvoiceTotals(
  db: DatabaseWriter,
  invoiceId: Id<"invoices">,
  taxRate = 0 // e.g., 0.1 for 10%
): Promise<{ subtotal: number; tax: number; total: number }> {
  const lineItems = await listLineItemsByInvoice(db, invoiceId);
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;

  await updateInvoice(db, invoiceId, { subtotal, tax, total });

  return { subtotal, tax, total };
}

// Payments

export async function insertPayment(
  db: DatabaseWriter,
  payment: Omit<Doc<"payments">, "_id" | "_creationTime">
): Promise<Id<"payments">> {
  return await db.insert("payments", payment);
}

export async function getPayment(
  db: DatabaseReader,
  paymentId: Id<"payments">
): Promise<Doc<"payments"> | null> {
  return await db.get(paymentId);
}

export async function updatePayment(
  db: DatabaseWriter,
  paymentId: Id<"payments">,
  updates: Partial<Omit<Doc<"payments">, "_id" | "_creationTime" | "organizationId" | "invoiceId">>
): Promise<void> {
  const payment = await db.get(paymentId);
  if (!payment) {
    throw new EntityNotFoundError("Payment", { paymentId });
  }
  await db.patch(paymentId, updates);
}

export async function listPaymentsByInvoice(
  db: DatabaseReader,
  invoiceId: Id<"invoices">
): Promise<Array<Doc<"payments">>> {
  return await db
    .query("payments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
}

/**
 * Calculate total payments for an invoice
 */
export async function calculateInvoicePayments(
  db: DatabaseReader,
  invoiceId: Id<"invoices">
): Promise<number> {
  const payments = await listPaymentsByInvoice(db, invoiceId);
  return payments.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Calculate total invoiced amount for a project (non-voided invoices only).
 * Per spec task-invoicefixedfee.md line 30: "Amount must be > 0 and within remaining budget"
 */
export async function calculateProjectInvoicedAmount(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<number> {
  const invoices = await listInvoicesByProject(db, projectId);
  // Sum totals of all non-voided invoices
  return invoices
    .filter((inv) => inv.status !== "Void")
    .reduce((sum, inv) => sum + inv.total, 0);
}

/**
 * Record a payment and mark invoice paid if fully paid.
 * Returns overpayment amount for UI display (per spec task-recordpayment.md).
 */
export async function recordPaymentAndCheckPaid(
  db: DatabaseWriter,
  payment: Omit<Doc<"payments">, "_id" | "_creationTime">
): Promise<{ paymentId: Id<"payments">; isPaid: boolean; overpaymentAmount: number }> {
  const invoice = await getInvoice(db, payment.invoiceId);
  if (!invoice) {
    throw new EntityNotFoundError("Invoice", { invoiceId: payment.invoiceId });
  }

  // Calculate overpayment before inserting new payment
  const existingPayments = await calculateInvoicePayments(db, payment.invoiceId);
  const remaining = invoice.total - existingPayments;
  const overpaymentAmount = Math.max(0, payment.amount - remaining);

  const paymentId = await insertPayment(db, payment);

  const totalPayments = await calculateInvoicePayments(db, payment.invoiceId);
  const isPaid = totalPayments >= invoice.total;

  if (isPaid) {
    await markInvoicePaid(db, payment.invoiceId);
  }

  return { paymentId, isPaid, overpaymentAmount };
}
