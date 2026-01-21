/// <reference types="vite/client" />
/**
 * Tests for notification DB functions in the deal-to-delivery workflow
 *
 * These tests validate the CRUD operations and content generators for
 * the notification system.
 */

import { describe, it, beforeEach, expect } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Doc } from '../_generated/dataModel'
import {
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
} from '../workflows/dealToDelivery/db/notifications'

// =============================================================================
// Test Setup
// =============================================================================

let t: TestContext

beforeEach(() => {
  t = setup()
})

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

async function createTestOrganization(
  testContext: TestContext
): Promise<Id<'organizations'>> {
  return await testContext.run(async (ctx) => {
    return await ctx.db.insert('organizations', {
      name: 'Test Organization',
      settings: {},
      createdAt: Date.now(),
    })
  })
}

async function createTestUser(
  testContext: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<Id<'users'>> {
  return await testContext.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId,
      email: `user-${Date.now()}@example.com`,
      name: 'Test User',
      role: 'psa_team_member',
      costRate: 10000,
      billRate: 15000,
      skills: [],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
      ...overrides,
    })
  })
}

// =============================================================================
// Notification CRUD Tests
// =============================================================================

describe('Notification CRUD Operations', () => {
  it('should insert a notification', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationId = await t.run(async (ctx) => {
      return await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'test-task-id',
        title: 'New Task Assigned',
        message: 'You have been assigned to a new task',
      })
    })

    expect(notificationId).toBeDefined()

    const notification = await t.run(async (ctx) => {
      return await getNotification(ctx.db, notificationId)
    })

    expect(notification).toBeDefined()
    expect(notification?.type).toBe('task_assigned')
    expect(notification?.title).toBe('New Task Assigned')
    expect(notification?.isRead).toBe(false)
    expect(notification?.deliveryStatus).toBe('pending')
  })

  it('should insert multiple notifications', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const ids = await t.run(async (ctx) => {
      return await insertNotifications(ctx.db, [
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Task 1',
          message: 'Message 1',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-2',
          title: 'Task 2',
          message: 'Message 2',
        },
      ])
    })

    expect(ids).toHaveLength(2)
  })

  it('should mark notification as read', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationId = await t.run(async (ctx) => {
      return await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'test-task',
        title: 'Test',
        message: 'Test message',
      })
    })

    await t.run(async (ctx) => {
      await markNotificationRead(ctx.db, notificationId)
    })

    const notification = await t.run(async (ctx) => {
      return await getNotification(ctx.db, notificationId)
    })

    expect(notification?.isRead).toBe(true)
    expect(notification?.readAt).toBeDefined()
  })

  it('should mark all notifications as read for a user', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    // Create 3 notifications
    await t.run(async (ctx) => {
      await insertNotifications(ctx.db, [
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Task 1',
          message: 'Message 1',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'timesheet_approved',
          resourceType: 'timeEntry',
          resourceId: 'entry-1',
          title: 'Approved',
          message: 'Message 2',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'expense_approved',
          resourceType: 'expense',
          resourceId: 'expense-1',
          title: 'Approved',
          message: 'Message 3',
        },
      ])
    })

    const markedCount = await t.run(async (ctx) => {
      return await markAllNotificationsRead(ctx.db, userId)
    })

    expect(markedCount).toBe(3)

    const unreadCount = await t.run(async (ctx) => {
      return await countUnreadNotifications(ctx.db, userId)
    })

    expect(unreadCount).toBe(0)
  })

  it('should update notification delivery status', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationId = await t.run(async (ctx) => {
      return await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'test-task',
        title: 'Test',
        message: 'Test message',
      })
    })

    await t.run(async (ctx) => {
      await updateNotificationDeliveryStatus(ctx.db, notificationId, 'delivered')
    })

    const notification = await t.run(async (ctx) => {
      return await getNotification(ctx.db, notificationId)
    })

    expect(notification?.deliveryStatus).toBe('delivered')
  })
})

// =============================================================================
// Notification Query Tests
// =============================================================================

