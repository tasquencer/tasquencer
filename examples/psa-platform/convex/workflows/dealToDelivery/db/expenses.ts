/**
 * Database functions for expenses
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type ExpenseType = Doc<"expenses">["type"];
export type ExpenseStatus = Doc<"expenses">["status"];

export async function insertExpense(
  db: DatabaseWriter,
  expense: Omit<Doc<"expenses">, "_id" | "_creationTime">
): Promise<Id<"expenses">> {
  return await db.insert("expenses", expense);
}

export async function getExpense(
  db: DatabaseReader,
  expenseId: Id<"expenses">
): Promise<Doc<"expenses"> | null> {
  return await db.get(expenseId);
}

export async function updateExpenseStatus(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  status: ExpenseStatus
): Promise<void> {
  const expense = await db.get(expenseId);
  if (!expense) {
    throw new EntityNotFoundError("Expense", { expenseId });
  }
  await db.patch(expenseId, { status });
}

export async function updateExpense(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  updates: Partial<Omit<Doc<"expenses">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const expense = await db.get(expenseId);
  if (!expense) {
    throw new EntityNotFoundError("Expense", { expenseId });
  }
  await db.patch(expenseId, updates);
}

export async function deleteExpense(
  db: DatabaseWriter,
  expenseId: Id<"expenses">
): Promise<void> {
  await db.delete(expenseId);
}

export async function listExpensesByUser(
  db: DatabaseReader,
  userId: Id<"users">,
  limit = 100
): Promise<Array<Doc<"expenses">>> {
  return await db
    .query("expenses")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function listExpensesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"expenses">>> {
  return await db
    .query("expenses")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .order("desc")
    .take(limit);
}

export async function listExpensesByStatus(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  status: ExpenseStatus,
  limit = 100
): Promise<Array<Doc<"expenses">>> {
  return await db
    .query("expenses")
    .withIndex("by_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export async function listSubmittedExpensesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 100
): Promise<Array<Doc<"expenses">>> {
  const expenses = await listExpensesByProject(db, projectId, limit);
  return expenses.filter((e) => e.status === "Submitted");
}

export async function listApprovedExpensesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"expenses">>> {
  const expenses = await listExpensesByProject(db, projectId, limit);
  return expenses.filter((e) => e.status === "Approved");
}

export async function listBillableUninvoicedExpenses(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 500
): Promise<Array<Doc<"expenses">>> {
  const expenses = await listExpensesByProject(db, projectId, limit);
  return expenses.filter(
    (e) => e.billable && e.status === "Approved" && !e.invoiceId
  );
}

export async function approveExpense(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  approverId: Id<"users">
): Promise<void> {
  await updateExpense(db, expenseId, {
    status: "Approved",
    approvedBy: approverId,
    approvedAt: Date.now(),
    rejectionComments: undefined,
  });
}

export async function rejectExpense(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  comments: string
): Promise<void> {
  await updateExpense(db, expenseId, {
    status: "Rejected",
    rejectionComments: comments,
  });
}

/**
 * Reject an expense with revision cycle tracking.
 * Increments the revision count and sets escalation flag if limit reached.
 * Per spec 10-workflow-expense-approval.md line 288: "After 3 revision cycles, escalate to admin"
 */
export async function rejectExpenseWithRevisionTracking(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  comments: string,
  issues?: Array<{ type: string; details: string }>,
  maxRevisionCycles: number = 3
): Promise<{ newRevisionCount: number; escalated: boolean }> {
  const expense = await db.get(expenseId);
  if (!expense) {
    throw new EntityNotFoundError("Expense", { expenseId });
  }

  const currentCount = expense.revisionCount ?? 0;
  const newRevisionCount = currentCount + 1;
  const escalated = newRevisionCount >= maxRevisionCycles;

  await db.patch(expenseId, {
    status: "Rejected",
    rejectionComments: comments,
    rejectionIssues: issues,
    rejectedAt: Date.now(),
    revisionCount: newRevisionCount,
    escalatedToAdmin: escalated,
  });

  return { newRevisionCount, escalated };
}

export async function markExpenseInvoiced(
  db: DatabaseWriter,
  expenseId: Id<"expenses">,
  invoiceId: Id<"invoices">
): Promise<void> {
  await updateExpense(db, expenseId, { invoiceId });
}

/**
 * Calculate total expenses for a project
 */
export async function calculateProjectExpenses(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<{ total: number; billable: number; approved: number }> {
  const expenses = await listExpensesByProject(db, projectId);

  let total = 0;
  let billable = 0;
  let approved = 0;

  for (const expense of expenses) {
    total += expense.amount;
    if (expense.billable) {
      const billableAmount = expense.markupRate
        ? expense.amount * expense.markupRate
        : expense.amount;
      billable += billableAmount;
    }
    if (expense.status === "Approved") {
      approved += expense.amount;
    }
  }

  return { total, billable, approved };
}
