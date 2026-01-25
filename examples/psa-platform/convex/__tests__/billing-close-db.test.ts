/// <reference types="vite/client" />
/**
 * Tests for Billing and Close Phase domain DB functions
 *
 * These tests validate the CRUD operations and business logic for
 * milestones, invoice generation, and project closure functionality.
 *
 * Reference:
 * - .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 * - .review/recipes/psa-platform/specs/12-workflow-billing-phase.md
 * - .review/recipes/psa-platform/specs/13-workflow-close-phase.md
 */

import { describe, it, expect } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

// Import milestone functions
import {
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
} from '../workflows/dealToDelivery/db/milestones'

// Import invoice functions for milestone invoicing tests
import {
  insertInvoice,
  updateInvoiceStatus,
} from '../workflows/dealToDelivery/db/invoices'

// Import project closure verification functions
import {
  getProjectClosureChecklist,
  calculateProjectMetrics,
  cancelFutureBookings,
} from '../workflows/dealToDelivery/db/projects'

// Import lessons learned and scorecard functions
import {
  insertLessonLearned,
  getLessonLearned,
  updateLessonLearned,
  deleteLessonLearned,
  listLessonsLearnedByProject,
  listSuccessesByProject,
  listImprovementsByProject,
  listHighImpactLessons,
  insertLessonsFromRetrospective,
  insertProjectScorecard,
  getProjectScorecard,
  getProjectScorecardByProject,
  updateProjectScorecard,
  deleteProjectScorecard,
  createProjectScorecard,
  getOrganizationScorecardSummary,
} from '../workflows/dealToDelivery/db/lessonsLearned'

// Import functions needed for closure tests
import { insertTask } from '../workflows/dealToDelivery/db/tasks'
import { insertTimeEntry } from '../workflows/dealToDelivery/db/timeEntries'
import { insertExpense } from '../workflows/dealToDelivery/db/expenses'
import { insertBooking } from '../workflows/dealToDelivery/db/bookings'
import { insertBudget } from '../workflows/dealToDelivery/db/budgets'

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

/**
 * Create a test organization
 */
async function createTestOrganization(
  t: TestContext
): Promise<Id<'organizations'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', {
      name: 'Billing Test Organization',
      settings: {},
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a test user
 */
async function createTestUser(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<Id<'users'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId,
      email: `user-${Date.now()}@example.com`,
      name: 'Test User',
      role: 'admin',
      costRate: 10000,
      billRate: 15000,
      skills: [],
      department: 'Finance',
      location: 'Office',
      isActive: true,
      ...overrides,
    })
  })
}

/**
 * Create a test company
 */
async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>
): Promise<Id<'companies'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId,
      name: 'Test Client Company',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })
}

/**
 * Create a test contact
 */
async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<Id<'contacts'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId,
      companyId,
      name: 'Test Contact',
      email: 'contact@test.com',
      phone: '+1-555-1234',
      isPrimary: true,
    })
  })
}

/**
 * Create a test deal
 */
async function createTestDeal(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  contactId: Id<'contacts'>,
  ownerId: Id<'users'>
): Promise<Id<'deals'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId,
      companyId,
      contactId,
      ownerId,
      name: 'Test Deal',
      value: 10000000, // $100,000
      probability: 80,
      stage: 'Won',
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a test project
 */
async function createTestProject(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  dealId: Id<'deals'>,
  managerId: Id<'users'>
): Promise<Id<'projects'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId,
      companyId,
      dealId,
      managerId,
      name: 'Test Project',
      status: 'Active',
      startDate: Date.now(),
      endDate: Date.now() + 90 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    })
  })
}

/**
 * Create a test milestone
 *
 * Schema fields:
 * - name: string
 * - percentage: number (percentage of budget)
 * - amount: number (amount in cents)
 * - dueDate: optional number
 * - completedAt: optional number
 * - invoiceId: optional Id<"invoices">
 * - sortOrder: number
 */
async function createTestMilestone(
  t: TestContext,
  projectId: Id<'projects'>,
  organizationId: Id<'organizations'>,
  overrides: Partial<Omit<Doc<'milestones'>, '_id' | '_creationTime' | 'projectId' | 'organizationId'>> = {}
): Promise<Id<'milestones'>> {
  return await t.run(async (ctx) => {
    return await insertMilestone(ctx.db, {
      projectId,
      organizationId,
      name: overrides.name ?? 'Test Milestone',
      dueDate: overrides.dueDate ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      amount: overrides.amount ?? 2500000, // $25,000
      percentage: overrides.percentage ?? 25, // 25% of project
      sortOrder: overrides.sortOrder ?? 0,
      completedAt: overrides.completedAt,
      invoiceId: overrides.invoiceId,
    })
  })
}

/**
 * Create a test invoice
 */
