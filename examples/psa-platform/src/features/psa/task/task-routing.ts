import type { Id } from "@/convex/_generated/dataModel";

/**
 * Configuration for routing to task completion forms.
 * Maps task types to their dedicated route paths.
 *
 * TENET-UI-DOMAIN: Routes use domain IDs (dealId, projectId) not workItemId.
 * Workflow execution still uses workItemId internally.
 */
export type TaskRouteConfig = {
  /** The path pattern for the task form (e.g., "/deals/$dealId/qualify") */
  path: string;
  /** Whether the task has a dedicated completion form */
  hasForm: boolean;
  /** Domain ID type for routing: 'deal' for sales tasks, 'project' for project tasks */
  domainIdType: 'deal' | 'project';
};

/**
 * Map of task types to their routing configuration.
 * Tasks with dedicated completion forms are routed to those forms.
 * Tasks without forms are routed to their domain pages.
 *
 * TENET-UI-DOMAIN: Routes use domain IDs for user-friendly, bookmark-safe navigation.
 */
const TASK_ROUTES: Record<string, TaskRouteConfig> = {
  // Sales tasks with forms - use dealId
  qualifyLead: { path: "/deals/$dealId/qualify", hasForm: true, domainIdType: 'deal' },
  createEstimate: { path: "/deals/$dealId/estimate", hasForm: true, domainIdType: 'deal' },
  createProposal: { path: "/deals/$dealId/proposal", hasForm: true, domainIdType: 'deal' },
  reviseProposal: { path: "/deals/$dealId/revise-proposal", hasForm: true, domainIdType: 'deal' },
  sendProposal: { path: "/deals/$dealId/send-proposal", hasForm: true, domainIdType: 'deal' },
  negotiateTerms: { path: "/deals/$dealId/negotiate", hasForm: true, domainIdType: 'deal' },
  getProposalSigned: { path: "/deals/$dealId/sign", hasForm: true, domainIdType: 'deal' },
  createProject: { path: "/tasks/createproject", hasForm: true, domainIdType: 'deal' },

  // Planning/Resource/Close tasks with forms - use projectId
  setBudget: { path: "/tasks/setbudget", hasForm: true, domainIdType: 'project' },
  viewTeamAvailability: { path: "/tasks/viewteamavailability", hasForm: true, domainIdType: 'project' },
  filterBySkillsRole: { path: "/tasks/filterbyskillsrole", hasForm: true, domainIdType: 'project' },
  confirmBookings: { path: "/tasks/confirmbookings", hasForm: true, domainIdType: 'project' },
  closeProject: { path: "/tasks/closeproject", hasForm: true, domainIdType: 'project' },
  conductRetro: { path: "/tasks/conductretro", hasForm: true, domainIdType: 'project' },
};

/**
 * Gets the route for a specific task based on its type.
 *
 * TENET-UI-DOMAIN: Routes use domain IDs (dealId, projectId) for navigation.
 * The route components look up the workItemId from the domain ID.
 *
 * @param taskType - The type of the task (e.g., "qualifyLead")
 * @param workItemId - The work item ID (kept for fallback)
 * @param aggregateId - The aggregate (deal/project) ID - used as primary routing param
 * @returns Route configuration for navigation
 */
export function getTaskRoute(
  taskType: string,
  _workItemId: Id<"tasquencerWorkItems">, // Keep for API compatibility; domain IDs used for routing
  aggregateId: string,
  projectId?: string
): {
  to: string;
  params?: Record<string, string>;
  hasDirectForm: boolean;
} {
  const routeConfig = TASK_ROUTES[taskType];

  if (routeConfig?.hasForm) {
    // Use domain-first routing: dealId for sales tasks, projectId for others
    const paramKey = routeConfig.domainIdType === 'deal' ? 'dealId' : 'projectId';
    const routeId =
      routeConfig.domainIdType === 'project' ? projectId ?? aggregateId : aggregateId;
    const routePath = routeConfig.path.includes(`$${paramKey}`)
      ? routeConfig.path
      : `${routeConfig.path}/$${paramKey}`;
    return {
      to: routePath,
      params: { [paramKey]: routeId },
      hasDirectForm: true,
    };
  }

  // Default routing to domain pages
  return getDefaultTaskRoute(taskType, aggregateId);
}

/**
 * Gets the default route for a task without a dedicated form.
 * Routes to the appropriate domain page based on task category.
 */
function getDefaultTaskRoute(
  taskType: string,
  aggregateId: string
): { to: string; params?: Record<string, string>; hasDirectForm: false } {
  const category = getTaskCategory(taskType);

  switch (category) {
    case "Sales":
      return { to: "/deals/$dealId", params: { dealId: aggregateId }, hasDirectForm: false };
    case "Planning":
    case "Execution":
    case "Resources":
    case "Close":
      return { to: "/projects", hasDirectForm: false };
    case "Time":
      return { to: "/timesheet", hasDirectForm: false };
    case "Expenses":
      return { to: "/expenses", hasDirectForm: false };
    case "Approvals":
      if (taskType.toLowerCase().includes("timesheet")) {
        return { to: "/approvals/timesheets", hasDirectForm: false };
      }
      return { to: "/expenses", hasDirectForm: false };
    case "Invoicing":
      return { to: "/projects", hasDirectForm: false };
    default:
      return { to: "/deals", hasDirectForm: false };
  }
}

/**
 * Gets the category of a task based on its type.
 */
