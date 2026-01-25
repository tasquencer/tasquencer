/**
 * Database functions for projects
 *
 * Includes project closure verification per spec 13-workflow-close-phase.md
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";
import { helpers } from "../../../tasquencer";
import { listTasksByProject } from "./tasks";
import { listTimeEntriesByProject } from "./timeEntries";
import { listExpensesByProject } from "./expenses";
import { listInvoicesByProject, calculateInvoicePayments } from "./invoices";
import { listBookingsByProject, deleteBooking } from "./bookings";
import { getBudgetByProjectId } from "./budgets";
import { getUser } from "./users";

export type ProjectStatus = Doc<"projects">["status"];

export async function insertProject(
  db: DatabaseWriter,
  project: Omit<Doc<"projects">, "_id" | "_creationTime">
): Promise<Id<"projects">> {
  return await db.insert("projects", project);
}

export async function getProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Doc<"projects"> | null> {
  return await db.get(projectId);
}

export async function getProjectByWorkflowId(
  db: DatabaseReader,
  workflowId: Id<"tasquencerWorkflows">
): Promise<Doc<"projects"> | null> {
  const rootWorkflowId = await helpers.getRootWorkflowId(db, workflowId);
  return await db
    .query("projects")
    .withIndex("by_workflow_id", (q) => q.eq("workflowId", rootWorkflowId))
    .unique();
}

export async function getProjectByDealId(
  db: DatabaseReader,
  dealId: Id<"deals">
): Promise<Doc<"projects"> | null> {
  // Projects might not have an index by dealId in all cases
  const projects = await db.query("projects").collect();
  return projects.find((p) => p.dealId === dealId) ?? null;
}

export async function updateProjectStatus(
  db: DatabaseWriter,
  projectId: Id<"projects">,
  status: ProjectStatus
): Promise<void> {
  const project = await db.get(projectId);
  if (!project) {
    throw new EntityNotFoundError("Project", { projectId });
  }
  await db.patch(projectId, { status });
}

export async function updateProject(
  db: DatabaseWriter,
  projectId: Id<"projects">,
  updates: Partial<Omit<Doc<"projects">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const project = await db.get(projectId);
  if (!project) {
    throw new EntityNotFoundError("Project", { projectId });
  }
  await db.patch(projectId, updates);
}

export async function listProjectsByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 50
): Promise<Array<Doc<"projects">>> {
  return await db
    .query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(limit);
}

export async function listProjectsByStatus(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  status: ProjectStatus,
  limit = 50
): Promise<Array<Doc<"projects">>> {
  return await db
    .query("projects")
    .withIndex("by_status", (q) =>
      q.eq("organizationId", organizationId).eq("status", status)
    )
    .order("desc")
    .take(limit);
}

export async function listProjectsByManager(
  db: DatabaseReader,
  managerId: Id<"users">,
  limit = 50
): Promise<Array<Doc<"projects">>> {
  return await db
    .query("projects")
    .withIndex("by_manager", (q) => q.eq("managerId", managerId))
    .order("desc")
    .take(limit);
}

export async function listProjectsByCompany(
  db: DatabaseReader,
  companyId: Id<"companies">,
  limit = 50
): Promise<Array<Doc<"projects">>> {
  return await db
    .query("projects")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(limit);
}

// =============================================================================
// Project Closure Verification (spec 13-workflow-close-phase.md lines 204-217)
// =============================================================================

/**
 * Project closure checklist result
 */
export interface ProjectClosureChecklist {
  /** All tasks completed or cancelled */
  allTasksComplete: boolean;
  incompleteTasks: number;

  /** All time entries approved (no Draft or Submitted) */
  allTimeEntriesApproved: boolean;
  unapprovedTimeEntries: number;

  /** All expenses approved (no Draft or Submitted) */
  allExpensesApproved: boolean;
  unapprovedExpenses: number;

  /** All billable items invoiced */
  allItemsInvoiced: boolean;
  uninvoicedTimeEntries: number;
  uninvoicedExpenses: number;