async function createTestInvoice(
  t: TestContext,
  projectId: Id<'projects'>,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<Id<'invoices'>> {
  return await t.run(async (ctx) => {
    return await insertInvoice(ctx.db, {
      projectId,
      organizationId,
      companyId,
      status: 'Draft',
      method: 'Milestone',
      subtotal: 2500000,
      tax: 0,
      total: 2500000,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    })
  })
}

// =============================================================================
// Milestone DB Function Tests
// =============================================================================

describe('Milestones DB Functions', () => {
  describe('insertMilestone', () => {
    it('creates a new milestone', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId, {
        name: 'Phase 1 Complete',
        amount: 5000000,
        percentage: 50,
      })

      const milestone = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })

      expect(milestone).not.toBeNull()
      expect(milestone!.name).toBe('Phase 1 Complete')
      expect(milestone!.amount).toBe(5000000)
      expect(milestone!.percentage).toBe(50)
      expect(milestone!.projectId).toBe(projectId)
    })
  })

  describe('getMilestone', () => {
    it('returns null for non-existent milestone', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create one milestone just to have a valid ID format
      const milestoneId = await createTestMilestone(t, projectId, orgId)

      // Delete it to make a non-existent but valid format ID
      await t.run(async (ctx) => {
        await ctx.db.delete(milestoneId)
      })

      const result = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })

      expect(result).toBeNull()
    })

    it('returns the milestone when it exists', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId, {
        name: 'Design Phase',
      })

      const milestone = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })

      expect(milestone).not.toBeNull()
      expect(milestone!._id).toBe(milestoneId)
      expect(milestone!.name).toBe('Design Phase')
    })
  })

  describe('updateMilestone', () => {
    it('updates milestone fields', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId, {
        name: 'Original Name',
        amount: 1000000,
      })

      await t.run(async (ctx) => {
        await updateMilestone(ctx.db, milestoneId, {
          name: 'Updated Name',
          amount: 2000000,
        })
      })

      const updated = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })

      expect(updated!.name).toBe('Updated Name')
      expect(updated!.amount).toBe(2000000)
    })

    it('throws error for non-existent milestone', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId)
      await t.run(async (ctx) => {
        await ctx.db.delete(milestoneId)
      })

      await expect(
        t.run(async (ctx) => {
          await updateMilestone(ctx.db, milestoneId, { name: 'New Name' })
        })
      ).rejects.toThrow()
    })
  })

  describe('deleteMilestone', () => {
    it('deletes a milestone', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId)

      await t.run(async (ctx) => {
        await deleteMilestone(ctx.db, milestoneId)
      })

      const deleted = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })

      expect(deleted).toBeNull()
    })
  })

  describe('listMilestonesByProject', () => {
    it('returns all milestones for a project', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      await createTestMilestone(t, projectId, orgId, { name: 'Milestone 1', sortOrder: 0 })
      await createTestMilestone(t, projectId, orgId, { name: 'Milestone 2', sortOrder: 1 })
      await createTestMilestone(t, projectId, orgId, { name: 'Milestone 3', sortOrder: 2 })

      const milestones = await t.run(async (ctx) => {
        return await listMilestonesByProject(ctx.db, projectId)
      })

      expect(milestones).toHaveLength(3)
      expect(milestones.map((m) => m.name)).toContain('Milestone 1')
      expect(milestones.map((m) => m.name)).toContain('Milestone 2')
      expect(milestones.map((m) => m.name)).toContain('Milestone 3')
    })

    it('returns empty array for project with no milestones', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestones = await t.run(async (ctx) => {
        return await listMilestonesByProject(ctx.db, projectId)
      })

      expect(milestones).toHaveLength(0)
    })
  })

  describe('listCompletedMilestones', () => {
    it('returns only completed milestones', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create a completed milestone
      await createTestMilestone(t, projectId, orgId, {
        name: 'Completed Milestone',
        completedAt: Date.now(),
      })
      // Create an incomplete milestone
      await createTestMilestone(t, projectId, orgId, {
        name: 'Incomplete Milestone',
      })

      const completed = await t.run(async (ctx) => {
        return await listCompletedMilestones(ctx.db, projectId)
      })

      expect(completed).toHaveLength(1)
      expect(completed[0].name).toBe('Completed Milestone')
    })
  })

  describe('listUninvoicedMilestones', () => {
    it('returns completed milestones without invoice', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create an invoice for testing
      const invoiceId = await createTestInvoice(t, projectId, orgId, companyId)

      // Completed and uninvoiced (should be returned)
      await createTestMilestone(t, projectId, orgId, {
        name: 'Uninvoiced Milestone',
        completedAt: Date.now(),
      })
      // Completed and invoiced (should not be returned)
      await createTestMilestone(t, projectId, orgId, {
        name: 'Invoiced Milestone',
        completedAt: Date.now(),
        invoiceId,
      })
      // Incomplete (should not be returned)
      await createTestMilestone(t, projectId, orgId, {
        name: 'Incomplete Milestone',
      })

      const uninvoiced = await t.run(async (ctx) => {
        return await listUninvoicedMilestones(ctx.db, projectId)
      })

      expect(uninvoiced).toHaveLength(1)
      expect(uninvoiced[0].name).toBe('Uninvoiced Milestone')
    })
  })

  describe('completeMilestone', () => {
    it('sets completedAt timestamp', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId, {
        name: 'Milestone to Complete',
      })

      const before = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })
      expect(before!.completedAt).toBeUndefined()

      await t.run(async (ctx) => {
        await completeMilestone(ctx.db, milestoneId)
      })

      const after = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })
      expect(after!.completedAt).toBeDefined()
      expect(after!.completedAt).toBeGreaterThan(0)
    })
  })

  describe('markMilestoneInvoiced', () => {
    it('links milestone to invoice', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const milestoneId = await createTestMilestone(t, projectId, orgId, {
        name: 'Milestone for Invoicing',
        completedAt: Date.now(),
      })
      const invoiceId = await createTestInvoice(t, projectId, orgId, companyId)

      const before = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })
      expect(before!.invoiceId).toBeUndefined()

      await t.run(async (ctx) => {
        await markMilestoneInvoiced(ctx.db, milestoneId, invoiceId)
      })

      const after = await t.run(async (ctx) => {
        return await getMilestone(ctx.db, milestoneId)
      })
      expect(after!.invoiceId).toBe(invoiceId)
    })
  })

  describe('getNextMilestoneSortOrder', () => {
    it('returns 0 for project with no milestones', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const sortOrder = await t.run(async (ctx) => {
        return await getNextMilestoneSortOrder(ctx.db, projectId)
      })

      expect(sortOrder).toBe(0)
    })

    it('returns next sort order based on existing milestones', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      await createTestMilestone(t, projectId, orgId, { sortOrder: 0 })
      await createTestMilestone(t, projectId, orgId, { sortOrder: 1 })
      await createTestMilestone(t, projectId, orgId, { sortOrder: 5 }) // Gap in sequence

      const sortOrder = await t.run(async (ctx) => {
        return await getNextMilestoneSortOrder(ctx.db, projectId)
      })

      expect(sortOrder).toBe(6) // max(0,1,5) + 1
    })
  })
})

