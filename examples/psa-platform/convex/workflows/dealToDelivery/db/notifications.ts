/**
 * Database functions for notifications
 *
 * Provides in-app notification management for PSA platform events:
 * - Task assignments
 * - Time entry submissions and approvals
 * - Expense submissions and approvals
 * - Work pause notifications
 * - Escalation notifications
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";

// Notification type literals for type safety
export type NotificationType =
  | "task_assigned"
  | "time_entry_submitted"
  | "timesheet_approved"
  | "timesheet_rejected"
  | "expense_submitted"
  | "expense_approved"
  | "expense_rejected"
  | "work_paused"
  | "timesheet_escalated"
  | "expense_escalated";

export type NotificationResourceType =
  | "task"
  | "timeEntry"
  | "expense"
  | "project"
  | "changeOrder";

export type NotificationDeliveryStatus = "pending" | "delivered" | "failed";

// Input type for creating notifications
export interface CreateNotificationInput {
  organizationId: Id<"organizations">;
  userId: Id<"users">;
  type: NotificationType;
  resourceType: NotificationResourceType;
  resourceId: string;
  title: string;
  message: string;
  data?: unknown;
}

/**
 * Insert a new notification
 */
export async function insertNotification(
  db: DatabaseWriter,
  input: CreateNotificationInput
): Promise<Id<"notifications">> {
  return await db.insert("notifications", {
    organizationId: input.organizationId,
    userId: input.userId,
    type: input.type,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    title: input.title,
    message: input.message,
    data: input.data,
    isRead: false,
    deliveryStatus: "pending",
    createdAt: Date.now(),
  });
}

/**
 * Insert multiple notifications at once (batch create)
 */
export async function insertNotifications(
  db: DatabaseWriter,
  inputs: CreateNotificationInput[]
): Promise<Id<"notifications">[]> {
  const ids: Id<"notifications">[] = [];
  for (const input of inputs) {
    const id = await insertNotification(db, input);
    ids.push(id);
  }
  return ids;
}

/**
 * Get a notification by ID
 */
export async function getNotification(
  db: DatabaseReader,
  notificationId: Id<"notifications">
): Promise<Doc<"notifications"> | null> {
  return await db.get(notificationId);
}

/**
 * Mark a notification as read
 */
export async function markNotificationRead(
  db: DatabaseWriter,
  notificationId: Id<"notifications">
): Promise<void> {
  await db.patch(notificationId, {
    isRead: true,
    readAt: Date.now(),
  });
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsRead(
  db: DatabaseWriter,
  userId: Id<"users">
): Promise<number> {
  const unreadNotifications = await db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId).eq("isRead", false))
    .collect();

  const now = Date.now();
  for (const notification of unreadNotifications) {
    await db.patch(notification._id, {
      isRead: true,
      readAt: now,
    });
  }

  return unreadNotifications.length;
}

/**
 * Update notification delivery status
 */
export async function updateNotificationDeliveryStatus(
  db: DatabaseWriter,
  notificationId: Id<"notifications">,
  status: NotificationDeliveryStatus
): Promise<void> {
  await db.patch(notificationId, {
    deliveryStatus: status,
  });
}

/**
 * List unread notifications for a user
 */
export async function listUnreadNotifications(
  db: DatabaseReader,
  userId: Id<"users">,
  limit = 50
): Promise<Doc<"notifications">[]> {
  return await db
    .query("notifications")
    .withIndex("by_user_unread", (q) =>
      q.eq("userId", userId).eq("isRead", false)
    )
    .order("desc")
    .take(limit);
}

/**
 * List all notifications for a user (paginated)
 */
export async function listNotificationsByUser(
  db: DatabaseReader,
  userId: Id<"users">,
  limit = 50
): Promise<Doc<"notifications">[]> {
  return await db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

/**
 * Count unread notifications for a user
 */
export async function countUnreadNotifications(
  db: DatabaseReader,
  userId: Id<"users">
): Promise<number> {
  const unread = await db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId).eq("isRead", false))
    .collect();
  return unread.length;
}