describe('Notification Queries', () => {
  it('should list unread notifications for a user', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    await t.run(async (ctx) => {
      await insertNotifications(ctx.db, [
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Task 1',
          message: 'Message 1',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-2',
          title: 'Task 2',
          message: 'Message 2',
        },
      ])
    })

    const unread = await t.run(async (ctx) => {
      return await listUnreadNotifications(ctx.db, userId)
    })

    expect(unread).toHaveLength(2)
  })

  it('should list all notifications for a user', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    // Create notifications and mark one as read
    const ids = await t.run(async (ctx) => {
      return await insertNotifications(ctx.db, [
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Task 1',
          message: 'Message 1',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-2',
          title: 'Task 2',
          message: 'Message 2',
        },
      ])
    })

    await t.run(async (ctx) => {
      await markNotificationRead(ctx.db, ids[0])
    })

    const all = await t.run(async (ctx) => {
      return await listNotificationsByUser(ctx.db, userId)
    })

    expect(all).toHaveLength(2)
  })

  it('should count unread notifications', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    await t.run(async (ctx) => {
      await insertNotifications(ctx.db, [
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-1',
          title: 'Task 1',
          message: 'Message 1',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-2',
          title: 'Task 2',
          message: 'Message 2',
        },
        {
          organizationId: orgId,
          userId: userId,
          type: 'task_assigned',
          resourceType: 'task',
          resourceId: 'task-3',
          title: 'Task 3',
          message: 'Message 3',
        },
      ])
    })

    const count = await t.run(async (ctx) => {
      return await countUnreadNotifications(ctx.db, userId)
    })

    expect(count).toBe(3)
  })

  it('should not count notifications for other users', async () => {
    const orgId = await createTestOrganization(t)
    const userId1 = await createTestUser(t, orgId, { email: 'user1@example.com' })
    const userId2 = await createTestUser(t, orgId, { email: 'user2@example.com' })

    await t.run(async (ctx) => {
      await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId1,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'task-1',
        title: 'Task 1',
        message: 'Message 1',
      })
    })

    const countUser1 = await t.run(async (ctx) => {
      return await countUnreadNotifications(ctx.db, userId1)
    })

    const countUser2 = await t.run(async (ctx) => {
      return await countUnreadNotifications(ctx.db, userId2)
    })

    expect(countUser1).toBe(1)
    expect(countUser2).toBe(0)
  })
})

// =============================================================================
// Notification Cleanup Tests
// =============================================================================

describe('Notification Cleanup', () => {
  it('should delete old notifications', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    // Create an "old" notification by inserting directly with past timestamp
    await t.run(async (ctx) => {
      const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000) // 31 days ago
      await ctx.db.insert('notifications', {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'old-task',
        title: 'Old Task',
        message: 'Old message',
        isRead: true,
        deliveryStatus: 'delivered',
        createdAt: oldTimestamp,
      })
    })

    // Create a recent notification
    await t.run(async (ctx) => {
      await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'new-task',
        title: 'New Task',
        message: 'New message',
      })
    })

    // Delete notifications older than 30 days
    const deleted = await t.run(async (ctx) => {
      return await deleteOldNotifications(ctx.db, 30 * 24 * 60 * 60 * 1000)
    })

    expect(deleted).toBe(1)

    // Verify only the new notification remains
    const remaining = await t.run(async (ctx) => {
      return await listNotificationsByUser(ctx.db, userId)
    })

    expect(remaining).toHaveLength(1)
    expect(remaining[0].resourceId).toBe('new-task')
  })
})

// =============================================================================
// Content Generator Tests
// =============================================================================