// =============================================================================
// Additional Invoice Tests (Milestone-Related)
// =============================================================================

describe('Invoice - Milestone Integration', () => {
  it('milestone-based invoice workflow', async () => {
    const t = setup()
    const orgId = await createTestOrganization(t)
    const userId = await createTestUser(t, orgId)
    const companyId = await createTestCompany(t, orgId)
    const contactId = await createTestContact(t, orgId, companyId)
    const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
    const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

    // Create milestone with 25% budget allocation
    const milestoneId = await createTestMilestone(t, projectId, orgId, {
      name: 'Phase 1 Delivery',
      amount: 2500000, // $25,000
      percentage: 25,
    })

    // Complete the milestone
    await t.run(async (ctx) => {
      await completeMilestone(ctx.db, milestoneId)
    })

    // Verify milestone is in uninvoiced list
    const uninvoiced = await t.run(async (ctx) => {
      return await listUninvoicedMilestones(ctx.db, projectId)
    })
    expect(uninvoiced).toHaveLength(1)
    expect(uninvoiced[0]._id).toBe(milestoneId)

    // Create invoice for the milestone
    const invoiceId = await createTestInvoice(t, projectId, orgId, companyId)

    // Mark milestone as invoiced
    await t.run(async (ctx) => {
      await markMilestoneInvoiced(ctx.db, milestoneId, invoiceId)
    })

    // Verify milestone is no longer in uninvoiced list
    const stillUninvoiced = await t.run(async (ctx) => {
      return await listUninvoicedMilestones(ctx.db, projectId)
    })
    expect(stillUninvoiced).toHaveLength(0)

    // Verify milestone has invoice link
    const milestone = await t.run(async (ctx) => {
      return await getMilestone(ctx.db, milestoneId)
    })
    expect(milestone!.invoiceId).toBe(invoiceId)
  })
})

// =============================================================================
// Project Closure Verification Tests (spec 13-workflow-close-phase.md)
// =============================================================================

