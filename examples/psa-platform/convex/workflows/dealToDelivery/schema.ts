// Deal To Delivery Workflow Schema
// ================================
// Domain tables and work item metadata for the PSA platform.
// Reference: .review/recipes/psa-platform/specs/01-domain-model.md

import { defineTable } from "convex/server";
import { v } from "convex/values";
import { defineWorkItemMetadataTable } from "@repo/tasquencer";

// =============================================================================
// ENUMS / VALUE TYPES
// =============================================================================

// Deal stage progression: Lead → Qualified → Disqualified | Proposal → Negotiation → Won | Lost
const dealStage = v.union(
  v.literal("Lead"),
  v.literal("Qualified"),
  v.literal("Disqualified"),
  v.literal("Proposal"),
  v.literal("Negotiation"),
  v.literal("Won"),
  v.literal("Lost")
);

// Proposal status values
const proposalStatus = v.union(
  v.literal("Draft"),
  v.literal("Sent"),
  v.literal("Viewed"),
  v.literal("Signed"),
  v.literal("Rejected")
);

// Project status values
const projectStatus = v.union(
  v.literal("Planning"),
  v.literal("Active"),
  v.literal("OnHold"),
  v.literal("Completed"),
  v.literal("Archived")
);

// Budget type values
const budgetType = v.union(
  v.literal("TimeAndMaterials"),
  v.literal("FixedFee"),
  v.literal("Retainer")
);

// Task status values (customizable per project, but has defaults)
const taskStatus = v.union(
  v.literal("Todo"),
  v.literal("InProgress"),
  v.literal("Review"),
  v.literal("Done"),
  v.literal("OnHold")
);

// Task priority values
const taskPriority = v.union(
  v.literal("Low"),
  v.literal("Medium"),
  v.literal("High"),
  v.literal("Urgent")
);

// Booking type values
const bookingType = v.union(
  v.literal("Tentative"),
  v.literal("Confirmed"),
  v.literal("TimeOff")
);

// Time entry status values
const timeEntryStatus = v.union(
  v.literal("Draft"),
  v.literal("Submitted"),
  v.literal("Approved"),
  v.literal("Rejected"),
  v.literal("Locked")
);

// Expense type values
const expenseType = v.union(
  v.literal("Software"),
  v.literal("Travel"),
  v.literal("Materials"),
  v.literal("Subcontractor"),
  v.literal("Other")
);

// Expense status values
const expenseStatus = v.union(
  v.literal("Draft"),
  v.literal("Submitted"),
  v.literal("Approved"),
  v.literal("Rejected")
);

// Invoice status values
const invoiceStatus = v.union(
  v.literal("Draft"),
  v.literal("Finalized"),
  v.literal("Sent"),
  v.literal("Viewed"),
  v.literal("Paid"),
  v.literal("Void")
);

// Invoice method values
const invoiceMethod = v.union(
  v.literal("TimeAndMaterials"),
  v.literal("FixedFee"),
  v.literal("Milestone"),
  v.literal("Recurring")
);

// Change order status values
const changeOrderStatus = v.union(
  v.literal("Pending"),
  v.literal("Approved"),
  v.literal("Rejected")
);

// =============================================================================
// DOMAIN TABLES
// =============================================================================

// Organizations - Tenant containers
const organizations = defineTable({
  name: v.string(),
  settings: v.any(), // Organization-level settings (JSON)
  createdAt: v.number(),
});

// Users - Team members
const users = defineTable({
  organizationId: v.id("organizations"),
  email: v.string(),
  name: v.string(),
  role: v.string(), // References permission set
  costRate: v.number(), // Internal hourly cost rate (cents)
  billRate: v.number(), // Default external billing rate (cents)
  skills: v.array(v.string()), // Array of skill tags
  department: v.string(),
  location: v.string(),
  isActive: v.boolean(),
})
  .index("by_organization", ["organizationId"])
  .index("by_email", ["organizationId", "email"]);

