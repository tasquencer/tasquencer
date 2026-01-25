/**
 * Exception types and assertion functions for the deal-to-delivery workflow.
 * Provides type-safe assertions for validating entity existence and state.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import {
  ConstraintViolationError,
  DataIntegrityError,
} from "@repo/tasquencer";

// =============================================================================
// ASSERTION FUNCTIONS
// =============================================================================

export function assertOrganizationExists(
  org: Doc<"organizations"> | null | undefined,
  context: { organizationId?: Id<"organizations"> } = {}
): asserts org is Doc<"organizations"> {
  if (!org) {
    throw new DataIntegrityError("ORGANIZATION_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertUserExists(
  user: Doc<"users"> | null | undefined,
  context: { userId?: Id<"users"> } = {}
): asserts user is Doc<"users"> {
  if (!user) {
    throw new DataIntegrityError("USER_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertCompanyExists(
  company: Doc<"companies"> | null | undefined,
  context: { companyId?: Id<"companies"> } = {}
): asserts company is Doc<"companies"> {
  if (!company) {
    throw new DataIntegrityError("COMPANY_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertContactExists(
  contact: Doc<"contacts"> | null | undefined,
  context: { contactId?: Id<"contacts"> } = {}
): asserts contact is Doc<"contacts"> {
  if (!contact) {
    throw new DataIntegrityError("CONTACT_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertDealExists(
  deal: Doc<"deals"> | null | undefined,
  context: { dealId?: Id<"deals">; workflowId?: Id<"tasquencerWorkflows"> } = {}
): asserts deal is Doc<"deals"> {
  if (!deal) {
    throw new DataIntegrityError("DEAL_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertEstimateExists(
  estimate: Doc<"estimates"> | null | undefined,
  context: { estimateId?: Id<"estimates">; dealId?: Id<"deals"> } = {}
): asserts estimate is Doc<"estimates"> {
  if (!estimate) {
    throw new DataIntegrityError("ESTIMATE_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertProposalExists(
  proposal: Doc<"proposals"> | null | undefined,
  context: { proposalId?: Id<"proposals">; dealId?: Id<"deals"> } = {}
): asserts proposal is Doc<"proposals"> {
  if (!proposal) {
    throw new DataIntegrityError("PROPOSAL_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertProjectExists(
  project: Doc<"projects"> | null | undefined,
  context: { projectId?: Id<"projects">; workflowId?: Id<"tasquencerWorkflows"> } = {}
): asserts project is Doc<"projects"> {
  if (!project) {
    throw new DataIntegrityError("PROJECT_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertBudgetExists(
  budget: Doc<"budgets"> | null | undefined,
  context: { budgetId?: Id<"budgets">; projectId?: Id<"projects"> } = {}
): asserts budget is Doc<"budgets"> {
  if (!budget) {
    throw new DataIntegrityError("BUDGET_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertTaskExists(
  task: Doc<"tasks"> | null | undefined,
  context: { taskId?: Id<"tasks">; projectId?: Id<"projects"> } = {}
): asserts task is Doc<"tasks"> {
  if (!task) {
    throw new DataIntegrityError("TASK_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertBookingExists(
  booking: Doc<"bookings"> | null | undefined,
  context: { bookingId?: Id<"bookings"> } = {}
): asserts booking is Doc<"bookings"> {
  if (!booking) {
    throw new DataIntegrityError("BOOKING_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertTimeEntryExists(
  entry: Doc<"timeEntries"> | null | undefined,
  context: { timeEntryId?: Id<"timeEntries"> } = {}
): asserts entry is Doc<"timeEntries"> {
  if (!entry) {
    throw new DataIntegrityError("TIME_ENTRY_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertExpenseExists(
  expense: Doc<"expenses"> | null | undefined,
  context: { expenseId?: Id<"expenses"> } = {}
): asserts expense is Doc<"expenses"> {
  if (!expense) {
    throw new DataIntegrityError("EXPENSE_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertInvoiceExists(
  invoice: Doc<"invoices"> | null | undefined,
  context: { invoiceId?: Id<"invoices"> } = {}
): asserts invoice is Doc<"invoices"> {
  if (!invoice) {
    throw new DataIntegrityError("INVOICE_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertPaymentExists(
  payment: Doc<"payments"> | null | undefined,
  context: { paymentId?: Id<"payments"> } = {}
): asserts payment is Doc<"payments"> {
  if (!payment) {
    throw new DataIntegrityError("PAYMENT_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertChangeOrderExists(
  changeOrder: Doc<"changeOrders"> | null | undefined,
  context: { changeOrderId?: Id<"changeOrders"> } = {}
): asserts changeOrder is Doc<"changeOrders"> {
  if (!changeOrder) {
    throw new DataIntegrityError("CHANGE_ORDER_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertMilestoneExists(
  milestone: Doc<"milestones"> | null | undefined,
  context: { milestoneId?: Id<"milestones"> } = {}
): asserts milestone is Doc<"milestones"> {
  if (!milestone) {
    throw new DataIntegrityError("MILESTONE_NOT_FOUND", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

// =============================================================================
// STATE VALIDATION ASSERTIONS
// =============================================================================

export function assertAuthenticatedUser<T>(
  authUser: T | null | undefined,
  context: { operation?: string; workItemId?: Id<"tasquencerWorkItems"> } = {}
): asserts authUser is T {
  if (!authUser) {
    throw new ConstraintViolationError("AUTHENTICATION_REQUIRED", {
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertDealMatches(
  actualDealId: Id<"deals">,
  expectedDealId: Id<"deals">,
  context: { stage?: string; workItemId?: Id<"tasquencerWorkItems"> } = {}
): void {
  if (actualDealId !== expectedDealId) {
    const stageSuffix =
      context.stage && context.stage.trim().length > 0
        ? ` in ${context.stage} task`
        : "";
    throw new DataIntegrityError(`Deal mismatch${stageSuffix}`, {
      actualDealId,
      expectedDealId,
      workflow: "dealToDelivery",
      ...(context.stage ? { stage: context.stage } : {}),
    });
  }
}

export function assertProjectMatches(
  actualProjectId: Id<"projects">,
  expectedProjectId: Id<"projects">,
  context: { phase?: string } = {}
): void {
  if (actualProjectId !== expectedProjectId) {
    const phaseSuffix =
      context.phase && context.phase.trim().length > 0
        ? ` in ${context.phase} phase`
        : "";
    throw new DataIntegrityError(`Project mismatch${phaseSuffix}`, {
      actualProjectId,
      expectedProjectId,
      workflow: "dealToDelivery",
      ...(context.phase ? { phase: context.phase } : {}),
    });
  }
}

export function assertDealStage(
  deal: Doc<"deals">,
  expectedStages: Array<Doc<"deals">["stage"]>,
  context: { operation?: string } = {}
): void {
  if (!expectedStages.includes(deal.stage)) {
    throw new ConstraintViolationError("INVALID_DEAL_STAGE", {
      actualStage: deal.stage,
      expectedStages,
      dealId: deal._id,
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertProjectStatus(
  project: Doc<"projects">,
  expectedStatuses: Array<Doc<"projects">["status"]>,
  context: { operation?: string } = {}
): void {
  if (!expectedStatuses.includes(project.status)) {
    throw new ConstraintViolationError("INVALID_PROJECT_STATUS", {
      actualStatus: project.status,
      expectedStatuses,
      projectId: project._id,
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertTimeEntryStatus(
  entry: Doc<"timeEntries">,
  expectedStatuses: Array<Doc<"timeEntries">["status"]>,
  context: { operation?: string } = {}
): void {
  if (!expectedStatuses.includes(entry.status)) {
    throw new ConstraintViolationError("INVALID_TIME_ENTRY_STATUS", {
      actualStatus: entry.status,
      expectedStatuses,
      timeEntryId: entry._id,
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertExpenseStatus(
  expense: Doc<"expenses">,
  expectedStatuses: Array<Doc<"expenses">["status"]>,
  context: { operation?: string } = {}
): void {
  if (!expectedStatuses.includes(expense.status)) {
    throw new ConstraintViolationError("INVALID_EXPENSE_STATUS", {
      actualStatus: expense.status,
      expectedStatuses,
      expenseId: expense._id,
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertInvoiceStatus(
  invoice: Doc<"invoices">,
  expectedStatuses: Array<Doc<"invoices">["status"]>,
  context: { operation?: string } = {}
): void {
  if (!expectedStatuses.includes(invoice.status)) {
    throw new ConstraintViolationError("INVALID_INVOICE_STATUS", {
      actualStatus: invoice.status,
      expectedStatuses,
      invoiceId: invoice._id,
      workflow: "dealToDelivery",
      ...context,
    });
  }
}

export function assertInvoiceEditable(
  invoice: Doc<"invoices">,
  context: { operation?: string } = {}
): void {
  if (invoice.status !== "Draft") {
    throw new ConstraintViolationError("INVOICE_NOT_EDITABLE", {
      invoiceId: invoice._id,
      status: invoice.status,
      workflow: "dealToDelivery",
      reason: "Only draft invoices can be edited",
      ...context,
    });
  }
}