describe('Project Closure Verification', () => {
  describe('getProjectClosureChecklist', () => {
    it('returns canClose=true for project with no items', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.canClose).toBe(true)
      expect(checklist.allTasksComplete).toBe(true)
      expect(checklist.allTimeEntriesApproved).toBe(true)
      expect(checklist.allExpensesApproved).toBe(true)
      expect(checklist.allItemsInvoiced).toBe(true)
      expect(checklist.allInvoicesPaid).toBe(true)
      expect(checklist.warnings).toHaveLength(0)
    })

    it('returns canClose=false when tasks are incomplete', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create incomplete task
      await t.run(async (ctx) => {
        await insertTask(ctx.db, {
          projectId,
          organizationId: orgId,
          name: 'Incomplete Task',
          description: 'Task in progress',
          status: 'InProgress',
          priority: 'Medium',
          assigneeIds: [userId],
          estimatedHours: 8,
          dependencies: [],
          sortOrder: 0,
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.canClose).toBe(false)
      expect(checklist.allTasksComplete).toBe(false)
      expect(checklist.incompleteTasks).toBe(1)
      expect(checklist.warnings.some((w) => w.includes('task'))).toBe(true)
    })

    it('allows closure when tasks are Done or OnHold', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create done and on-hold tasks
      await t.run(async (ctx) => {
        await insertTask(ctx.db, {
          projectId,
          organizationId: orgId,
          name: 'Done Task',
          description: 'Task completed',
          status: 'Done',
          priority: 'Medium',
          assigneeIds: [userId],
          estimatedHours: 8,
          dependencies: [],
          sortOrder: 0,
          createdAt: Date.now(),
        })
        await insertTask(ctx.db, {
          projectId,
          organizationId: orgId,
          name: 'OnHold Task',
          description: 'Task on hold',
          status: 'OnHold',
          priority: 'Low',
          assigneeIds: [],
          estimatedHours: 4,
          dependencies: [],
          sortOrder: 1,
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.canClose).toBe(true)
      expect(checklist.allTasksComplete).toBe(true)
      expect(checklist.incompleteTasks).toBe(0)
    })

    it('returns canClose=false when time entries are not approved', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create unapproved time entries
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 4,
          notes: 'Draft entry',
          status: 'Draft',
          billable: true,
          createdAt: Date.now(),
        })
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 2,
          notes: 'Submitted entry',
          status: 'Submitted',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.canClose).toBe(false)
      expect(checklist.allTimeEntriesApproved).toBe(false)
      expect(checklist.unapprovedTimeEntries).toBe(2)
      expect(checklist.warnings.some((w) => w.includes('time entry'))).toBe(true)
    })

    it('returns canClose=false when expenses are not approved', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create unapproved expense
      await t.run(async (ctx) => {
        await insertExpense(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          amount: 5000, // $50
          currency: 'USD',
          type: 'Other',
          description: 'Test expense',
          status: 'Submitted',
          billable: false,
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.canClose).toBe(false)
      expect(checklist.allExpensesApproved).toBe(false)
      expect(checklist.unapprovedExpenses).toBe(1)
      expect(checklist.warnings.some((w) => w.includes('expense'))).toBe(true)
    })

    it('warns about uninvoiced billable items but allows closure', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create approved billable time entry without invoice
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 8,
          notes: 'Approved billable entry',
          status: 'Approved',
          billable: true,
          approvedBy: userId,
          approvedAt: Date.now(),
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      // Can close (hard requirements met) but has warning
      expect(checklist.canClose).toBe(true)
      expect(checklist.allItemsInvoiced).toBe(false)
      expect(checklist.uninvoicedTimeEntries).toBe(1)
      expect(checklist.warnings.some((w) => w.includes('not invoiced'))).toBe(true)
    })

    it('warns about unpaid invoices but allows closure', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create unpaid finalized invoice
      await t.run(async (ctx) => {
        const invoiceId = await insertInvoice(ctx.db, {
          projectId,
          organizationId: orgId,
          companyId,
          status: 'Sent',
          method: 'TimeAndMaterials',
          subtotal: 100000, // $1,000
          tax: 0,
          total: 100000,
          dueDate: Date.now() - 7 * 24 * 60 * 60 * 1000, // Past due
          createdAt: Date.now(),
        })
        return invoiceId
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      // Can close (hard requirements met) but has warning
      expect(checklist.canClose).toBe(true)
      expect(checklist.allInvoicesPaid).toBe(false)
      expect(checklist.unpaidInvoices).toBe(1)
      expect(checklist.unpaidAmount).toBe(100000)
      expect(checklist.warnings.some((w) => w.includes('unpaid'))).toBe(true)
    })

    it('counts future bookings to be cancelled', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create future booking
      await t.run(async (ctx) => {
        await insertBooking(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          startDate: Date.now() + 7 * 24 * 60 * 60 * 1000, // Next week
          endDate: Date.now() + 14 * 24 * 60 * 60 * 1000, // 2 weeks out
          hoursPerDay: 8,
          type: 'Confirmed',
          createdAt: Date.now(),
        })
      })

      const checklist = await t.run(async (ctx) => {
        return await getProjectClosureChecklist(ctx.db, projectId)
      })

      expect(checklist.futureBookings).toBe(1)
    })
  })

  describe('calculateProjectMetrics', () => {
    it('calculates metrics for empty project', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.totalRevenue).toBe(0)
      expect(metrics.totalCost).toBe(0)
      expect(metrics.profit).toBe(0)
      expect(metrics.profitMargin).toBe(0)
      expect(metrics.totalHours).toBe(0)
      expect(metrics.billableHours).toBe(0)
    })

    it('calculates revenue from paid invoices', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create paid invoice
      await t.run(async (ctx) => {
        await insertInvoice(ctx.db, {
          projectId,
          organizationId: orgId,
          companyId,
          status: 'Paid',
          method: 'TimeAndMaterials',
          subtotal: 500000, // $5,000
          tax: 0,
          total: 500000,
          dueDate: Date.now(),
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.totalRevenue).toBe(500000)
    })

    it('excludes void invoices from revenue', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create void invoice
      const invoiceId = await t.run(async (ctx) => {
        return await insertInvoice(ctx.db, {
          projectId,
          organizationId: orgId,
          companyId,
          status: 'Finalized',
          method: 'TimeAndMaterials',
          subtotal: 100000,
          tax: 0,
          total: 100000,
          dueDate: Date.now(),
          createdAt: Date.now(),
        })
      })

      // Void the invoice
      await t.run(async (ctx) => {
        await updateInvoiceStatus(ctx.db, invoiceId, 'Void')
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.totalRevenue).toBe(0)
    })

    it('calculates time cost using user cost rates', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId, { costRate: 5000 }) // $50/hr cost
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create time entries - cost rate comes from user record
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 10,
          notes: 'Development work',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.timeCost).toBe(50000) // 10 hours × $50 (from user costRate)
      expect(metrics.totalHours).toBe(10)
      expect(metrics.billableHours).toBe(10)
    })

    it('calculates expense cost', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create approved expenses
      await t.run(async (ctx) => {
        await insertExpense(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          amount: 15000, // $150
          currency: 'USD',
          type: 'Software',
          description: 'Software license',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
        await insertExpense(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          amount: 5000, // $50
          currency: 'USD',
          type: 'Other',
          description: 'Supplies',
          status: 'Approved',
          billable: false,
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.expenseCost).toBe(20000) // $150 + $50
    })

    it('calculates profit and margin correctly', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId, { costRate: 5000 }) // $50/hr
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create revenue (paid invoice)
      await t.run(async (ctx) => {
        await insertInvoice(ctx.db, {
          projectId,
          organizationId: orgId,
          companyId,
          status: 'Paid',
          method: 'TimeAndMaterials',
          subtotal: 100000, // $1,000
          tax: 0,
          total: 100000,
          dueDate: Date.now(),
          createdAt: Date.now(),
        })
      })

      // Create cost (time entry - cost comes from user's costRate)
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 10,
          notes: 'Work',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.totalRevenue).toBe(100000) // $1,000
      expect(metrics.totalCost).toBe(50000) // $500 (10h × $50 from user costRate)
      expect(metrics.profit).toBe(50000) // $500
      expect(metrics.profitMargin).toBe(50) // 50%
    })

    it('calculates budget variance correctly', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId, { costRate: 5000 }) // $50/hr
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create budget
      await t.run(async (ctx) => {
        await insertBudget(ctx.db, {
          projectId,
          organizationId: orgId,
          type: 'TimeAndMaterials',
          totalAmount: 100000, // $1,000 budget
          createdAt: Date.now(),
        })
      })

      // Create cost (80% of budget) - cost comes from user's costRate
      await t.run(async (ctx) => {
        await insertTimeEntry(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          date: Date.now(),
          hours: 16, // 16 × $50 = $800 = 80% of budget
          notes: 'Work',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.budgetVariance).toBe(80) // 80% of budget used
    })

    it('calculates duration in days', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)

      // Create project with known start date
      const startDate = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
      const projectId = await t.run(async (ctx) => {
        return await ctx.db.insert('projects', {
          organizationId: orgId,
          companyId,
          dealId,
          managerId: userId,
          name: 'Test Project',
          status: 'Active',
          startDate,
          endDate: startDate + 60 * 24 * 60 * 60 * 1000, // Planned 60 days
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.durationDays).toBe(30)
      expect(metrics.plannedDurationDays).toBe(60)
    })

    it('uses plannedEndDate for variance when set (spec 13 line 248-252)', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)

      // Create project with BOTH endDate (extended) and plannedEndDate (original plan)
      // This tests the scenario where a project was extended but we need to track
      // the original planned duration for variance calculation
      const startDate = Date.now() - 60 * 24 * 60 * 60 * 1000 // 60 days ago
      const projectId = await t.run(async (ctx) => {
        return await ctx.db.insert('projects', {
          organizationId: orgId,
          companyId,
          dealId,
          managerId: userId,
          name: 'Extended Project',
          status: 'Active',
          startDate,
          endDate: startDate + 90 * 24 * 60 * 60 * 1000, // Current extended end: 90 days
          plannedEndDate: startDate + 45 * 24 * 60 * 60 * 1000, // Original plan: 45 days
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.durationDays).toBe(60) // Actual: 60 days elapsed
      // Should use plannedEndDate (45 days) not endDate (90 days) for variance
      expect(metrics.plannedDurationDays).toBe(45)
    })

    it('falls back to endDate when plannedEndDate is not set', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)

      // Create project with only endDate (no plannedEndDate)
      const startDate = Date.now() - 30 * 24 * 60 * 60 * 1000
      const projectId = await t.run(async (ctx) => {
        return await ctx.db.insert('projects', {
          organizationId: orgId,
          companyId,
          dealId,
          managerId: userId,
          name: 'Test Project',
          status: 'Active',
          startDate,
          endDate: startDate + 50 * 24 * 60 * 60 * 1000, // 50 days
          // plannedEndDate not set
          createdAt: Date.now(),
        })
      })

      const closeDate = Date.now()
      const metrics = await t.run(async (ctx) => {
        return await calculateProjectMetrics(ctx.db, projectId, closeDate)
      })

      expect(metrics.durationDays).toBe(30)
      // Should use endDate (50 days) as fallback
      expect(metrics.plannedDurationDays).toBe(50)
    })
  })

  describe('cancelFutureBookings', () => {
    it('cancels future bookings', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create future bookings
      await t.run(async (ctx) => {
        await insertBooking(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          startDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
          endDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
          hoursPerDay: 8,
          type: 'Confirmed',
          createdAt: Date.now(),
        })
        await insertBooking(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          startDate: Date.now() + 21 * 24 * 60 * 60 * 1000,
          endDate: Date.now() + 28 * 24 * 60 * 60 * 1000,
          hoursPerDay: 4,
          type: 'Tentative',
          createdAt: Date.now(),
        })
      })

      const cancelled = await t.run(async (ctx) => {
        return await cancelFutureBookings(ctx.db, projectId)
      })

      expect(cancelled).toBe(2)
    })

    it('does not cancel past bookings', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create past booking
      await t.run(async (ctx) => {
        await insertBooking(ctx.db, {
          projectId,
          organizationId: orgId,
          userId,
          startDate: Date.now() - 14 * 24 * 60 * 60 * 1000,
          endDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
          hoursPerDay: 8,
          type: 'Confirmed',
          createdAt: Date.now(),
        })
      })

      const cancelled = await t.run(async (ctx) => {
        return await cancelFutureBookings(ctx.db, projectId)
      })

      expect(cancelled).toBe(0)
    })
  })
})

