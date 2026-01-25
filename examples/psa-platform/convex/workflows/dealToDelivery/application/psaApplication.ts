/**
 * PSA Application Layer
 *
 * Orchestration functions that combine domain layer operations with workflow context.
 * These are called by work item action handlers and provide the business logic
 * while keeping work items focused on workflow coordination.
 *
 * Reference: examples/er/convex/workflows/er/application/erApplication.ts
 * Reference: .review/recipes/psa-platform/specs/
 */
import { type DatabaseWriter } from "../../../_generated/server";
import { type Id, type Doc } from "../../../_generated/dataModel";
import {
  insertDeal,
  updateDeal,
  updateDealStage,
} from "../db/deals";
import {
  insertEstimate,
  getEstimate,
  insertEstimateService,
} from "../db/estimates";
import {
  insertProposal,
  getProposal,
  updateProposalStatus,
} from "../db/proposals";
import {
  insertProject,
  updateProject,
  updateProjectStatus,
} from "../db/projects";
import {
  insertBudget,
  updateBudget,
  getBudgetByProjectId,
  insertService,
} from "../db/budgets";
import {
  insertBooking,
  updateBooking,
} from "../db/bookings";
import {
  insertTask,
  updateTask,
  getTask,
} from "../db/tasks";
import {
  insertTimeEntry,
  updateTimeEntry,
  getTimeEntry,
} from "../db/timeEntries";
import {
  insertExpense,
  updateExpense,
  getExpense,
} from "../db/expenses";
import {
  insertInvoice,
  getInvoice,
  insertInvoiceLineItem,
  recalculateInvoiceTotals,
  recordPaymentAndCheckPaid,
} from "../db/invoices";
import {
  getRootWorkflowAndDealForWorkItem,
  getRootWorkflowAndProjectForWorkItem,
} from "../db/workItemContext";
import {
  assertEstimateExists,
  assertProposalExists,
  assertBudgetExists,
  assertTaskExists,
  assertTimeEntryExists,
  assertExpenseExists,
  assertInvoiceExists,
  assertDealMatches,
  assertProjectMatches,
} from "../exceptions";

// Type aliases for schema value types
type ProjectStatus = "Planning" | "Active" | "OnHold" | "Completed" | "Archived";
type BudgetType = "TimeAndMaterials" | "FixedFee" | "Retainer";
type TaskPriority = "Low" | "Medium" | "High" | "Urgent";
type InvoiceMethod = "TimeAndMaterials" | "FixedFee" | "Milestone" | "Recurring";
type ExpenseType = "Software" | "Travel" | "Materials" | "Subcontractor" | "Other";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get and verify deal for a work item.
 * Common pattern: fetch deal, verify it matches expected ID.
 */
async function getVerifiedDeal(
  db: DatabaseWriter,
  workItemId: Id<"tasquencerWorkItems">,
  expectedDealId: Id<"deals">,
  stage: string
): Promise<{
  deal: Doc<"deals">;
  rootWorkflowId: Id<"tasquencerWorkflows">;
}> {
  const { deal, rootWorkflowId } = await getRootWorkflowAndDealForWorkItem(
    db,
    workItemId
  );

  assertDealMatches(deal._id, expectedDealId, {
    workItemId,
    stage,
  });

  return { deal, rootWorkflowId };
}

/**
 * Get and verify project for a work item.
 */
async function getVerifiedProject(
  db: DatabaseWriter,
  workItemId: Id<"tasquencerWorkItems">,
  expectedProjectId: Id<"projects">,
  phase: string
): Promise<{
  project: Doc<"projects">;
  rootWorkflowId: Id<"tasquencerWorkflows">;
}> {
  const { project, rootWorkflowId } = await getRootWorkflowAndProjectForWorkItem(
    db,
    workItemId
  );

  assertProjectMatches(project._id, expectedProjectId, {
    phase,
  });

  return { project, rootWorkflowId };
}

// ============================================================================
// Sales Phase Application Functions
// ============================================================================

export type InitializeDealPayload = {
  name: string;
  value: number;
  companyId: Id<"companies">;
  contactId: Id<"contacts">;
  ownerId: Id<"users">;
  organizationId: Id<"organizations">;
  probability?: number;
};

/**
 * Create a new deal with the workflow.
 * Called from the workflow's initialize action.
 */