/**
 * Delete old notifications (cleanup)
 */
export async function deleteOldNotifications(
  db: DatabaseWriter,
  olderThanMs: number
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const oldNotifications = await db
    .query("notifications")
    .filter((q) => q.lt(q.field("createdAt"), cutoff))
    .collect();

  for (const notification of oldNotifications) {
    await db.delete(notification._id);
  }

  return oldNotifications.length;
}

// =============================================================================
// NOTIFICATION CONTENT GENERATORS
// =============================================================================

/**
 * Generate notification content for task assignment
 */
export function generateTaskAssignmentContent(taskName: string): {
  title: string;
  message: string;
} {
  return {
    title: "New Task Assigned",
    message: `You have been assigned to task: ${taskName}`,
  };
}

/**
 * Generate notification content for time entry submission
 */
export function generateTimeEntrySubmittedContent(
  userName: string,
  hours: number
): {
  title: string;
  message: string;
} {
  return {
    title: "Time Entry Submitted",
    message: `${userName} submitted ${hours} hours for approval`,
  };
}

/**
 * Generate notification content for timesheet approval
 */
export function generateTimesheetApprovedContent(entryCount: number): {
  title: string;
  message: string;
} {
  return {
    title: "Timesheet Approved",
    message: `Your ${entryCount} time ${entryCount === 1 ? "entry has" : "entries have"} been approved`,
  };
}

/**
 * Generate notification content for timesheet rejection
 */
export function generateTimesheetRejectedContent(
  entryCount: number,
  comments: string
): {
  title: string;
  message: string;
} {
  return {
    title: "Timesheet Rejected",
    message: `Your ${entryCount} time ${entryCount === 1 ? "entry" : "entries"} ${entryCount === 1 ? "was" : "were"} rejected: ${comments}`,
  };
}

/**
 * Generate notification content for timesheet escalation (admin notification)
 */
export function generateTimesheetEscalatedContent(
  userName: string,
  revisionCount: number
): {
  title: string;
  message: string;
} {
  return {
    title: "Timesheet Escalated",
    message: `${userName}'s timesheet has been escalated after ${revisionCount} rejection cycles`,
  };
}

/**
 * Generate notification content for expense submission
 */
export function generateExpenseSubmittedContent(
  userName: string,
  amount: number
): {
  title: string;
  message: string;
} {
  const formattedAmount = (amount / 100).toFixed(2);
  return {
    title: "Expense Submitted",
    message: `${userName} submitted an expense of $${formattedAmount} for approval`,
  };
}

/**
 * Generate notification content for expense approval
 */
export function generateExpenseApprovedContent(amount: number): {
  title: string;
  message: string;
} {
  const formattedAmount = (amount / 100).toFixed(2);
  return {
    title: "Expense Approved",
    message: `Your expense of $${formattedAmount} has been approved`,
  };
}

/**
 * Generate notification content for expense rejection
 */
export function generateExpenseRejectedContent(
  amount: number,
  reason: string
): {
  title: string;
  message: string;
} {
  const formattedAmount = (amount / 100).toFixed(2);
  return {
    title: "Expense Rejected",
    message: `Your expense of $${formattedAmount} was rejected: ${reason}`,
  };
}

/**
 * Generate notification content for expense escalation (admin notification)
 */
export function generateExpenseEscalatedContent(
  userName: string,
  revisionCount: number
): {
  title: string;
  message: string;
} {
  return {
    title: "Expense Escalated",
    message: `${userName}'s expense has been escalated after ${revisionCount} rejection cycles`,
  };
}

/**
 * Generate notification content for work pause
 */
export function generateWorkPausedContent(
  projectName: string,
  reason: string
): {
  title: string;
  message: string;
} {
  return {
    title: "Work Paused",
    message: `Work on project "${projectName}" has been paused: ${reason}`,
  };
}