// Companies - Clients/accounts
const companies = defineTable({
  organizationId: v.id("organizations"),
  name: v.string(),
  billingAddress: v.object({
    street: v.string(),
    city: v.string(),
    state: v.string(),
    postalCode: v.string(),
    country: v.string(),
  }),
  paymentTerms: v.number(), // Payment terms in days (default 30)
  defaultRateCardId: v.optional(v.id("rateCards")), // FK to rate cards (optional until rate card created)
})
  .index("by_organization", ["organizationId"]);

// Contacts - Client contact persons
const contacts = defineTable({
  companyId: v.id("companies"),
  organizationId: v.id("organizations"),
  name: v.string(),
  email: v.string(),
  phone: v.string(),
  isPrimary: v.boolean(),
})
  .index("by_company", ["companyId"])
  .index("by_organization", ["organizationId"]);

// Deals - Pipeline opportunities
const deals = defineTable({
  organizationId: v.id("organizations"),
  companyId: v.id("companies"),
  contactId: v.id("contacts"),
  workflowId: v.optional(v.id("tasquencerWorkflows")), // Link to workflow instance
  name: v.string(),
  value: v.number(), // Deal value in cents
  probability: v.number(), // Win probability 0-100
  stage: dealStage,
  ownerId: v.id("users"), // Deal owner
  estimateId: v.optional(v.id("estimates")),
  lostReason: v.optional(v.string()),
  qualificationNotes: v.optional(v.string()),
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
})
  .index("by_organization", ["organizationId"])
  .index("by_company", ["companyId"])
  .index("by_owner", ["ownerId"])
  .index("by_stage", ["organizationId", "stage"])
  .index("by_workflow_id", ["workflowId"]);

// Estimates - Service breakdowns
const estimates = defineTable({
  organizationId: v.id("organizations"),
  dealId: v.id("deals"),
  total: v.number(), // Total amount in cents
  createdAt: v.number(),
})
  .index("by_deal", ["dealId"]);

// EstimateServices - Line items in estimates
const estimateServices = defineTable({
  estimateId: v.id("estimates"),
  name: v.string(),
  rate: v.number(), // Hourly rate in cents
  hours: v.number(), // Estimated hours
  total: v.number(), // Computed total
})
  .index("by_estimate", ["estimateId"]);

// Proposals - Versioned proposal documents
const proposals = defineTable({
  organizationId: v.id("organizations"),
  dealId: v.id("deals"),
  version: v.number(),
  status: proposalStatus,
  documentUrl: v.string(),
  sentAt: v.optional(v.number()),
  viewedAt: v.optional(v.number()),
  signedAt: v.optional(v.number()),
  rejectedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_deal", ["dealId"]);

// Projects - Active project work
const projects = defineTable({
  organizationId: v.id("organizations"),
  companyId: v.id("companies"),
  dealId: v.optional(v.id("deals")), // FK to source deal
  workflowId: v.optional(v.id("tasquencerWorkflows")), // Link to workflow instance
  name: v.string(),
  description: v.optional(v.string()),
  status: projectStatus,
  startDate: v.number(),
  endDate: v.optional(v.number()),
  plannedEndDate: v.optional(v.number()), // Original planned end date for duration variance (spec 13 line 248-252)
  managerId: v.id("users"), // Project manager
  budgetId: v.optional(v.id("budgets")), // FK to budget (set after budget creation)
  closureNotes: v.optional(v.string()), // Notes when closing project
  closedAt: v.optional(v.number()), // When project was closed
  createdAt: v.number(),
})
  .index("by_organization", ["organizationId"])
  .index("by_company", ["companyId"])
  .index("by_manager", ["managerId"])
  .index("by_status", ["organizationId", "status"])
  .index("by_workflow_id", ["workflowId"]);

// Budgets - Project budget containers
const budgets = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  type: budgetType,
  totalAmount: v.number(), // Total budget in cents
  createdAt: v.number(),
})
  .index("by_project", ["projectId"]);