export async function initializeDeal(
  db: DatabaseWriter,
  workflowId: Id<"tasquencerWorkflows">,
  payload: InitializeDealPayload
): Promise<Id<"deals">> {
  const dealId = await insertDeal(db, {
    name: payload.name,
    value: payload.value,
    stage: "Lead",
    probability: payload.probability ?? 10,
    companyId: payload.companyId,
    contactId: payload.contactId,
    ownerId: payload.ownerId,
    organizationId: payload.organizationId,
    workflowId,
    createdAt: Date.now(),
  });

  return dealId;
}

/**
 * Complete lead qualification - update deal to Qualified or Disqualified.
 */
export async function completeLeadQualification(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    qualified: boolean;
    budget?: number;
    authority?: string;
    need?: string;
    timeline?: string;
    disqualificationReason?: string;
  }
): Promise<void> {
  const { deal } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "qualifyLead"
  );

  if (args.qualified) {
    await updateDeal(db, deal._id, {
      stage: "Qualified",
      probability: 25,
    });
  } else {
    await updateDeal(db, deal._id, {
      stage: "Disqualified",
      probability: 0,
      lostReason: args.disqualificationReason,
    });
  }
}

/**
 * Create an estimate for a deal.
 */
export async function createEstimateForDeal(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    services: Array<{
      name: string;
      hours: number;
      rate: number;
    }>;
  }
): Promise<Id<"estimates">> {
  const { deal } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "createEstimate"
  );

  const total = args.services.reduce(
    (sum, s) => sum + s.hours * s.rate,
    0
  );

  const estimateId = await insertEstimate(db, {
    dealId: deal._id,
    organizationId: deal.organizationId,
    total,
    createdAt: Date.now(),
  });

  // Create estimate services
  for (const service of args.services) {
    await insertEstimateService(db, {
      estimateId,
      name: service.name,
      rate: service.rate,
      hours: service.hours,
      total: service.hours * service.rate,
    });
  }

  return estimateId;
}

/**
 * Create a proposal from an estimate.
 */
export async function createProposalFromEstimate(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    estimateId: Id<"estimates">;
    documentUrl: string;
  }
): Promise<Id<"proposals">> {
  const { deal } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "createProposal"
  );

  const estimate = await getEstimate(db, args.estimateId);
  assertEstimateExists(estimate, { estimateId: args.estimateId });

  // Get existing proposals for versioning
  const existingProposals = await db
    .query("proposals")
    .withIndex("by_deal", (q) => q.eq("dealId", deal._id))
    .collect();
  const version = existingProposals.length + 1;

  const proposalId = await insertProposal(db, {
    dealId: deal._id,
    organizationId: deal.organizationId,
    status: "Draft",
    version,
    documentUrl: args.documentUrl,
    createdAt: Date.now(),
  });

  // Update deal stage
  await updateDealStage(db, deal._id, "Proposal");

  return proposalId;
}

/**
 * Mark a proposal as sent.
 */
export async function sendProposal(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    proposalId: Id<"proposals">;
  }
): Promise<void> {
  await getVerifiedDeal(db, args.workItemId, args.dealId, "sendProposal");

  const proposal = await getProposal(db, args.proposalId);
  assertProposalExists(proposal, { proposalId: args.proposalId });

  await updateProposalStatus(db, args.proposalId, "Sent");
}

/**
 * Record negotiation response from client.
 * Note: "revision" response keeps proposal in "Sent" status for a new version to be created.
 */
export async function recordNegotiationResponse(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    proposalId: Id<"proposals">;
    response: "viewed" | "revision" | "rejected";
    feedback?: string;
  }
): Promise<void> {
  const { deal } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "negotiateTerms"
  );

  const proposal = await getProposal(db, args.proposalId);
  assertProposalExists(proposal, { proposalId: args.proposalId });

  if (args.response === "viewed") {
    await updateProposalStatus(db, args.proposalId, "Viewed");
    await updateDeal(db, deal._id, {
      stage: "Negotiation",
      probability: 75,
    });
  } else if (args.response === "revision") {
    // Keep proposal in current status, a new version will be created
    await updateProposalStatus(db, args.proposalId, "Viewed");
  } else {
    await updateProposalStatus(db, args.proposalId, "Rejected");
    await updateDeal(db, deal._id, {
      stage: "Lost",
      probability: 0,
      lostReason: args.feedback,
    });
  }
}

/**
 * Record proposal signature - deal won.
 */
export async function recordProposalSigned(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    proposalId: Id<"proposals">;
    signedAt: number;
  }
): Promise<void> {
  const { deal } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "getProposalSigned"
  );

  await updateProposalStatus(db, args.proposalId, "Signed");

  await updateDeal(db, deal._id, {
    stage: "Won",
    probability: 100,
    closedAt: args.signedAt,
  });
}

