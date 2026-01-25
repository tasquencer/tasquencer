import type { Doc, Id } from "@/convex/_generated/dataModel";

/**
 * Work item metadata returned by the PSA platform API.
 * Used in task forms and work queue components.
 */
export type TaskMetadata = {
  _id: Id<"dealToDeliveryWorkItems">;
  _creationTime: number;
  workItemId: Id<"tasquencerWorkItems">;
  aggregateTableId: Id<"deals">;
  taskName: string;
  taskType: string;
  status: "pending" | "claimed" | "completed";
  requiredScope?: string;
  requiredGroupId?: string;
  claimedBy?: string;
  workItemState?: string;
  payload: Doc<"dealToDeliveryWorkItems">["payload"];
};

/**
 * Deal context for task forms.
 */
export type DealContext = {
  deal: Doc<"deals">;
  company?: Doc<"companies"> | null;
  contact?: Doc<"contacts"> | null;
};

/**
 * Project context for task forms (for execution/close phase tasks).
 */
export type ProjectContext = {
  project: Doc<"projects">;
  budget?: Doc<"budgets"> | null;
  deal: Doc<"deals">;
};

/**
 * Category of a PSA task based on its type.
 */
export type TaskCategory =
  | "Sales"
  | "Planning"
  | "Resources"
  | "Execution"
  | "Time"
  | "Expenses"
  | "Approvals"
  | "Invoicing"
  | "Close"
  | "Other";

/**
 * Event types for project timeline.
 */
export type ProjectTimelineEventType =
  | "deal_created"
  | "lead_qualified"
  | "lead_disqualified"
  | "estimate_created"
  | "proposal_created"
  | "proposal_sent"
  | "proposal_signed"
  | "deal_won"
  | "deal_lost"
  | "project_created"
  | "budget_set"
  | "resource_allocated"
  | "task_assigned"
  | "task_completed"
  | "time_submitted"
  | "time_approved"
  | "expense_submitted"
  | "expense_approved"
  | "invoice_created"
  | "invoice_sent"
  | "payment_received"
  | "project_closed"
  | "retrospective_completed";

/**
 * Project timeline event.
 */
export type ProjectTimelineEvent = {
  id: string;
  timestamp: number;
  type: ProjectTimelineEventType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
};