// Services - Budget line items
const services = defineTable({
  budgetId: v.id("budgets"),
  organizationId: v.id("organizations"),
  name: v.string(), // Service name (e.g., "Design")
  rate: v.number(), // Hourly rate in cents
  estimatedHours: v.number(),
  totalAmount: v.number(), // Computed total
})
  .index("by_budget", ["budgetId"]);

// Tasks - Project tasks (hierarchical)
const tasks = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  parentTaskId: v.optional(v.id("tasks")), // FK to parent (for subtasks)
  name: v.string(),
  description: v.string(),
  status: taskStatus,
  assigneeIds: v.array(v.id("users")), // Assigned users
  dueDate: v.optional(v.number()),
  estimatedHours: v.optional(v.number()),
  actualHours: v.optional(v.number()), // Recorded when task is completed (completeTask work item)
  priority: taskPriority,
  dependencies: v.array(v.id("tasks")), // Dependent task IDs
  sortOrder: v.number(),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_parent", ["parentTaskId"]);

// Bookings - Resource allocations
const bookings = defineTable({
  organizationId: v.id("organizations"),
  userId: v.id("users"),
  projectId: v.optional(v.id("projects")), // Required unless type = "TimeOff"
  taskId: v.optional(v.id("tasks")),
  type: bookingType,
  startDate: v.number(),
  endDate: v.number(),
  hoursPerDay: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_project", ["projectId"])
  .index("by_date_range", ["organizationId", "startDate", "endDate"]);

// TimeEntries - Time tracking
const timeEntries = defineTable({
  organizationId: v.id("organizations"),
  userId: v.id("users"),
  projectId: v.id("projects"),
  taskId: v.optional(v.id("tasks")),
  serviceId: v.optional(v.id("services")), // FK to services (for billing)
  date: v.number(), // Entry date timestamp
  hours: v.number(), // Hours worked (decimal)
  billable: v.boolean(),
  status: timeEntryStatus,
  notes: v.optional(v.string()),
  approvedBy: v.optional(v.id("users")),
  approvedAt: v.optional(v.number()),
  rejectionComments: v.optional(v.string()),
  invoiceId: v.optional(v.id("invoices")), // FK when invoiced
  // Revision cycle tracking (spec 09-workflow-timesheet-approval.md line 281)
  revisionCount: v.optional(v.number()), // Number of reject-revise cycles
  escalatedToAdmin: v.optional(v.boolean()), // True if escalated after 3 cycles
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_project", ["projectId"])
  .index("by_date", ["organizationId", "date"])
  .index("by_status", ["organizationId", "status"])
  .index("by_user_date", ["userId", "date"]);

// Expenses - Project expenses
const expenses = defineTable({
  organizationId: v.id("organizations"),
  userId: v.id("users"),
  projectId: v.id("projects"),
  type: expenseType,
  amount: v.number(), // Amount in cents
  currency: v.string(), // Currency code (e.g., "USD")
  billable: v.boolean(),
  billableReason: v.optional(v.string()), // Reason for billable/non-billable decision
  markupRate: v.optional(v.number()), // Markup multiplier (e.g., 1.1)
  receiptUrl: v.optional(v.string()),
  noReceiptReason: v.optional(v.string()), // Reason when no receipt is attached
  status: expenseStatus,
  date: v.number(),
  description: v.string(),
  notes: v.optional(v.string()), // Additional notes for the expense (per spec task-reviseexpense.md)
  approvedBy: v.optional(v.id("users")),
  approvedAt: v.optional(v.number()),
  rejectionComments: v.optional(v.string()),
  rejectionIssues: v.optional(
    v.array(
      v.object({
        type: v.string(),
        details: v.string(),
      })
    )
  ),
  rejectedAt: v.optional(v.number()),
  invoiceId: v.optional(v.id("invoices")), // FK when invoiced
  vendorInfo: v.optional(
    v.object({
      name: v.string(),
      company: v.optional(v.string()), // Vendor company name (for reviseExpense)
      taxId: v.optional(v.string()),
    })
  ),
  // Policy limit tracking (spec 10-workflow-expense-approval.md lines 288-304)
  policyLimitExceeded: v.optional(v.boolean()), // True if amount exceeds policy limit
  policyLimitDetails: v.optional(v.string()), // Description of the violation
  // Revision cycle tracking (spec 10-workflow-expense-approval.md line 288)
  revisionCount: v.optional(v.number()), // Number of reject-revise cycles
  escalatedToAdmin: v.optional(v.boolean()), // True if escalated after 3 cycles
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_project", ["projectId"])
  .index("by_status", ["organizationId", "status"]);

// Invoices - Client invoices
const invoices = defineTable({
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  companyId: v.id("companies"),
  number: v.optional(v.string()), // Invoice number (set on finalize)
  status: invoiceStatus,
  method: invoiceMethod,
  subtotal: v.number(), // Subtotal in cents
  tax: v.number(), // Tax amount in cents
  discount: v.optional(v.number()), // Discount amount in cents (editDraft work item)
  total: v.number(), // Total in cents
  dueDate: v.number(),
  notes: v.optional(v.string()), // Optional notes added during finalization
  sentAt: v.optional(v.number()),
  viewedAt: v.optional(v.number()),
  paidAt: v.optional(v.number()),
  finalizedAt: v.optional(v.number()),
  finalizedBy: v.optional(v.id("users")),
  // Void fields - per spec 11 line 444: "Void not delete" for finalized invoices
  voidedAt: v.optional(v.number()),
  voidedBy: v.optional(v.id("users")),
  voidReason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_company", ["companyId"])
  .index("by_status", ["organizationId", "status"])
  .index("by_number", ["organizationId", "number"]);

// InvoiceLineItems - Invoice line items
const invoiceLineItems = defineTable({
  invoiceId: v.id("invoices"),
  description: v.string(),
  quantity: v.number(), // Quantity (hours or units)
  rate: v.number(), // Rate in cents
  amount: v.number(), // Total amount in cents
  timeEntryIds: v.optional(v.array(v.id("timeEntries"))),
  expenseIds: v.optional(v.array(v.id("expenses"))),
  sortOrder: v.number(),
})
  .index("by_invoice", ["invoiceId"]);

// Payments - Invoice payments
const payments = defineTable({
  organizationId: v.id("organizations"),
  invoiceId: v.id("invoices"),
  amount: v.number(), // Payment amount in cents
  date: v.number(),
  method: v.string(), // Payment method
  reference: v.optional(v.string()), // Payment reference/check number
  notes: v.optional(v.string()), // Optional payment notes (per spec task-recordpayment.md)
  syncedToAccounting: v.boolean(),
  createdAt: v.number(),
})
  .index("by_invoice", ["invoiceId"]);

// RateCards - Pricing templates
const rateCards = defineTable({
  organizationId: v.id("organizations"),
  name: v.string(),
  isDefault: v.boolean(),
  createdAt: v.number(),
})
  .index("by_organization", ["organizationId"]);

// RateCardItems - Rate card line items
const rateCardItems = defineTable({
  rateCardId: v.id("rateCards"),
  serviceName: v.string(),
  rate: v.number(), // Hourly rate in cents
})
  .index("by_rate_card", ["rateCardId"]);

// ChangeOrders - Budget change requests
const changeOrders = defineTable({
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  requestedBy: v.id("users"),
  description: v.string(),
  justification: v.string(), // Required justification for the change (per spec task-requestchangeorder.md)
  budgetImpact: v.number(), // Budget impact in cents
  status: changeOrderStatus,
  // Optional additional services (per spec task-requestchangeorder.md)
  additionalServices: v.optional(v.array(v.object({
    name: v.string(),
    rate: v.number(), // Rate in cents
    hours: v.number(),
  }))),
  // Optional scope changes notes (per spec task-requestchangeorder.md)
  scopeChanges: v.optional(v.string()),
  approvedBy: v.optional(v.id("users")),
  approvedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"]);

// Milestones - Project milestones
const milestones = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  name: v.string(),
  percentage: v.number(), // Percentage of budget
  amount: v.number(), // Amount in cents
  dueDate: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  invoiceId: v.optional(v.id("invoices")), // FK when invoiced
  sortOrder: v.number(),
})
  .index("by_project", ["projectId"]);

// Lesson category for retrospectives
const lessonCategory = v.union(
  v.literal("timeline"),
  v.literal("budget"),
  v.literal("quality"),
  v.literal("communication"),
  v.literal("process"),
  v.literal("other")
);

// Lesson impact for retrospectives
const lessonImpact = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

// Lessons Learned - Project retrospective learnings (spec 13-workflow-close-phase.md)
const lessonsLearned = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  category: lessonCategory,
  type: v.union(v.literal("success"), v.literal("improvement")), // From successes or improvements
  description: v.string(),
  impact: lessonImpact,
  recommendation: v.optional(v.string()), // For improvements
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_category", ["organizationId", "category"]);

// Project Scorecards - Summary of project performance at closure (spec 13-workflow-close-phase.md)
const projectScorecards = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  onTime: v.boolean(), // actualEnd <= plannedEnd
  onBudget: v.boolean(), // actualCost <= budgetedCost
  clientSatisfied: v.boolean(), // satisfaction >= 4
  profitable: v.boolean(), // profitMargin >= targetMargin
  clientSatisfactionRating: v.optional(v.number()), // 1-5 scale
  clientFeedback: v.optional(v.string()),
  wouldRecommend: v.optional(v.boolean()),
  testimonialProvided: v.optional(v.boolean()),
  retroParticipants: v.optional(v.array(v.id("users"))),
  keyLearnings: v.optional(v.array(v.string())),
  recommendations: v.optional(v.array(v.string())),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"]);

// Project Metrics - Immutable financial snapshot at project closure (spec 13-workflow-close-phase.md line 273)
// "Metrics Snapshot: Final metrics captured at close, immutable"
const projectMetrics = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  snapshotDate: v.number(), // When metrics were captured (closure date)
  closedBy: v.id("users"), // Who closed the project
  // Financial metrics (all amounts in cents)
  totalRevenue: v.number(), // sum(invoices.total) where status != 'Void'
  totalCost: v.number(), // timeCost + expenseCost
  timeCost: v.number(), // sum(timeEntries.hours * user.costRate)
  expenseCost: v.number(), // sum(expenses.amount)
  profit: v.number(), // totalRevenue - totalCost
  profitMargin: v.number(), // (profit / totalRevenue) * 100, or 0 if no revenue
  budgetVariance: v.number(), // (totalCost / budgetTotal) * 100
  // Time metrics
  durationDays: v.number(), // endDate - startDate in days
  plannedDurationDays: v.optional(v.number()), // originalEndDate - startDate in days
  totalHours: v.number(), // Total logged hours
  billableHours: v.number(), // Hours marked as billable
  // Budget reference
  budgetTotal: v.number(), // Budget amount at time of closure
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_organization", ["organizationId"]);

// =============================================================================
// NOTIFICATION SYSTEM
// =============================================================================

// Notification type - categorizes the notification purpose
const notificationType = v.union(
  // Task notifications
  v.literal("task_assigned"),
  // Time tracking notifications
  v.literal("time_entry_submitted"),
  v.literal("timesheet_approved"),
  v.literal("timesheet_rejected"),
  // Expense notifications
  v.literal("expense_submitted"),
  v.literal("expense_approved"),
  v.literal("expense_rejected"),
  // Project notifications
  v.literal("work_paused"),
  // Escalation notifications
  v.literal("timesheet_escalated"),
  v.literal("expense_escalated")
);

// Resource type - what entity the notification is about
const notificationResourceType = v.union(
  v.literal("task"),
  v.literal("timeEntry"),
  v.literal("expense"),
  v.literal("project"),
  v.literal("changeOrder")
);

// Notification delivery status
const notificationDeliveryStatus = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed")
);

// Notifications - In-app notification system
const notifications = defineTable({
  organizationId: v.id("organizations"),
  userId: v.id("users"), // Recipient
  type: notificationType,
  resourceType: notificationResourceType,
  resourceId: v.string(), // The ID of the related resource (task, timeEntry, etc.)
  title: v.string(),
  message: v.string(),
  data: v.optional(v.any()), // Additional context (e.g., rejection reason, comments)
  isRead: v.boolean(),
  deliveryStatus: notificationDeliveryStatus,
  createdAt: v.number(),
  readAt: v.optional(v.number()),
})
  .index("by_user", ["userId", "isRead"])
  .index("by_organization", ["organizationId"])
  .index("by_user_unread", ["userId", "isRead", "createdAt"]);

// =============================================================================
// WORK ITEM METADATA TABLE
// =============================================================================

// Work item priority levels
const workItemPriority = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent")
);

// Work item metadata - typed payload for all deal-to-delivery workflow work items
// Uses deals as the aggregate root (1:1 with workflow)
const dealToDeliveryWorkItems = defineWorkItemMetadataTable("deals").withPayload(
  v.union(
    // =========================================================================
    // SALES PHASE WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("createDeal"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("qualifyLead"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),
    v.object({
      type: v.literal("disqualifyLead"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),
    v.object({
      type: v.literal("createEstimate"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("createProposal"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),
    v.object({
      type: v.literal("sendProposal"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("negotiateTerms"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),
    v.object({
      type: v.literal("reviseProposal"),
      taskName: v.string(),
      priority: workItemPriority,
      previousVersion: v.optional(v.number()),
    }),
    v.object({
      type: v.literal("getProposalSigned"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),
    v.object({
      type: v.literal("archiveDeal"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStage: v.optional(dealStage),
    }),

    // =========================================================================
    // PLANNING PHASE WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("createProject"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("setBudget"),
      taskName: v.string(),
      priority: workItemPriority,
    }),

    // =========================================================================
    // RESOURCE PLANNING WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("viewTeamAvailability"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("filterBySkillsRole"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("recordPlannedTimeOff"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("createBookings"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("reviewBookings"),
      taskName: v.string(),
      priority: workItemPriority,
      // Routing decision: whether more filtering is needed
      needsMoreFiltering: v.optional(v.boolean()),
    }),
    v.object({
      type: v.literal("checkConfirmationNeeded"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("confirmBookings"),
      taskName: v.string(),
      priority: workItemPriority,
    }),

    // =========================================================================
    // EXECUTION PHASE WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("createAndAssignTasks"),
      taskName: v.string(),
      priority: workItemPriority,
      // Execution strategy selection for the executeProjectWork dynamic composite
      // Determines which workflow pattern to use for task execution
      executionStrategy: v.optional(v.union(
        v.literal("sequential"), // Tasks executed one at a time in order
        v.literal("parallel"),   // Independent tasks executed concurrently
        v.literal("conditional") // Branch-based execution (e.g., budget-dependent)
      )),
    }),
    v.object({
      type: v.literal("completeTask"),
      taskName: v.string(),
      priority: workItemPriority,
      taskId: v.optional(v.id("tasks")),
    }),
    v.object({
      type: v.literal("monitorBudgetBurn"),
      taskName: v.string(),
      priority: workItemPriority,
      // Budget burn calculation result (set on complete)
      // Per spec 06-workflow-execution-phase.md lines 278-284:
      // 0-75%: Green, 75-90%: Yellow (warning), 90%+: Red (overrun)
      budgetOk: v.optional(v.boolean()), // true if burnRate <= 90%
      burnRate: v.optional(v.number()), // 0-1 percentage
      totalCost: v.optional(v.number()), // In cents
      budgetRemaining: v.optional(v.number()), // In cents
      warningLevel: v.optional(v.union(v.literal("green"), v.literal("yellow"), v.literal("red"))),
      // Cost rate validation warnings (for audit trail)
      costRateWarning: v.optional(v.string()), // Warning message if users have missing cost rates
      usersWithMissingRatesCount: v.optional(v.number()), // Count of users missing cost rates
    }),
    v.object({
      type: v.literal("pauseWork"),
      taskName: v.string(),
      priority: workItemPriority,
      previousStatus: v.optional(projectStatus),
    }),
    v.object({
      type: v.literal("requestChangeOrder"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("getChangeOrderApproval"),
      taskName: v.string(),
      priority: workItemPriority,
      changeOrderId: v.optional(v.id("changeOrders")),
    }),

    // =========================================================================
    // TIME TRACKING WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("selectEntryMethod"),
      taskName: v.string(),
      priority: workItemPriority,
      // Routing decision: the selected time entry method
      selectedMethod: v.optional(
        v.union(
          v.literal("timer"),
          v.literal("manual"),
          v.literal("calendar"),
          v.literal("autoBooking")
        )
      ),
    }),
    v.object({
      type: v.literal("useTimer"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("manualEntry"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("importFromCalendar"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("autoFromBookings"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("submitTimeEntry"),
      taskName: v.string(),
      priority: workItemPriority,
      timeEntryId: v.optional(v.id("timeEntries")),
    }),

    // =========================================================================
    // EXPENSE TRACKING WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("selectExpenseType"),
      taskName: v.string(),
      priority: workItemPriority,
      // Routing decision: the selected expense type
      selectedExpenseType: v.optional(expenseType),
    }),
    v.object({
      type: v.literal("logSoftwareExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("logTravelExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("logMaterialsExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("logSubcontractorExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("logOtherExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("attachReceipt"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("markBillable"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
      // Routing decision: whether the expense is billable
      isBillable: v.optional(v.boolean()),
    }),
    v.object({
      type: v.literal("setBillableRate"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("submitExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),

    // =========================================================================
    // TIMESHEET APPROVAL WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("reviewTimesheet"),
      taskName: v.string(),
      priority: workItemPriority,
      decision: v.optional(v.union(v.literal("approve"), v.literal("reject"))),
      comments: v.optional(v.string()), // Review comments for audit trail (per spec task-reviewtimesheet.md)
    }),
    v.object({
      type: v.literal("approveTimesheet"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("rejectTimesheet"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("reviseTimesheet"),
      taskName: v.string(),
      priority: workItemPriority,
    }),

    // =========================================================================
    // EXPENSE APPROVAL WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("reviewExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
      // Decision captured during review (set on complete)
      decision: v.optional(v.union(v.literal("approve"), v.literal("reject"))),
      comments: v.optional(v.string()), // Review comments for audit trail (per spec task-reviewexpense.md)
    }),
    v.object({
      type: v.literal("approveExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("rejectExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),
    v.object({
      type: v.literal("reviseExpense"),
      taskName: v.string(),
      priority: workItemPriority,
      expenseId: v.optional(v.id("expenses")),
    }),

    // =========================================================================
    // INVOICE GENERATION WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("selectInvoicingMethod"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("invoiceTimeAndMaterials"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("invoiceFixedFee"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("invoiceMilestone"),
      taskName: v.string(),
      priority: workItemPriority,
      milestoneId: v.optional(v.id("milestones")),
    }),
    v.object({
      type: v.literal("invoiceRecurring"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("reviewDraft"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
      approved: v.optional(v.boolean()), // Approval decision for workflow routing
      comments: v.optional(v.string()), // Review comments for audit trail (per spec task-reviewdraft.md)
    }),
    v.object({
      type: v.literal("editDraft"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
    }),
    v.object({
      type: v.literal("finalizeInvoice"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
    }),

    // =========================================================================
    // BILLING PHASE WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("sendInvoice"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
      // Delivery method selected (set on complete)
      method: v.optional(v.union(v.literal("email"), v.literal("pdf"), v.literal("portal"))),
    }),
    v.object({
      type: v.literal("sendViaEmail"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
    }),
    v.object({
      type: v.literal("sendViaPdf"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
    }),
    v.object({
      type: v.literal("sendViaPortal"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
    }),
    v.object({
      type: v.literal("recordPayment"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
      overpaymentAmount: v.optional(v.number()), // Amount exceeding invoice balance (per spec task-recordpayment.md)
    }),
    // TENET-WF-EXEC: Invoice voiding is now work item-driven for audit trail
    v.object({
      type: v.literal("voidInvoice"),
      taskName: v.string(),
      priority: workItemPriority,
      invoiceId: v.optional(v.id("invoices")),
      voidReason: v.optional(v.string()),
    }),
    v.object({
      type: v.literal("checkMoreBilling"),
      taskName: v.string(),
      priority: workItemPriority,
      // Billing status counts for UI display (per spec task-checkmorebilling.md)
      uninvoicedTimeCount: v.optional(v.number()),
      uninvoicedExpensesCount: v.optional(v.number()),
      uninvoicedMilestonesCount: v.optional(v.number()),
      isRetainer: v.optional(v.boolean()),
      moreBillingCycles: v.optional(v.boolean()), // Decision for workflow routing
    }),

    // =========================================================================
    // CLOSE PHASE WORK ITEMS
    // =========================================================================
    v.object({
      type: v.literal("closeProject"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("conductRetro"),
      taskName: v.string(),
      priority: workItemPriority,
    }),

    // =========================================================================
    // INTERNAL SCAFFOLDER WORK ITEMS (conditional/parallel templates)
    // =========================================================================
    v.object({
      type: v.literal("evaluateCondition"),
      taskName: v.string(),
      priority: workItemPriority,
      // Routing decision: the result of condition evaluation
      conditionResult: v.optional(v.boolean()),
      conditionNotes: v.optional(v.string()),
      evaluatedAt: v.optional(v.number()),
    }),
    v.object({
      type: v.literal("executeAlternateBranch"),
      taskName: v.string(),
      priority: workItemPriority,
      branchExecuted: v.optional(v.literal("alternate")),
      branchResult: v.optional(v.string()),
      completedAt: v.optional(v.number()),
    }),
    v.object({
      type: v.literal("executePrimaryBranch"),
      taskName: v.string(),
      priority: workItemPriority,
      branchExecuted: v.optional(v.literal("primary")),
      branchResult: v.optional(v.string()),
      completedAt: v.optional(v.number()),
    }),
    v.object({
      type: v.literal("executeTask"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("getNextTask"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("initParallelTasks"),
      taskName: v.string(),
      priority: workItemPriority,
      taskCount: v.optional(v.number()),
      parallelTaskIds: v.optional(v.array(v.id("tasks"))),
    }),
    v.object({
      type: v.literal("executeParallelTask"),
      taskName: v.string(),
      priority: workItemPriority,
    }),
    v.object({
      type: v.literal("syncParallelTasks"),
      taskName: v.string(),
      priority: workItemPriority,
    })
  )
);

// =============================================================================
// PARALLEL TASK MAPPINGS (for dynamic composite task pattern)
// =============================================================================

/**
 * Maps child workflow IDs to the task IDs they should execute.
 * Used by the parallel execution pattern to pass taskId from
 * the dynamic composite task to the child workflow's work item.
 */
const parallelTaskMappings = defineTable({
  workflowId: v.id("tasquencerWorkflows"),
  taskId: v.id("tasks"),
  createdAt: v.number(),
}).index("by_workflowId", ["workflowId"]);

// =============================================================================
// EXPORT
// =============================================================================

export default {
  // Domain tables
  organizations,
  users,
  companies,
  contacts,
  deals,
  estimates,
  estimateServices,
  proposals,
  projects,
  budgets,
  services,
  tasks,
  bookings,
  timeEntries,
  expenses,
  invoices,
  invoiceLineItems,
  payments,
  rateCards,
  rateCardItems,
  changeOrders,
  milestones,
  lessonsLearned,
  projectScorecards,
  projectMetrics,
  notifications,
  // Parallel execution support
  parallelTaskMappings,
  // Work item metadata table
  dealToDeliveryWorkItems,
};