// ============================================================================
// Planning Phase Application Functions
// ============================================================================

/**
 * Create a project from a won deal.
 */
export async function initializeProject(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    dealId: Id<"deals">;
    name: string;
    startDate: number;
    endDate?: number;
    managerId: Id<"users">;
  }
): Promise<{
  projectId: Id<"projects">;
  budgetId: Id<"budgets">;
}> {
  const { deal, rootWorkflowId } = await getVerifiedDeal(
    db,
    args.workItemId,
    args.dealId,
    "createProject"
  );

  // Create the project
  const projectId = await insertProject(db, {
    name: args.name,
    dealId: deal._id,
    companyId: deal.companyId,
    organizationId: deal.organizationId,
    workflowId: rootWorkflowId,
    status: "Planning",
    startDate: args.startDate,
    endDate: args.endDate,
    managerId: args.managerId,
    createdAt: Date.now(),
  });

  // Create initial budget shell from deal value
  const budgetId = await insertBudget(db, {
    projectId,
    organizationId: deal.organizationId,
    type: "TimeAndMaterials", // Default, will be set in setBudget
    totalAmount: deal.value,
    createdAt: Date.now(),
  });

  return { projectId, budgetId };
}

/**
 * Set the budget type and services for a project.
 */
export async function setBudgetForProject(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    budgetType: BudgetType;
    services: Array<{
      name: string;
      hours: number;
      rate: number;
    }>;
  }
): Promise<void> {
  await getVerifiedProject(db, args.workItemId, args.projectId, "setBudget");

  const budget = await getBudgetByProjectId(db, args.projectId);
  assertBudgetExists(budget, { projectId: args.projectId });

  // Calculate totals from services
  const totalAmount = args.services.reduce(
    (sum, s) => sum + s.hours * s.rate,
    0
  );

  // Update budget
  await updateBudget(db, budget._id, {
    type: args.budgetType,
    totalAmount,
  });

  // Insert budget services
  for (const service of args.services) {
    await insertService(db, {
      budgetId: budget._id,
      organizationId: budget.organizationId,
      name: service.name,
      rate: service.rate,
      estimatedHours: service.hours,
      totalAmount: service.hours * service.rate,
    });
  }

  // Update project status to Active
  await updateProjectStatus(db, args.projectId, "Active");
}

// ============================================================================
// Resource Planning Application Functions
// ============================================================================

/**
 * Create a resource booking.
 */
export async function allocateResource(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    userId: Id<"users">;
    startDate: number;
    endDate: number;
    hoursPerDay: number;
    type: "Tentative" | "Confirmed";
    notes?: string;
  }
): Promise<Id<"bookings">> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "createBookings"
  );

  const bookingId = await insertBooking(db, {
    userId: args.userId,
    projectId: project._id,
    organizationId: project.organizationId,
    startDate: args.startDate,
    endDate: args.endDate,
    hoursPerDay: args.hoursPerDay,
    type: args.type,
    notes: args.notes,
    createdAt: Date.now(),
  });

  return bookingId;
}

/**
 * Confirm tentative bookings for a project.
 */
export async function confirmProjectBookings(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    bookingIds: Array<Id<"bookings">>;
  }
): Promise<void> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "confirmBookings"
  );

  for (const bookingId of args.bookingIds) {
    await updateBooking(db, bookingId, { type: "Confirmed" });
  }

  // Update project status to Active if still in Planning
  if (project.status === "Planning") {
    await updateProjectStatus(db, project._id, "Active");
  }
}

// ============================================================================
// Execution Phase Application Functions
// ============================================================================

/**
 * Create and assign a task.
 */
export async function assignTask(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    name: string;
    description: string;
    assigneeIds: Array<Id<"users">>;
    estimatedHours?: number;
    dueDate?: number;
    priority?: TaskPriority;
    parentTaskId?: Id<"tasks">;
  }
): Promise<Id<"tasks">> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "createAndAssignTasks"
  );

  const taskId = await insertTask(db, {
    projectId: project._id,
    organizationId: project.organizationId,
    name: args.name,
    description: args.description,
    status: "Todo",
    assigneeIds: args.assigneeIds,
    estimatedHours: args.estimatedHours,
    dueDate: args.dueDate,
    priority: args.priority ?? "Medium",
    parentTaskId: args.parentTaskId,
    dependencies: [],
    sortOrder: 0,
    createdAt: Date.now(),
  });

  return taskId;
}

/**
 * Mark a task as complete.
 */
