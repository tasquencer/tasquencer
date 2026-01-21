/**
 * Database layer barrel file for deal-to-delivery workflow
 * Re-exports all database functions from individual entity modules.
 */

// Organizations
export {
  insertOrganization,
  getOrganization,
  updateOrganization,
  listOrganizations,
} from "./db/organizations";

// Users
export {
  insertUser,
  getUser,
  getUserByEmail,
  updateUser,
  listUsersByOrganization,
  listActiveUsersByOrganization,
  listUsersBySkill,
  listUsersByDepartment,
} from "./db/users";

// Companies
export {
  insertCompany,
  getCompany,
  updateCompany,
  listCompaniesByOrganization,
} from "./db/companies";

// Contacts
export {
  insertContact,
  getContact,
  updateContact,
  listContactsByCompany,
  listContactsByOrganization,
  getPrimaryContactForCompany,
} from "./db/contacts";

// Deals (aggregate root)
export {
  insertDeal,
  getDeal,
  getDealByWorkflowId,
  updateDealStage,
  canTransitionDealStage,
  updateDeal,
  listDealsByOrganization,
  listDealsByStage,
  listDealsByOwner,
} from "./db/deals";
export type { DealStage } from "./db/deals";

// Deal Stage Transitions (business rule validation)
export {
  VALID_STAGE_TRANSITIONS,
  TERMINAL_STAGES,
  DealStages,
  isValidStageTransition,
  getValidNextStages,
  isTerminalStage,
  assertValidStageTransition,
  getTransitionErrorReason,
} from "./db/dealStageTransitions";

// Estimates
export {
  insertEstimate,
  getEstimate,
  getEstimateByDealId,
  listEstimatesByDeal,
  updateEstimate,
  insertEstimateService,
  getEstimateService,
  listEstimateServices,
  updateEstimateService,
  deleteEstimateService,
  recalculateEstimateTotal,
} from "./db/estimates";

// Proposals
export {
  insertProposal,
  getProposal,
  updateProposalStatus,
  updateProposal,
  listProposalsByDeal,
  getLatestProposalForDeal,
  getNextProposalVersion,
  markProposalSent,
  markProposalViewed,
  markProposalSigned,
  markProposalRejected,
} from "./db/proposals";
export type { ProposalStatus } from "./db/proposals";

// Projects
export {
  insertProject,
  getProject,
  getProjectByWorkflowId,
  getProjectByDealId,
  updateProjectStatus,
  updateProject,
  listProjectsByOrganization,
  listProjectsByStatus,
  listProjectsByManager,
  listProjectsByCompany,
  createProjectMetricsSnapshot,
  getProjectMetricsSnapshot,
  listProjectMetricsByOrganization,
} from "./db/projects";
export type { ProjectStatus } from "./db/projects";

// Budgets
export {
  insertBudget,
  getBudget,
  getBudgetByProjectId,
  updateBudget,
  insertService,
  getService,
  listServicesByBudget,
  updateService,
  deleteService,
  recalculateBudgetTotal,
} from "./db/budgets";
export type { BudgetType } from "./db/budgets";

// Tasks
export {
  insertTask,
  getTask,
  updateTaskStatus,
  updateTask,
  listTasksByProject,
  listRootTasksByProject,
  listSubtasks,
  listTasksByStatus,
  listTasksByAssignee,
  assignTask,
  deleteTask,
  getNextTaskSortOrder,
} from "./db/tasks";
export type { TaskStatus, TaskPriority } from "./db/tasks";

// Bookings
export {
  insertBooking,
  getBooking,
  updateBooking,
  updateBookingType,
  deleteBooking,
  listBookingsByUser,
  listBookingsByProject,
  listBookingsInDateRange,
  listUserBookingsInDateRange,
  listTentativeBookingsByProject,
  confirmAllTentativeBookings,
  calculateUserBookedHours,
} from "./db/bookings";
export type { BookingType } from "./db/bookings";

// Time Entries
export {
  insertTimeEntry,
  getTimeEntry,
  updateTimeEntryStatus,
  updateTimeEntry,
  listTimeEntriesByUser,
  listTimeEntriesByProject,
  listTimeEntriesByUserAndDate,
  listTimeEntriesByStatus,
  listSubmittedTimeEntriesByProject,
  listApprovedTimeEntriesByProject,
  listBillableUninvoicedTimeEntries,
  approveTimeEntry,
  rejectTimeEntry,
  lockTimeEntry,
  calculateProjectHours,
} from "./db/timeEntries";
export type { TimeEntryStatus } from "./db/timeEntries";