  /** All invoices paid (or marked uncollectible/void) */
  allInvoicesPaid: boolean;
  unpaidInvoices: number;
  unpaidAmount: number;

  /** Future bookings count (to be cancelled) */
  futureBookings: number;

  /** Overall closure eligibility */
  canClose: boolean;
  warnings: string[];
}

/**
 * Get project closure checklist status
 *
 * Verifies all closure criteria per spec 13-workflow-close-phase.md:
 * - All tasks completed or cancelled
 * - All time entries approved
 * - All expenses approved
 * - All billable items invoiced
 * - All invoices paid (or waived)
 *
 * @param db Database reader
 * @param projectId Project to check
 * @returns Closure checklist with status of each criterion
 */
export async function getProjectClosureChecklist(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<ProjectClosureChecklist> {
  const warnings: string[] = [];
  const now = Date.now();

  // 1. Check tasks - must be Done or OnHold (no longer active)
  // Per schema: taskStatus = Todo | InProgress | Review | Done | OnHold
  // "Done" = completed, "OnHold" = effectively cancelled/deferred
  const tasks = await listTasksByProject(db, projectId);
  const incompleteTasks = tasks.filter(
    (t) => t.status !== "Done" && t.status !== "OnHold"
  );
  const allTasksComplete = incompleteTasks.length === 0;
  if (!allTasksComplete) {
    warnings.push(`${incompleteTasks.length} task(s) not done or on hold`);
  }

  // 2. Check time entries - must be Approved or Locked
  const timeEntries = await listTimeEntriesByProject(db, projectId);
  const unapprovedTimeEntries = timeEntries.filter(
    (t) => t.status === "Draft" || t.status === "Submitted" || t.status === "Rejected"
  );
  const allTimeEntriesApproved = unapprovedTimeEntries.length === 0;
  if (!allTimeEntriesApproved) {
    warnings.push(`${unapprovedTimeEntries.length} time entry(ies) not approved`);
  }

  // 3. Check expenses - must be Approved
  const expenses = await listExpensesByProject(db, projectId);
  const unapprovedExpenses = expenses.filter(
    (e) => e.status === "Draft" || e.status === "Submitted" || e.status === "Rejected"
  );
  const allExpensesApproved = unapprovedExpenses.length === 0;
  if (!allExpensesApproved) {
    warnings.push(`${unapprovedExpenses.length} expense(s) not approved`);
  }

  // 4. Check billable items invoiced
  const uninvoicedTimeEntryList = timeEntries.filter(
    (t) => t.billable && (t.status === "Approved" || t.status === "Locked") && !t.invoiceId
  );
  const uninvoicedExpenseList = expenses.filter(
    (e) => e.billable && e.status === "Approved" && !e.invoiceId
  );
  const allItemsInvoiced =
    uninvoicedTimeEntryList.length === 0 && uninvoicedExpenseList.length === 0;
  if (!allItemsInvoiced) {
    const totalUninvoiced = uninvoicedTimeEntryList.length + uninvoicedExpenseList.length;
    warnings.push(`${totalUninvoiced} billable item(s) not invoiced`);
  }

  // 5. Check invoices paid (Paid, Void, or uncollectible status = Void)
  const invoices = await listInvoicesByProject(db, projectId);
  const unpaidInvoiceList = invoices.filter(
    (i) => i.status !== "Paid" && i.status !== "Void" && i.status !== "Draft"
  );
  const allInvoicesPaid = unpaidInvoiceList.length === 0;
  let unpaidAmount = 0;
  for (const invoice of unpaidInvoiceList) {
    const paid = await calculateInvoicePayments(db, invoice._id);
    unpaidAmount += invoice.total - paid;
  }
  if (!allInvoicesPaid) {
    const amountStr = (unpaidAmount / 100).toFixed(2);
    warnings.push(`${unpaidInvoiceList.length} invoice(s) unpaid ($${amountStr} outstanding)`);
  }

  // 6. Check future bookings (to be cancelled on close)
  const bookings = await listBookingsByProject(db, projectId);
  const futureBookingList = bookings.filter((b) => b.endDate > now);

  // Determine if project can close
  // Per spec: Can close with unpaid invoices but requires acknowledgment
  // Hard blockers: unapproved time/expenses
  const canClose = allTasksComplete && allTimeEntriesApproved && allExpensesApproved;

  return {
    allTasksComplete,
    incompleteTasks: incompleteTasks.length,
    allTimeEntriesApproved,
    unapprovedTimeEntries: unapprovedTimeEntries.length,
    allExpensesApproved,
    unapprovedExpenses: unapprovedExpenses.length,
    allItemsInvoiced,
    uninvoicedTimeEntries: uninvoicedTimeEntryList.length,
    uninvoicedExpenses: uninvoicedExpenseList.length,
    allInvoicesPaid,
    unpaidInvoices: unpaidInvoiceList.length,
    unpaidAmount,
    futureBookings: futureBookingList.length,
    canClose,
    warnings,
  };
}

/**
 * Project metrics calculated at closure
 */
export interface ProjectMetrics {
  /** Total revenue from invoices (excluding Void) */
  totalRevenue: number;
  /** Total cost = time cost + expense cost */
  totalCost: number;
  /** Time cost using internal cost rates */
  timeCost: number;
  /** Expense cost */
  expenseCost: number;
  /** Profit = revenue - cost */
  profit: number;
  /** Profit margin = profit / revenue * 100 */
  profitMargin: number;
  /** Budget variance = totalCost / budgetAmount * 100 */
  budgetVariance: number;
  /** Actual duration in days */
  durationDays: number;
  /** Planned duration in days (if available) */
  plannedDurationDays: number | null;
  /** Total hours logged */
  totalHours: number;
  /** Total billable hours */
  billableHours: number;
}

/**
 * Calculate final project metrics
 *
 * Per spec 13-workflow-close-phase.md lines 222-253
 *
 * @param db Database reader
 * @param projectId Project to calculate metrics for
 * @param closeDate Official close date
 * @returns Project metrics
 */
export async function calculateProjectMetrics(
  db: DatabaseReader,
  projectId: Id<"projects">,
  closeDate: number
): Promise<ProjectMetrics> {
  const project = await getProject(db, projectId);
  if (!project) {
    throw new EntityNotFoundError("Project", { projectId });
  }

  // Get budget for variance calculation
  const budget = await getBudgetByProjectId(db, projectId);
  const budgetAmount = budget?.totalAmount ?? 0;

  // Calculate revenue from invoices (exclude Void and Draft)
  const invoices = await listInvoicesByProject(db, projectId);
  const totalRevenue = invoices
    .filter((i) => i.status !== "Void" && i.status !== "Draft")
    .reduce((sum, i) => sum + i.total, 0);

  // Calculate time cost using internal cost rates from user records
  const timeEntries = await listTimeEntriesByProject(db, projectId);
  let timeCost = 0;
  let totalHours = 0;
  let billableHours = 0;

  // Cache user cost rates to avoid repeated lookups
  const userCostRates = new Map<string, number>();

  for (const entry of timeEntries) {
    // Get cost rate from user record
    let costRate = userCostRates.get(entry.userId);
    if (costRate === undefined) {
      const user = await getUser(db, entry.userId);
      costRate = user?.costRate ?? 0;
      userCostRates.set(entry.userId, costRate);
    }
    timeCost += entry.hours * costRate;
    totalHours += entry.hours;
    if (entry.billable) {
      billableHours += entry.hours;
    }
  }

  // Calculate expense cost
  const expenses = await listExpensesByProject(db, projectId);
  const expenseCost = expenses
    .filter((e) => e.status === "Approved")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalCost = timeCost + expenseCost;
  const profit = totalRevenue - totalCost;
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
  const budgetVariance = budgetAmount > 0 ? (totalCost / budgetAmount) * 100 : 0;

  // Calculate duration - use Math.round for accurate day counting
  // Per spec 13 line 248-252: plannedEndDate is the original planned end for variance calculation
  const startDate = project.startDate;
  const durationDays = Math.round((closeDate - startDate) / (24 * 60 * 60 * 1000));
  // Prefer plannedEndDate (original plan) over endDate (current/actual) for variance calculation
  const planEndDate = project.plannedEndDate ?? project.endDate;
  const plannedDurationDays = planEndDate
    ? Math.round((planEndDate - startDate) / (24 * 60 * 60 * 1000))
    : null;

  return {
    totalRevenue,
    totalCost,
    timeCost,
    expenseCost,
    profit,
    profitMargin: Math.round(profitMargin * 100) / 100, // Round to 2 decimals
    budgetVariance: Math.round(budgetVariance * 100) / 100,
    durationDays,
    plannedDurationDays,
    totalHours,
    billableHours,
  };
}

/**
 * Cancel all future bookings for a project
 *
 * Per spec 13-workflow-close-phase.md: "Cancel pending bookings"
 *
 * @param db Database writer
 * @param projectId Project to cancel bookings for
 * @returns Number of bookings cancelled
 */
export async function cancelFutureBookings(
  db: DatabaseWriter,
  projectId: Id<"projects">
): Promise<number> {
  const now = Date.now();
  const bookings = await listBookingsByProject(db, projectId);
  const futureBookings = bookings.filter((b) => b.endDate > now);

  for (const booking of futureBookings) {
    await deleteBooking(db, booking._id);
  }

  return futureBookings.length;
}

/**
 * Create an immutable project metrics snapshot at project closure
 *
 * Per spec 13-workflow-close-phase.md line 273:
 * "Metrics Snapshot: Final metrics captured at close, immutable"
 *
 * This creates a permanent record of project financial and time metrics
 * that cannot be modified after creation.
 *
 * @param db Database writer
 * @param projectId Project to snapshot
 * @param closedBy User who closed the project
 * @param closeDate Official close date
 * @returns ID of the created metrics snapshot
 */
export async function createProjectMetricsSnapshot(
  db: DatabaseWriter,
  projectId: Id<"projects">,
  closedBy: Id<"users">,
  closeDate: number
): Promise<Id<"projectMetrics">> {
  const project = await getProject(db, projectId);
  if (!project) {
    throw new EntityNotFoundError("Project", { projectId });
  }

  // Check if snapshot already exists (idempotent - don't create duplicate)
  const existing = await getProjectMetricsSnapshot(db, projectId);
  if (existing) {
    // Return existing snapshot ID rather than creating duplicate
    return existing._id;
  }

  // Calculate the metrics
  const metrics = await calculateProjectMetrics(db, projectId, closeDate);

  // Get budget for reference
  const budget = await getBudgetByProjectId(db, projectId);
  const budgetTotal = budget?.totalAmount ?? 0;

  // Create the immutable snapshot
  const snapshotId = await db.insert("projectMetrics", {
    projectId,
    organizationId: project.organizationId,
    snapshotDate: closeDate,
    closedBy,
    totalRevenue: metrics.totalRevenue,
    totalCost: metrics.totalCost,
    timeCost: metrics.timeCost,
    expenseCost: metrics.expenseCost,
    profit: metrics.profit,
    profitMargin: metrics.profitMargin,
    budgetVariance: metrics.budgetVariance,
    durationDays: metrics.durationDays,
    plannedDurationDays: metrics.plannedDurationDays ?? undefined,
    totalHours: metrics.totalHours,
    billableHours: metrics.billableHours,
    budgetTotal,
    createdAt: Date.now(),
  });

  return snapshotId;
}

/**
 * Get the project metrics snapshot for a project
 *
 * @param db Database reader
 * @param projectId Project to get metrics for
 * @returns The metrics snapshot if exists, null otherwise
 */
export async function getProjectMetricsSnapshot(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Doc<"projectMetrics"> | null> {
  return await db
    .query("projectMetrics")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

/**
 * List all project metrics snapshots for an organization
 *
 * Useful for reporting on closed project performance
 *
 * @param db Database reader
 * @param organizationId Organization to list metrics for
 * @param limit Maximum number to return
 * @returns Array of project metrics snapshots
 */
export async function listProjectMetricsByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 100
): Promise<Array<Doc<"projectMetrics">>> {
  return await db
    .query("projectMetrics")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(limit);
}