describe('Notification Content Generators', () => {
  describe('Task Assignment', () => {
    it('should generate task assignment content', () => {
      const content = generateTaskAssignmentContent('Build Login Page')
      expect(content.title).toBe('New Task Assigned')
      expect(content.message).toContain('Build Login Page')
    })
  })

  describe('Time Entry', () => {
    it('should generate time entry submitted content', () => {
      const content = generateTimeEntrySubmittedContent('John Doe', 8)
      expect(content.title).toBe('Time Entry Submitted')
      expect(content.message).toContain('John Doe')
      expect(content.message).toContain('8 hours')
    })

    it('should generate timesheet approved content for single entry', () => {
      const content = generateTimesheetApprovedContent(1)
      expect(content.title).toBe('Timesheet Approved')
      expect(content.message).toContain('entry has')
    })

    it('should generate timesheet approved content for multiple entries', () => {
      const content = generateTimesheetApprovedContent(5)
      expect(content.title).toBe('Timesheet Approved')
      expect(content.message).toContain('entries have')
    })

    it('should generate timesheet rejected content', () => {
      const content = generateTimesheetRejectedContent(3, 'Missing project details')
      expect(content.title).toBe('Timesheet Rejected')
      expect(content.message).toContain('Missing project details')
    })

    it('should generate timesheet escalated content', () => {
      const content = generateTimesheetEscalatedContent('Jane Smith', 3)
      expect(content.title).toBe('Timesheet Escalated')
      expect(content.message).toContain('Jane Smith')
      expect(content.message).toContain('3 rejection cycles')
    })
  })

  describe('Expense', () => {
    it('should generate expense submitted content', () => {
      const content = generateExpenseSubmittedContent('John Doe', 25000) // $250.00
      expect(content.title).toBe('Expense Submitted')
      expect(content.message).toContain('John Doe')
      expect(content.message).toContain('$250.00')
    })

    it('should generate expense approved content', () => {
      const content = generateExpenseApprovedContent(15000) // $150.00
      expect(content.title).toBe('Expense Approved')
      expect(content.message).toContain('$150.00')
    })

    it('should generate expense rejected content', () => {
      const content = generateExpenseRejectedContent(5000, 'Missing receipt')
      expect(content.title).toBe('Expense Rejected')
      expect(content.message).toContain('$50.00')
      expect(content.message).toContain('Missing receipt')
    })

    it('should generate expense escalated content', () => {
      const content = generateExpenseEscalatedContent('Jane Smith', 3)
      expect(content.title).toBe('Expense Escalated')
      expect(content.message).toContain('Jane Smith')
      expect(content.message).toContain('3 rejection cycles')
    })
  })

  describe('Work Pause', () => {
    it('should generate work paused content', () => {
      const content = generateWorkPausedContent('Project Alpha', 'Budget overrun')
      expect(content.title).toBe('Work Paused')
      expect(content.message).toContain('Project Alpha')
      expect(content.message).toContain('Budget overrun')
    })
  })
})

// =============================================================================
// Notification Type Coverage Tests
// =============================================================================

describe('Notification Type Coverage', () => {
  it('should support all notification types', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationTypes = [
      'task_assigned',
      'time_entry_submitted',
      'timesheet_approved',
      'timesheet_rejected',
      'expense_submitted',
      'expense_approved',
      'expense_rejected',
      'work_paused',
      'timesheet_escalated',
      'expense_escalated',
    ] as const

    for (const type of notificationTypes) {
      const id = await t.run(async (ctx) => {
        return await insertNotification(ctx.db, {
          organizationId: orgId,
          userId: userId,
          type: type,
          resourceType: type.includes('task') ? 'task' :
                        type.includes('time') || type.includes('timesheet') ? 'timeEntry' :
                        type.includes('expense') ? 'expense' : 'project',
          resourceId: `test-${type}`,
          title: `Test ${type}`,
          message: `Message for ${type}`,
        })
      })

      expect(id).toBeDefined()

      const notification = await t.run(async (ctx) => {
        return await getNotification(ctx.db, id)
      })

      expect(notification?.type).toBe(type)
    }
  })
})

// =============================================================================
// Notification Data Tests
// =============================================================================

describe('Notification Data Storage', () => {
  it('should store additional data in notification', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationId = await t.run(async (ctx) => {
      return await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'task-123',
        title: 'New Task',
        message: 'You have been assigned',
        data: {
          taskName: 'Build Feature',
          projectId: 'project-456',
          dueDate: 1704067200000,
          priority: 'High',
        },
      })
    })

    const notification = await t.run(async (ctx) => {
      return await getNotification(ctx.db, notificationId)
    })

    expect(notification?.data).toBeDefined()
    expect((notification?.data as any).taskName).toBe('Build Feature')
    expect((notification?.data as any).projectId).toBe('project-456')
    expect((notification?.data as any).priority).toBe('High')
  })

  it('should handle notification without additional data', async () => {
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)

    const notificationId = await t.run(async (ctx) => {
      return await insertNotification(ctx.db, {
        organizationId: orgId,
        userId: userId,
        type: 'task_assigned',
        resourceType: 'task',
        resourceId: 'task-123',
        title: 'New Task',
        message: 'You have been assigned',
      })
    })

    const notification = await t.run(async (ctx) => {
      return await getNotification(ctx.db, notificationId)
    })

    expect(notification?.data).toBeUndefined()
  })
})