export async function completeTask(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    taskId: Id<"tasks">;
  }
): Promise<void> {
  const task = await getTask(db, args.taskId);
  assertTaskExists(task, { taskId: args.taskId });

  await updateTask(db, args.taskId, {
    status: "Done",
  });
}

// ============================================================================
// Time Tracking Application Functions
// ============================================================================

/**
 * Submit a time entry.
 */
export async function submitTimeEntry(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    userId: Id<"users">;
    taskId?: Id<"tasks">;
    date: number;
    hours: number;
    notes?: string;
    billable?: boolean;
  }
): Promise<Id<"timeEntries">> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "submitTimeEntry"
  );

  const timeEntryId = await insertTimeEntry(db, {
    userId: args.userId,
    projectId: project._id,
    organizationId: project.organizationId,
    taskId: args.taskId,
    date: args.date,
    hours: args.hours,
    notes: args.notes,
    billable: args.billable ?? true,
    status: "Submitted",
    createdAt: Date.now(),
  });

  return timeEntryId;
}

/**
 * Approve timesheet entries.
 */
export async function approveTimesheet(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    timeEntryIds: Array<Id<"timeEntries">>;
    approverId: Id<"users">;
  }
): Promise<void> {
  for (const timeEntryId of args.timeEntryIds) {
    const entry = await getTimeEntry(db, timeEntryId);
    assertTimeEntryExists(entry, { timeEntryId });

    await updateTimeEntry(db, timeEntryId, {
      status: "Approved",
      approvedAt: Date.now(),
      approvedBy: args.approverId,
    });
  }
}

/**
 * Reject timesheet entries.
 */
export async function rejectTimesheet(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    timeEntryIds: Array<Id<"timeEntries">>;
    rejectionComments: string;
  }
): Promise<void> {
  for (const timeEntryId of args.timeEntryIds) {
    const entry = await getTimeEntry(db, timeEntryId);
    assertTimeEntryExists(entry, { timeEntryId });

    await updateTimeEntry(db, timeEntryId, {
      status: "Rejected",
      rejectionComments: args.rejectionComments,
    });
  }
}

// ============================================================================
// Expense Tracking Application Functions
// ============================================================================

/**
 * Submit an expense.
 */
export async function submitExpense(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    userId: Id<"users">;
    type: ExpenseType;
    amount: number;
    date: number;
    description: string;
    currency?: string;
    receiptUrl?: string;
    vendorInfo?: { name: string; taxId?: string };
    billable?: boolean;
  }
): Promise<Id<"expenses">> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "submitExpense"
  );

  const expenseId = await insertExpense(db, {
    userId: args.userId,
    projectId: project._id,
    organizationId: project.organizationId,
    type: args.type,
    amount: args.amount,
    currency: args.currency ?? "USD",
    date: args.date,
    description: args.description,
    receiptUrl: args.receiptUrl,
    vendorInfo: args.vendorInfo,
    billable: args.billable ?? true,
    status: "Submitted",
    createdAt: Date.now(),
  });

  return expenseId;
}

/**
 * Approve an expense.
 */
export async function approveExpense(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    expenseId: Id<"expenses">;
    approverId: Id<"users">;
    adjustedAmount?: number;
    adjustmentReason?: string;
  }
): Promise<void> {
  const expense = await getExpense(db, args.expenseId);
  assertExpenseExists(expense, { expenseId: args.expenseId });

  await updateExpense(db, args.expenseId, {
    status: "Approved",
    approvedAt: Date.now(),
    approvedBy: args.approverId,
    ...(args.adjustedAmount !== undefined && {
      amount: args.adjustedAmount,
    }),
  });
}

/**
 * Reject an expense.
 */
export async function rejectExpense(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    expenseId: Id<"expenses">;
    rejectionComments: string;
  }
): Promise<void> {
  const expense = await getExpense(db, args.expenseId);
  assertExpenseExists(expense, { expenseId: args.expenseId });

  await updateExpense(db, args.expenseId, {
    status: "Rejected",
    rejectionComments: args.rejectionComments,
  });
}

// ============================================================================
// Invoice Application Functions
// ============================================================================

/**
 * Generate an invoice from billable time entries and expenses.
 */