// =============================================================================
// Lessons Learned Tests (spec 13-workflow-close-phase.md)
// =============================================================================

describe('Lessons Learned DB Functions', () => {
  describe('insertLessonLearned', () => {
    it('should insert a success lesson', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const lessonId = await t.run(async (ctx) => {
        return await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'timeline',
          type: 'success',
          description: 'Delivered ahead of schedule',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      expect(lessonId).toBeDefined()
    })

    it('should insert an improvement lesson with recommendation', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const lessonId = await t.run(async (ctx) => {
        return await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'communication',
          type: 'improvement',
          description: 'Client stakeholders were not always available',
          impact: 'medium',
          recommendation: 'Schedule regular check-ins with all stakeholders',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const lesson = await t.run(async (ctx) => {
        return await getLessonLearned(ctx.db, lessonId)
      })

      expect(lesson?.type).toBe('improvement')
      expect(lesson?.recommendation).toBe('Schedule regular check-ins with all stakeholders')
    })
  })

  describe('getLessonLearned', () => {
    it('should return lesson by ID', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const lessonId = await t.run(async (ctx) => {
        return await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'budget',
          type: 'success',
          description: 'Came in under budget',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const lesson = await t.run(async (ctx) => {
        return await getLessonLearned(ctx.db, lessonId)
      })

      expect(lesson?.category).toBe('budget')
      expect(lesson?.description).toBe('Came in under budget')
    })
  })

  describe('updateLessonLearned', () => {
    it('should update lesson description and impact', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const lessonId = await t.run(async (ctx) => {
        return await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'process',
          type: 'improvement',
          description: 'Original description',
          impact: 'low',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await updateLessonLearned(ctx.db, lessonId, {
          description: 'Updated description',
          impact: 'medium',
        })
      })

      const lesson = await t.run(async (ctx) => {
        return await getLessonLearned(ctx.db, lessonId)
      })

      expect(lesson?.description).toBe('Updated description')
      expect(lesson?.impact).toBe('medium')
    })
  })

  describe('deleteLessonLearned', () => {
    it('should delete a lesson', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const lessonId = await t.run(async (ctx) => {
        return await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'other',
          type: 'success',
          description: 'To be deleted',
          impact: 'low',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await deleteLessonLearned(ctx.db, lessonId)
      })

      const lesson = await t.run(async (ctx) => {
        return await getLessonLearned(ctx.db, lessonId)
      })

      expect(lesson).toBeNull()
    })
  })

  describe('listLessonsLearnedByProject', () => {
    it('should return all lessons for a project', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create multiple lessons
      await t.run(async (ctx) => {
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'timeline',
          type: 'success',
          description: 'Lesson 1',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'budget',
          type: 'improvement',
          description: 'Lesson 2',
          impact: 'medium',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'quality',
          type: 'success',
          description: 'Lesson 3',
          impact: 'low',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const lessons = await t.run(async (ctx) => {
        return await listLessonsLearnedByProject(ctx.db, projectId)
      })

      expect(lessons).toHaveLength(3)
    })
  })

  describe('listSuccessesByProject', () => {
    it('should return only success lessons', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create mixed lessons
      await t.run(async (ctx) => {
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'timeline',
          type: 'success',
          description: 'Success 1',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'budget',
          type: 'improvement',
          description: 'Improvement 1',
          impact: 'medium',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'quality',
          type: 'success',
          description: 'Success 2',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const successes = await t.run(async (ctx) => {
        return await listSuccessesByProject(ctx.db, projectId)
      })

      expect(successes).toHaveLength(2)
      expect(successes.every((l) => l.type === 'success')).toBe(true)
    })
  })

  describe('listImprovementsByProject', () => {
    it('should return only improvement lessons', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create mixed lessons
      await t.run(async (ctx) => {
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'communication',
          type: 'improvement',
          description: 'Improvement 1',
          impact: 'high',
          recommendation: 'Do X instead',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'process',
          type: 'success',
          description: 'Success 1',
          impact: 'medium',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const improvements = await t.run(async (ctx) => {
        return await listImprovementsByProject(ctx.db, projectId)
      })

      expect(improvements).toHaveLength(1)
      expect(improvements[0].recommendation).toBe('Do X instead')
    })
  })

  describe('listHighImpactLessons', () => {
    it('should return only high impact lessons', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      // Create lessons with different impacts
      await t.run(async (ctx) => {
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'timeline',
          type: 'success',
          description: 'High impact',
          impact: 'high',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'budget',
          type: 'improvement',
          description: 'Medium impact',
          impact: 'medium',
          createdBy: userId,
          createdAt: Date.now(),
        })
        await insertLessonLearned(ctx.db, {
          projectId,
          organizationId: orgId,
          category: 'quality',
          type: 'success',
          description: 'Low impact',
          impact: 'low',
          createdBy: userId,
          createdAt: Date.now(),
        })
      })

      const highImpact = await t.run(async (ctx) => {
        return await listHighImpactLessons(ctx.db, projectId)
      })

      expect(highImpact).toHaveLength(1)
      expect(highImpact[0].description).toBe('High impact')
    })
  })

  describe('insertLessonsFromRetrospective', () => {
    it('should batch insert successes and improvements', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const count = await t.run(async (ctx) => {
        return await insertLessonsFromRetrospective(
          ctx.db,
          projectId,
          orgId,
          userId,
          [
            { category: 'timeline', description: 'Delivered on time', impact: 'high' },
            { category: 'quality', description: 'High client satisfaction', impact: 'high' },
          ],
          [
            {
              category: 'communication',
              description: 'Stakeholder alignment issues',
              impact: 'medium',
              recommendation: 'Weekly status calls',
            },
          ]
        )
      })

      expect(count).toBe(3)

      const allLessons = await t.run(async (ctx) => {
        return await listLessonsLearnedByProject(ctx.db, projectId)
      })

      expect(allLessons).toHaveLength(3)
      const successes = allLessons.filter((l) => l.type === 'success')
      const improvements = allLessons.filter((l) => l.type === 'improvement')
      expect(successes).toHaveLength(2)
      expect(improvements).toHaveLength(1)
    })
  })
})