export function getTaskCategory(taskType: string): string {
  if (
    [
      "createDeal",
      "qualifyLead",
      "disqualifyLead",
      "createEstimate",
      "createProposal",
      "sendProposal",
      "negotiateTerms",
      "reviseProposal",
      "getProposalSigned",
      "archiveDeal",
    ].includes(taskType)
  ) {
    return "Sales";
  }
  if (["createProject", "setBudget"].includes(taskType)) {
    return "Planning";
  }
  if (
    [
      "viewTeamAvailability",
      "filterBySkillsRole",
      "recordPlannedTimeOff",
      "createBookings",
      "reviewBookings",
      "checkConfirmationNeeded",
      "confirmBookings",
    ].includes(taskType)
  ) {
    return "Resources";
  }
  if (
    [
      "createAndAssignTasks",
      "monitorBudgetBurn",
      "pauseWork",
      "requestChangeOrder",
      "getChangeOrderApproval",
    ].includes(taskType)
  ) {
    return "Execution";
  }
  if (
    [
      "selectEntryMethod",
      "useTimer",
      "manualEntry",
      "importFromCalendar",
      "autoFromBookings",
      "submitTimeEntry",
    ].includes(taskType)
  ) {
    return "Time";
  }
  if (
    [
      "selectExpenseType",
      "logSoftwareExpense",
      "logTravelExpense",
      "logMaterialsExpense",
      "logSubcontractorExpense",
      "logOtherExpense",
      "attachReceipt",
      "markBillable",
      "setBillableRate",
      "submitExpense",
    ].includes(taskType)
  ) {
    return "Expenses";
  }
  if (
    [
      "reviewTimesheet",
      "approveTimesheet",
      "rejectTimesheet",
      "reviseTimesheet",
      "reviewExpense",
      "approveExpense",
      "rejectExpense",
      "reviseExpense",
    ].includes(taskType)
  ) {
    return "Approvals";
  }
  if (
    [
      "selectInvoicingMethod",
      "invoiceTimeAndMaterials",
      "invoiceFixedFee",
      "invoiceMilestone",
      "invoiceRecurring",
      "reviewDraft",
      "editDraft",
      "finalizeInvoice",
      "sendInvoice",
      "sendViaEmail",
      "sendViaPdf",
      "sendViaPortal",
      "recordPayment",
      "checkMoreBilling",
    ].includes(taskType)
  ) {
    return "Invoicing";
  }
  if (["closeProject", "conductRetro"].includes(taskType)) {
    return "Close";
  }
  return "Other";
}

/**
 * Gets the color class for a task category badge.
 */
export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Sales: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    Planning:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    Resources:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    Execution:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    Time: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    Expenses:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    Approvals:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    Invoicing:
      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
    Close: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
    Other:
      "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  };
  return colors[category] ?? colors.Other;
}

/**
 * Map of task types to user-friendly labels.
 */
export const TASK_TYPE_LABELS: Record<string, string> = {
  createDeal: "Create Deal",
  qualifyLead: "Qualify Lead",
  disqualifyLead: "Disqualify Lead",
  createEstimate: "Create Estimate",
  createProposal: "Create Proposal",
  sendProposal: "Send Proposal",
  negotiateTerms: "Negotiate Terms",
  reviseProposal: "Revise Proposal",
  getProposalSigned: "Get Proposal Signed",
  archiveDeal: "Archive Deal",
  createProject: "Create Project",
  setBudget: "Set Budget",
  viewTeamAvailability: "View Team Availability",
  filterBySkillsRole: "Filter by Skills/Role",
  recordPlannedTimeOff: "Record Time Off",
  createBookings: "Create Bookings",
  reviewBookings: "Review Bookings",
  checkConfirmationNeeded: "Check Confirmation",
  confirmBookings: "Confirm Bookings",
  createAndAssignTasks: "Create & Assign Tasks",
  monitorBudgetBurn: "Monitor Budget",
  pauseWork: "Pause Work",
  requestChangeOrder: "Request Change Order",
  getChangeOrderApproval: "Get Change Order Approval",
  selectEntryMethod: "Select Entry Method",
  useTimer: "Use Timer",
  manualEntry: "Manual Time Entry",
  importFromCalendar: "Import from Calendar",
  autoFromBookings: "Auto from Bookings",
  submitTimeEntry: "Submit Time Entry",
  selectExpenseType: "Select Expense Type",
  logSoftwareExpense: "Log Software Expense",
  logTravelExpense: "Log Travel Expense",
  logMaterialsExpense: "Log Materials Expense",
  logSubcontractorExpense: "Log Subcontractor Expense",
  logOtherExpense: "Log Other Expense",
  attachReceipt: "Attach Receipt",
  markBillable: "Mark Billable",
  setBillableRate: "Set Billable Rate",
  submitExpense: "Submit Expense",
  reviewTimesheet: "Review Timesheet",
  approveTimesheet: "Approve Timesheet",
  rejectTimesheet: "Reject Timesheet",
  reviseTimesheet: "Revise Timesheet",
  reviewExpense: "Review Expense",
  approveExpense: "Approve Expense",
  rejectExpense: "Reject Expense",
  reviseExpense: "Revise Expense",
  selectInvoicingMethod: "Select Invoicing Method",
  invoiceTimeAndMaterials: "Invoice T&M",
  invoiceFixedFee: "Invoice Fixed Fee",
  invoiceMilestone: "Invoice Milestone",
  invoiceRecurring: "Invoice Recurring",
  reviewDraft: "Review Draft",
  editDraft: "Edit Draft",
  finalizeInvoice: "Finalize Invoice",
  sendInvoice: "Send Invoice",
  sendViaEmail: "Send via Email",
  sendViaPdf: "Send via PDF",
  sendViaPortal: "Send via Portal",
  recordPayment: "Record Payment",
  checkMoreBilling: "Check More Billing",
  closeProject: "Close Project",
  conductRetro: "Conduct Retrospective",
};