// Expenses
export {
  insertExpense,
  getExpense,
  updateExpenseStatus,
  updateExpense,
  deleteExpense,
  listExpensesByUser,
  listExpensesByProject,
  listExpensesByStatus,
  listSubmittedExpensesByProject,
  listApprovedExpensesByProject,
  listBillableUninvoicedExpenses,
  approveExpense,
  rejectExpense,
  markExpenseInvoiced,
  calculateProjectExpenses,
} from "./db/expenses";
export type { ExpenseType, ExpenseStatus } from "./db/expenses";

// Invoices, Line Items, and Payments
export {
  insertInvoice,
  getInvoice,
  updateInvoiceStatus,
  updateInvoice,
  listInvoicesByProject,
  listInvoicesByCompany,
  listInvoicesByStatus,
  getInvoiceByNumber,
  getNextInvoiceNumber,
  finalizeInvoice,
  markInvoiceSent,
  markInvoiceViewed,
  markInvoicePaid,
  voidInvoice,
  canVoidInvoice,
  insertInvoiceLineItem,
  getInvoiceLineItem,
  updateInvoiceLineItem,
  deleteInvoiceLineItem,
  listLineItemsByInvoice,
  recalculateInvoiceTotals,
  insertPayment,
  getPayment,
  updatePayment,
  listPaymentsByInvoice,
  calculateInvoicePayments,
  recordPaymentAndCheckPaid,
} from "./db/invoices";
export type { InvoiceStatus, InvoiceMethod } from "./db/invoices";

// Change Orders
export {
  insertChangeOrder,
  getChangeOrder,
  updateChangeOrderStatus,
  updateChangeOrder,
  listChangeOrdersByProject,
  listPendingChangeOrdersByProject,
  approveChangeOrder,
  rejectChangeOrder,
  calculateApprovedBudgetImpact,
} from "./db/changeOrders";
export type { ChangeOrderStatus } from "./db/changeOrders";

// Milestones
export {
  insertMilestone,
  getMilestone,
  updateMilestone,
  deleteMilestone,
  listMilestonesByProject,
  listCompletedMilestones,
  listUninvoicedMilestones,
  completeMilestone,
  markMilestoneInvoiced,
  getNextMilestoneSortOrder,
} from "./db/milestones";

// Rate Cards
export {
  insertRateCard,
  getRateCard,
  updateRateCard,
  deleteRateCard,
  listRateCardsByOrganization,
  getDefaultRateCard,
  setDefaultRateCard,
  insertRateCardItem,
  getRateCardItem,
  updateRateCardItem,
  deleteRateCardItem,
  listRateCardItems,
  getRateForService,
} from "./db/rateCards";

// Work Item Context (cross-cutting workflow helpers)
export {
  getRootWorkflowAndDealForWorkItem,
  getWorkflowIdsForWorkItem,
} from "./db/workItemContext";

// Work Items (domain layer for work item access)
export {
  getWorkItem,
  getWorkItemWithMetadata,
  listAllWorkItemMetadata,
  listAllWorkItemsWithMetadata,
  listActiveWorkItems,
  listActiveHumanWorkItems,
  listWorkItemMetadataByDeal,
  listWorkItemsWithMetadataByDeal,
  listActiveHumanWorkItemsByDeal,
  listActiveClaimedWorkItemsForUser,
} from "./db/workItems";

// Date Limits (entry age validation, timer duration checks)
export {
  TIME_ENTRY_WARNING_DAYS,
  MAX_ENTRY_AGE_DAYS,
  TIMER_MAX_HOURS,
  getEntryAgeInDays,
  isFutureDate,
  checkEntryDateLimits,
  checkTimeEntryDateLimits,
  checkExpenseDateLimits,
  requiresAdminApprovalForDate,
  isInWarningRange,
  checkTimerDuration,
  getTimerHours,
  wouldTimerAutoStop,
  validateTimeEntryDate,
  validateExpenseDate,
  getDateWarningMessage,
} from "./db/dateLimits";
export type { DateLimitCheckResult, TimerDurationCheckResult } from "./db/dateLimits";

// Notifications
export {
  insertNotification,
  insertNotifications,
  getNotification,
  markNotificationRead,
  markAllNotificationsRead,
  updateNotificationDeliveryStatus,
  listUnreadNotifications,
  listNotificationsByUser,
  countUnreadNotifications,
  deleteOldNotifications,
  generateTaskAssignmentContent,
  generateTimeEntrySubmittedContent,
  generateTimesheetApprovedContent,
  generateTimesheetRejectedContent,
  generateTimesheetEscalatedContent,
  generateExpenseSubmittedContent,
  generateExpenseApprovedContent,
  generateExpenseRejectedContent,
  generateExpenseEscalatedContent,
  generateWorkPausedContent,
} from "./db/notifications";
export type {
  NotificationType,
  NotificationResourceType,
  NotificationDeliveryStatus,
  CreateNotificationInput,
} from "./db/notifications";