// =============================================================================
// Project Scorecard Tests (spec 13-workflow-close-phase.md)
// =============================================================================

describe('Project Scorecards DB Functions', () => {
  describe('insertProjectScorecard', () => {
    it('should insert a project scorecard', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await insertProjectScorecard(ctx.db, {
          projectId,
          organizationId: orgId,
          onTime: true,
          onBudget: true,
          clientSatisfied: true,
          profitable: true,
          clientSatisfactionRating: 5,
          clientFeedback: 'Great project!',
          wouldRecommend: true,
          testimonialProvided: true,
          keyLearnings: ['Always scope early', 'Client communication is key'],
          recommendations: ['Continue weekly check-ins'],
          createdAt: Date.now(),
        })
      })

      expect(scorecardId).toBeDefined()
    })
  })

  describe('getProjectScorecard', () => {
    it('should return scorecard by ID', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await insertProjectScorecard(ctx.db, {
          projectId,
          organizationId: orgId,
          onTime: false,
          onBudget: true,
          clientSatisfied: true,
          profitable: false,
          clientSatisfactionRating: 4,
          createdAt: Date.now(),
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.onTime).toBe(false)
      expect(scorecard?.onBudget).toBe(true)
      expect(scorecard?.profitable).toBe(false)
    })
  })

  describe('getProjectScorecardByProject', () => {
    it('should return scorecard by project ID', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      await t.run(async (ctx) => {
        return await insertProjectScorecard(ctx.db, {
          projectId,
          organizationId: orgId,
          onTime: true,
          onBudget: false,
          clientSatisfied: true,
          profitable: true,
          createdAt: Date.now(),
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecardByProject(ctx.db, projectId)
      })

      expect(scorecard).not.toBeNull()
      expect(scorecard?.onBudget).toBe(false)
    })
  })

  describe('updateProjectScorecard', () => {
    it('should update scorecard fields', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await insertProjectScorecard(ctx.db, {
          projectId,
          organizationId: orgId,
          onTime: true,
          onBudget: true,
          clientSatisfied: false,
          profitable: true,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await updateProjectScorecard(ctx.db, scorecardId, {
          clientSatisfied: true,
          clientSatisfactionRating: 5,
          clientFeedback: 'Updated feedback',
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.clientSatisfied).toBe(true)
      expect(scorecard?.clientSatisfactionRating).toBe(5)
    })
  })

  describe('deleteProjectScorecard', () => {
    it('should delete a scorecard', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await insertProjectScorecard(ctx.db, {
          projectId,
          organizationId: orgId,
          onTime: true,
          onBudget: true,
          clientSatisfied: true,
          profitable: true,
          createdAt: Date.now(),
        })
      })

      await t.run(async (ctx) => {
        await deleteProjectScorecard(ctx.db, scorecardId)
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard).toBeNull()
    })
  })

  describe('createProjectScorecard', () => {
    it('should calculate scorecard from metrics', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const now = Date.now()
      const scorecardId = await t.run(async (ctx) => {
        return await createProjectScorecard(ctx.db, projectId, orgId, {
          actualEndDate: now - 1000, // Finished before planned
          plannedEndDate: now,
          actualCost: 80000, // Under budget
          budgetedCost: 100000,
          profitMargin: 25, // Above 20% default target
          clientSatisfactionRating: 4, // Satisfied
          clientFeedback: 'Good work',
          wouldRecommend: true,
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.onTime).toBe(true) // Finished before planned
      expect(scorecard?.onBudget).toBe(true) // 80k <= 100k
      expect(scorecard?.clientSatisfied).toBe(true) // Rating >= 4
      expect(scorecard?.profitable).toBe(true) // Margin 25% >= 20%
    })

    it('should mark project as late when actual end is after planned', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const now = Date.now()
      const scorecardId = await t.run(async (ctx) => {
        return await createProjectScorecard(ctx.db, projectId, orgId, {
          actualEndDate: now + 1000, // Finished after planned
          plannedEndDate: now,
          actualCost: 80000,
          budgetedCost: 100000,
          profitMargin: 25,
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.onTime).toBe(false)
    })

    it('should mark project as over budget when actual cost exceeds budget', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await createProjectScorecard(ctx.db, projectId, orgId, {
          actualEndDate: Date.now(),
          plannedEndDate: Date.now(),
          actualCost: 120000, // Over budget
          budgetedCost: 100000,
          profitMargin: 10,
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.onBudget).toBe(false)
    })

    it('should mark client as unsatisfied when rating is below 4', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await createProjectScorecard(ctx.db, projectId, orgId, {
          actualEndDate: Date.now(),
          plannedEndDate: Date.now(),
          actualCost: 100000,
          budgetedCost: 100000,
          profitMargin: 20,
          clientSatisfactionRating: 3, // Below 4
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.clientSatisfied).toBe(false)
    })

    it('should mark project as unprofitable when margin is below target', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId = await createTestProject(t, orgId, companyId, dealId, userId)

      const scorecardId = await t.run(async (ctx) => {
        return await createProjectScorecard(ctx.db, projectId, orgId, {
          actualEndDate: Date.now(),
          plannedEndDate: Date.now(),
          actualCost: 100000,
          budgetedCost: 100000,
          profitMargin: 15, // Below 20% default
        })
      })

      const scorecard = await t.run(async (ctx) => {
        return await getProjectScorecard(ctx.db, scorecardId)
      })

      expect(scorecard?.profitable).toBe(false)
    })
  })

  describe('getOrganizationScorecardSummary', () => {
    it('should return zero counts for organization with no scorecards', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)

      const summary = await t.run(async (ctx) => {
        return await getOrganizationScorecardSummary(ctx.db, orgId)
      })

      expect(summary.total).toBe(0)
      expect(summary.onTimeCount).toBe(0)
      expect(summary.averageClientSatisfaction).toBeNull()
    })

    it('should aggregate scorecard metrics across projects', async () => {
      const t = setup()
      const orgId = await createTestOrganization(t)
      const userId = await createTestUser(t, orgId)
      const companyId = await createTestCompany(t, orgId)
      const contactId = await createTestContact(t, orgId, companyId)
      const dealId1 = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId1 = await createTestProject(t, orgId, companyId, dealId1, userId)
      const dealId2 = await createTestDeal(t, orgId, companyId, contactId, userId)
      const projectId2 = await createTestProject(t, orgId, companyId, dealId2, userId)

      // Create scorecards for two projects
      await t.run(async (ctx) => {
        await insertProjectScorecard(ctx.db, {
          projectId: projectId1,
          organizationId: orgId,
          onTime: true,
          onBudget: true,
          clientSatisfied: true,
          profitable: true,
          clientSatisfactionRating: 5,
          createdAt: Date.now(),
        })
        await insertProjectScorecard(ctx.db, {
          projectId: projectId2,
          organizationId: orgId,
          onTime: false,
          onBudget: true,
          clientSatisfied: false,
          profitable: true,
          clientSatisfactionRating: 3,
          createdAt: Date.now(),
        })
      })

      const summary = await t.run(async (ctx) => {
        return await getOrganizationScorecardSummary(ctx.db, orgId)
      })

      expect(summary.total).toBe(2)
      expect(summary.onTimeCount).toBe(1)
      expect(summary.onBudgetCount).toBe(2)
      expect(summary.clientSatisfiedCount).toBe(1)
      expect(summary.profitableCount).toBe(2)
      expect(summary.averageClientSatisfaction).toBe(4) // (5 + 3) / 2
    })
  })
})