export async function generateInvoice(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    method: InvoiceMethod;
    dueDate: number;
    timeEntryIds?: Array<Id<"timeEntries">>;
    expenseIds?: Array<Id<"expenses">>;
    fixedAmount?: number;
  }
): Promise<Id<"invoices">> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "generateInvoice"
  );

  // Create the invoice
  const invoiceId = await insertInvoice(db, {
    projectId: project._id,
    companyId: project.companyId,
    organizationId: project.organizationId,
    status: "Draft",
    method: args.method,
    dueDate: args.dueDate,
    subtotal: 0,
    tax: 0,
    total: 0,
    createdAt: Date.now(),
  });

  let sortOrder = 0;

  // Add time entry line items (grouped)
  if (args.timeEntryIds && args.timeEntryIds.length > 0) {
    let totalHours = 0;
    let totalAmount = 0;
    const rate = 15000; // Default rate in cents, should be from budget services

    for (const timeEntryId of args.timeEntryIds) {
      const entry = await getTimeEntry(db, timeEntryId);
      if (entry && entry.billable) {
        totalHours += entry.hours;
        totalAmount += Math.round(entry.hours * rate);
        // Mark time entry as invoiced
        await updateTimeEntry(db, timeEntryId, { status: "Locked" });
      }
    }

    if (totalHours > 0) {
      await insertInvoiceLineItem(db, {
        invoiceId,
        description: `Professional Services: ${totalHours} hours`,
        quantity: totalHours,
        rate,
        amount: totalAmount,
        sortOrder: sortOrder++,
        timeEntryIds: args.timeEntryIds,
      });
    }
  }

  // Add expense line items (grouped)
  if (args.expenseIds && args.expenseIds.length > 0) {
    let totalExpenseAmount = 0;

    for (const expenseId of args.expenseIds) {
      const expense = await getExpense(db, expenseId);
      if (expense && expense.billable) {
        totalExpenseAmount += expense.amount;
      }
    }

    if (totalExpenseAmount > 0) {
      await insertInvoiceLineItem(db, {
        invoiceId,
        description: "Expenses",
        quantity: 1,
        rate: totalExpenseAmount,
        amount: totalExpenseAmount,
        sortOrder: sortOrder++,
        expenseIds: args.expenseIds,
      });
    }
  }

  // Add fixed amount if specified
  if (args.fixedAmount !== undefined) {
    await insertInvoiceLineItem(db, {
      invoiceId,
      description: args.method === "Milestone" ? "Milestone Payment" : "Fixed Fee",
      quantity: 1,
      rate: args.fixedAmount,
      amount: args.fixedAmount,
      sortOrder: sortOrder++,
    });
  }

  // Recalculate totals
  await recalculateInvoiceTotals(db, invoiceId);

  return invoiceId;
}

/**
 * Record a payment for an invoice.
 */
export async function recordPayment(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    invoiceId: Id<"invoices">;
    amount: number;
    method: string;
    reference?: string;
    paidAt: number;
  }
): Promise<{
  paymentId: Id<"payments">;
  isPaid: boolean;
}> {
  const invoice = await getInvoice(db, args.invoiceId);
  assertInvoiceExists(invoice, { invoiceId: args.invoiceId });

  const result = await recordPaymentAndCheckPaid(db, {
    invoiceId: args.invoiceId,
    organizationId: invoice.organizationId,
    amount: args.amount,
    method: args.method,
    reference: args.reference,
    date: args.paidAt,
    syncedToAccounting: false,
    createdAt: Date.now(),
  });

  return result;
}

// ============================================================================
// Close Phase Application Functions
// ============================================================================

/**
 * Close a project.
 */
export async function closeProject(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    closeDate: number;
    completionStatus: "completed" | "cancelled" | "on_hold_indefinitely";
    closureNotes?: string;
  }
): Promise<void> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "closeProject"
  );

  const statusMap: Record<typeof args.completionStatus, ProjectStatus> = {
    completed: "Completed",
    cancelled: "Archived",
    on_hold_indefinitely: "OnHold",
  };

  await updateProject(db, project._id, {
    status: statusMap[args.completionStatus],
    endDate: args.closeDate,
  });
}

/**
 * Record retrospective findings.
 */
export async function recordRetrospective(
  db: DatabaseWriter,
  args: {
    workItemId: Id<"tasquencerWorkItems">;
    projectId: Id<"projects">;
    successes: string[];
    improvements: string[];
    learnings: string[];
    recommendations: string[];
    clientSatisfaction?: number;
    teamFeedback?: string[];
  }
): Promise<void> {
  const { project } = await getVerifiedProject(
    db,
    args.workItemId,
    args.projectId,
    "conductRetro"
  );

  // In a full implementation, we'd store retrospective data in a separate table
  // For now, we update the project with completion metadata
  await updateProject(db, project._id, {
    // Could add fields like:
    // retroSuccesses: args.successes,
    // retroImprovements: args.improvements,
    // etc.
  });
}
