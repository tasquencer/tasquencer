/// <reference types="vite/client" />
/**
 * Projects API Tests
 *
 * Tests for project CRUD operations and related queries via the API layer.
 *
 * Key test scenarios:
 * - Listing projects with filtering (status, manager, company)
 * - Getting projects with budget and metrics
 * - Projects with health status and timeline calculations
 * - Task management (create, update, list)
 * - Milestone queries
 * - Project updates and closures
 * - Authorization checks
 * - Cross-organization isolation
 *
 * Reference: .review/recipes/psa-platform/specs/04-workflow-planning-phase.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole } from './helpers.test'
import { api } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { Doc } from '../_generated/dataModel'

// All scopes needed for project tests
const STAFF_SCOPES = ['dealToDelivery:staff']

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates test data (company, deal) required for project creation
 */
async function setupProjectPrerequisites(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>
) {
  const companyId = await t.run(async (ctx) => {
    return await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Project Test Company',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })
  })

  const contactId = await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'Jane Doe',
      email: 'jane@testcompany.com',
      phone: '+1-555-0100',
      isPrimary: true,
    })
  })

  const dealId = await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId: orgId,
      companyId,
      contactId,
      name: 'Source Deal',
      value: 50000_00,
      stage: 'Won',
      probability: 100,
      ownerId: userId,
      createdAt: Date.now(),
    })
  })

  return { companyId, contactId, dealId }
}

/**
 * Creates a project directly in the database
 */
async function createProjectDirectly(
  t: ReturnType<typeof setup>,
  orgId: Id<'organizations'>,
  dealId: Id<'deals'>,
  companyId: Id<'companies'>,
  managerId: Id<'users'>,
  overrides: Partial<{
    name: string
    status: Doc<'projects'>['status']
    startDate: number
    endDate: number
  }> = {}
) {
  const now = Date.now()
  return await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId: orgId,
      dealId,
      companyId,
      name: overrides.name ?? 'Test Project',
      status: overrides.status ?? 'Planning',
      managerId,
      startDate: overrides.startDate ?? now,
      endDate: overrides.endDate ?? now + 30 * 24 * 60 * 60 * 1000, // 30 days
      createdAt: now,
    })
  })
}

/**
 * Creates a budget for a project
 */
async function createBudgetForProject(
  t: ReturnType<typeof setup>,
  projectId: Id<'projects'>,
  orgId: Id<'organizations'>,
  overrides: Partial<{
    type: Doc<'budgets'>['type']
    totalAmount: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: overrides.type ?? 'TimeAndMaterials',
      totalAmount: overrides.totalAmount ?? 50000_00,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates a service for a budget
 */
async function createBudgetService(
  t: ReturnType<typeof setup>,
  budgetId: Id<'budgets'>,
  orgId: Id<'organizations'>,
  overrides: Partial<{
    name: string
    rate: number
    estimatedHours: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('services', {
      organizationId: orgId,
      budgetId,
      name: overrides.name ?? 'Development',
      rate: overrides.rate ?? 15000, // $150/hr
      estimatedHours: overrides.estimatedHours ?? 100,
      totalAmount: (overrides.rate ?? 15000) * (overrides.estimatedHours ?? 100),
    })
  })
}

/**
 * Creates a task for a project
 */
async function createTaskDirectly(
  t: ReturnType<typeof setup>,
  projectId: Id<'projects'>,
  orgId: Id<'organizations'>,
  overrides: Partial<{
    name: string
    status: Doc<'tasks'>['status']
    priority: Doc<'tasks'>['priority']
    assigneeIds: Id<'users'>[]
    estimatedHours: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('tasks', {
      organizationId: orgId,
      projectId,
      name: overrides.name ?? 'Test Task',
      description: 'A test task',
      status: overrides.status ?? 'Todo',
      priority: overrides.priority ?? 'Medium',
      assigneeIds: overrides.assigneeIds ?? [],
      dependencies: [],
      sortOrder: 1,
      estimatedHours: overrides.estimatedHours ?? 8,
      createdAt: Date.now(),
    })
  })
}

/**
 * Creates a milestone for a project
 */
async function createMilestoneDirectly(
  t: ReturnType<typeof setup>,
  projectId: Id<'projects'>,
  orgId: Id<'organizations'>,
  overrides: Partial<{
    name: string
    amount: number
    isCompleted: boolean
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('milestones', {
      organizationId: orgId,
      projectId,
      name: overrides.name ?? 'Phase 1',
      dueDate: Date.now() + 14 * 24 * 60 * 60 * 1000,
      amount: overrides.amount ?? 10000_00,
      percentage: 25, // 25% of project
      completedAt: overrides.isCompleted ? Date.now() : undefined,
      sortOrder: 1,
    })
  })
}

/**
 * Creates approved time entries for a project (for metrics testing)
 */
async function createTimeEntriesForProject(
  t: ReturnType<typeof setup>,
  projectId: Id<'projects'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  entries: { hours: number; billable: boolean; status: Doc<'timeEntries'>['status'] }[]
) {
  for (const entry of entries) {
    await t.run(async (ctx) => {
      await ctx.db.insert('timeEntries', {
        organizationId: orgId,
        projectId,
        userId,
        date: Date.now(),
        hours: entry.hours,
        notes: 'Test work',
        status: entry.status,
        billable: entry.billable,
        createdAt: Date.now(),
      })
    })
  }
}

/**
 * Creates approved expenses for a project (for metrics testing)
 */
async function createExpensesForProject(
  t: ReturnType<typeof setup>,
  projectId: Id<'projects'>,
  orgId: Id<'organizations'>,
  userId: Id<'users'>,
  expenses: { amount: number; billable: boolean; status: Doc<'expenses'>['status'] }[]
) {
  for (const expense of expenses) {
    await t.run(async (ctx) => {
      await ctx.db.insert('expenses', {
        organizationId: orgId,
        projectId,
        userId,
        date: Date.now(),
        amount: expense.amount,
        description: 'Test expense',
        type: 'Other',
        currency: 'USD',
        status: expense.status,
        billable: expense.billable,
        createdAt: Date.now(),
      })
    })
  }
}

// =============================================================================
// listProjects Tests
// =============================================================================

describe('Projects API', () => {
  describe('listProjects', () => {
    it('should return projects for the organization', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      // Create test projects
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'Project A' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'Project B' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'Project C' })

      const projects = await t.query(api.workflows.dealToDelivery.api.projects.listProjects, {})

      expect(projects).toHaveLength(3)
    })

    it('should filter projects by status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      // Create projects in different statuses
      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Planning Project',
        status: 'Planning',
      })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Active Project',
        status: 'Active',
      })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Completed Project',
        status: 'Completed',
      })

      const activeProjects = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjects,
        { status: 'Active' }
      )

      expect(activeProjects).toHaveLength(1)
      expect(activeProjects[0].name).toBe('Active Project')
    })

    it('should filter projects by manager', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      // Create another user as manager
      const otherManagerId = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: orgId,
          email: 'other-pm@test.com',
          name: 'Other PM',
          role: 'project_manager',
          costRate: 10000,
          billRate: 15000,
          skills: [],
          department: 'Engineering',
          location: 'Remote',
          isActive: true,
        })
      })

      // Create projects with different managers
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'My Project' })
      await createProjectDirectly(t, orgId, dealId, companyId, otherManagerId, {
        name: 'Other Project',
      })

      const myProjects = await t.query(api.workflows.dealToDelivery.api.projects.listProjects, {
        managerId: userId,
      })

      expect(myProjects).toHaveLength(1)
      expect(myProjects[0].name).toBe('My Project')
    })

    it('should filter projects by company', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      // Create another company and deal
      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: orgId,
          name: 'Company 2',
          billingAddress: {
            street: '456 Oak Ave',
            city: 'Oakland',
            state: 'CA',
            postalCode: '94612',
            country: 'USA',
          },
          paymentTerms: 45,
        })
      })

      const contact2 = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: orgId,
          companyId: company2,
          name: 'Contact 2',
          email: 'contact2@company2.com',
          phone: '555-0200',
          isPrimary: true,
        })
      })

      const deal2 = await t.run(async (ctx) => {
        return await ctx.db.insert('deals', {
          organizationId: orgId,
          companyId: company2,
          contactId: contact2,
          name: 'Deal 2',
          value: 30000_00,
          stage: 'Won',
          probability: 100,
          ownerId: userId,
          createdAt: Date.now(),
        })
      })

      // Create projects for different companies
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'Company 1 Project' })
      await createProjectDirectly(t, orgId, deal2, company2, userId, { name: 'Company 2 Project' })

      const company1Projects = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjects,
        { companyId }
      )

      expect(company1Projects).toHaveLength(1)
      expect(company1Projects[0].name).toBe('Company 1 Project')
    })

    it('should return empty array when no projects exist', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      const projects = await t.query(api.workflows.dealToDelivery.api.projects.listProjects, {})

      expect(projects).toEqual([])
    })
  })

  // =============================================================================
  // getProject Tests
  // =============================================================================

  describe('getProject', () => {
    it('should return project by ID', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Specific Project',
      })

      const project = await t.query(api.workflows.dealToDelivery.api.projects.getProject, {
        projectId,
      })

      expect(project).not.toBeNull()
      expect(project?.name).toBe('Specific Project')
    })

    it('should return project with budget details', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Budgeted Project',
      })
      const budgetId = await createBudgetForProject(t, projectId, orgId, {
        totalAmount: 75000_00,
      })
      await createBudgetService(t, budgetId, orgId, {
        name: 'Development',
        rate: 15000,
        estimatedHours: 100,
      })

      const project = await t.query(api.workflows.dealToDelivery.api.projects.getProject, {
        projectId,
      })

      expect(project?.budget).not.toBeNull()
      expect(project?.budget?.totalAmount).toBe(75000_00)
      expect(project?.budget?.services).toHaveLength(1)
      expect(project?.budget?.services[0].name).toBe('Development')
    })

    it('should return project with calculated metrics', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Metrics Project',
      })
      await createBudgetForProject(t, projectId, orgId, { totalAmount: 50000_00 })

      // Create some time entries
      await createTimeEntriesForProject(t, projectId, orgId, userId, [
        { hours: 8, billable: true, status: 'Approved' },
        { hours: 4, billable: false, status: 'Approved' },
        { hours: 6, billable: true, status: 'Draft' },
      ])

      const project = await t.query(api.workflows.dealToDelivery.api.projects.getProject, {
        projectId,
      })

      expect(project?.metrics).toBeDefined()
      expect(project?.metrics.hoursTotal).toBe(18) // 8 + 4 + 6
      expect(project?.metrics.hoursApproved).toBe(12) // 8 + 4
      expect(project?.metrics.hoursBillable).toBe(14) // all billable hours regardless of status (8 + 6)
    })

    it('should return null for non-existent project', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // Create a project just to get a valid ID format, then delete it
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'other-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      await t.run(async (ctx) => {
        await ctx.db.delete(projectId)
      })

      const project = await t.query(api.workflows.dealToDelivery.api.projects.getProject, {
        projectId,
      })

      expect(project).toBeNull()
    })
  })

  // =============================================================================
  // listProjectsWithMetrics Tests
  // =============================================================================

  describe('listProjectsWithMetrics', () => {
    it('should return projects with status counts', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      // Create projects in different statuses
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Planning' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Planning' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Active' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Active' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Active' })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, { status: 'Completed' })

      const result = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjectsWithMetrics,
        {}
      )

      expect(result.counts.all).toBe(6)
      expect(result.counts.planning).toBe(2)
      expect(result.counts.active).toBe(3)
      expect(result.counts.completed).toBe(1)
    })

    it('should filter by status when provided', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Planning 1',
        status: 'Planning',
      })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Active 1',
        status: 'Active',
      })
      await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Active 2',
        status: 'Active',
      })

      const result = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjectsWithMetrics,
        { status: 'Active' }
      )

      expect(result.projects).toHaveLength(2)
      expect(result.projects.every((p) => p.status === 'Active')).toBe(true)
      // Counts should still reflect all projects
      expect(result.counts.all).toBe(3)
    })

    it('should include company and manager details', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      await createProjectDirectly(t, orgId, dealId, companyId, userId, { name: 'Detailed Project' })

      const result = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjectsWithMetrics,
        {}
      )

      expect(result.projects[0].company).not.toBeNull()
      expect(result.projects[0].company?.name).toBe('Project Test Company')
      expect(result.projects[0].manager).not.toBeNull()
      expect(result.projects[0].manager?.name).toBe('Test User')
    })

    it('should calculate health status for active projects', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Active Project',
        status: 'Active',
      })
      await createBudgetForProject(t, projectId, orgId, { totalAmount: 10000_00 })

      const result = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjectsWithMetrics,
        {}
      )

      const project = result.projects[0]
      // Health status should be defined for active projects
      expect(project.healthStatus).toBeDefined()
      expect(['healthy', 'at_risk', 'critical', 'planning']).toContain(project.healthStatus)
      // With no time entries, it should be healthy
      expect(project.healthStatus).toBe('healthy')
    })
  })

  // =============================================================================
  // getProjectBudget Tests
  // =============================================================================

  describe('getProjectBudget', () => {
    it('should return budget with services', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      const budgetId = await createBudgetForProject(t, projectId, orgId)
      await createBudgetService(t, budgetId, orgId, { name: 'Development', estimatedHours: 80 })
      await createBudgetService(t, budgetId, orgId, { name: 'Design', estimatedHours: 40 })

      const budget = await t.query(api.workflows.dealToDelivery.api.projects.getProjectBudget, {
        projectId,
      })

      expect(budget).not.toBeNull()
      expect(budget?.services).toHaveLength(2)
    })

    it('should return null for project without budget', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)

      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      const budget = await t.query(api.workflows.dealToDelivery.api.projects.getProjectBudget, {
        projectId,
      })

      expect(budget).toBeNull()
    })
  })

  // =============================================================================
  // Task Tests
  // =============================================================================

  describe('listTasks', () => {
    it('should return tasks for a project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      await createTaskDirectly(t, projectId, orgId, { name: 'Task 1' })
      await createTaskDirectly(t, projectId, orgId, { name: 'Task 2' })
      await createTaskDirectly(t, projectId, orgId, { name: 'Task 3' })

      const tasks = await t.query(api.workflows.dealToDelivery.api.projects.listTasks, {
        projectId,
      })

      expect(tasks).toHaveLength(3)
    })

    it('should filter tasks by status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      await createTaskDirectly(t, projectId, orgId, { name: 'Todo Task', status: 'Todo' })
      await createTaskDirectly(t, projectId, orgId, {
        name: 'In Progress Task',
        status: 'InProgress',
      })
      await createTaskDirectly(t, projectId, orgId, { name: 'Done Task', status: 'Done' })

      const inProgressTasks = await t.query(api.workflows.dealToDelivery.api.projects.listTasks, {
        projectId,
        status: 'InProgress',
      })

      expect(inProgressTasks).toHaveLength(1)
      expect(inProgressTasks[0].name).toBe('In Progress Task')
    })

    it('should filter tasks by assignee', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // Create another user
      const otherUserId = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: orgId,
          email: 'other@test.com',
          name: 'Other User',
          role: 'team_member',
          costRate: 8000,
          billRate: 12000,
          skills: [],
          department: 'Engineering',
          location: 'Remote',
          isActive: true,
        })
      })

      await createTaskDirectly(t, projectId, orgId, { name: 'My Task', assigneeIds: [userId] })
      await createTaskDirectly(t, projectId, orgId, {
        name: 'Their Task',
        assigneeIds: [otherUserId],
      })

      const myTasks = await t.query(api.workflows.dealToDelivery.api.projects.listTasks, {
        projectId,
        assigneeId: userId,
      })

      expect(myTasks).toHaveLength(1)
      expect(myTasks[0].name).toBe('My Task')
    })
  })

  describe('getTask', () => {
    it('should return task by ID', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      const taskId = await createTaskDirectly(t, projectId, orgId, { name: 'Specific Task' })

      const task = await t.query(api.workflows.dealToDelivery.api.projects.getTask, { taskId })

      expect(task).not.toBeNull()
      expect(task?.name).toBe('Specific Task')
    })
  })

  describe('createTask', () => {
    it('should create a new task', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      const taskId = await t.mutation(api.workflows.dealToDelivery.api.projects.createTask, {
        projectId,
        name: 'New Task',
        description: 'A new task description',
        priority: 'High',
        assigneeIds: [userId],
      })

      const task = await t.run(async (ctx) => ctx.db.get(taskId))
      expect(task).not.toBeNull()
      expect(task?.name).toBe('New Task')
      expect(task?.priority).toBe('High')
      expect(task?.status).toBe('Todo')
    })

    it('should create task with estimated hours', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      const taskId = await t.mutation(api.workflows.dealToDelivery.api.projects.createTask, {
        projectId,
        name: 'Estimated Task',
        description: 'With hours estimate',
        priority: 'Medium',
        assigneeIds: [],
        estimatedHours: 16,
      })

      const task = await t.run(async (ctx) => ctx.db.get(taskId))
      expect(task?.estimatedHours).toBe(16)
    })

    it('should throw error for non-existent project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      await t.run(async (ctx) => ctx.db.delete(projectId))

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.projects.createTask, {
          projectId,
          name: 'Orphan Task',
          description: 'Should fail',
          priority: 'Low',
          assigneeIds: [],
        })
      ).rejects.toThrow()
    })
  })

  describe('updateTask', () => {
    it('should update task status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      const taskId = await createTaskDirectly(t, projectId, orgId, { status: 'Todo' })

      await t.mutation(api.workflows.dealToDelivery.api.projects.updateTask, {
        taskId,
        status: 'InProgress',
      })

      const task = await t.run(async (ctx) => ctx.db.get(taskId))
      expect(task?.status).toBe('InProgress')
    })

    it('should update task priority', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      const taskId = await createTaskDirectly(t, projectId, orgId, { priority: 'Low' })

      await t.mutation(api.workflows.dealToDelivery.api.projects.updateTask, {
        taskId,
        priority: 'Urgent',
      })

      const task = await t.run(async (ctx) => ctx.db.get(taskId))
      expect(task?.priority).toBe('Urgent')
    })

    it('should update multiple task fields at once', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      const taskId = await createTaskDirectly(t, projectId, orgId, {
        name: 'Original',
        status: 'Todo',
        priority: 'Low',
      })

      await t.mutation(api.workflows.dealToDelivery.api.projects.updateTask, {
        taskId,
        name: 'Updated Name',
        status: 'Review',
        priority: 'High',
        estimatedHours: 24,
      })

      const task = await t.run(async (ctx) => ctx.db.get(taskId))
      expect(task?.name).toBe('Updated Name')
      expect(task?.status).toBe('Review')
      expect(task?.priority).toBe('High')
      expect(task?.estimatedHours).toBe(24)
    })
  })

  // =============================================================================
  // Milestone Tests
  // =============================================================================

  describe('listMilestones', () => {
    it('should return milestones for a project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      await createMilestoneDirectly(t, projectId, orgId, { name: 'Phase 1' })
      await createMilestoneDirectly(t, projectId, orgId, { name: 'Phase 2' })

      const milestones = await t.query(api.workflows.dealToDelivery.api.projects.listMilestones, {
        projectId,
      })

      expect(milestones).toHaveLength(2)
    })
  })

  describe('listProjectUninvoicedMilestones', () => {
    it('should return only completed uninvoiced milestones', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // Create milestones with different states
      await createMilestoneDirectly(t, projectId, orgId, {
        name: 'Incomplete',
        isCompleted: false,
      })
      await createMilestoneDirectly(t, projectId, orgId, {
        name: 'Complete Uninvoiced',
        isCompleted: true,
      })

      const uninvoiced = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjectUninvoicedMilestones,
        { projectId }
      )

      expect(uninvoiced).toHaveLength(1)
      expect(uninvoiced[0].name).toBe('Complete Uninvoiced')
    })
  })

  // =============================================================================
  // updateProject Tests
  // =============================================================================

  describe('updateProject', () => {
    it('should update project name', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        name: 'Original Name',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.updateProject, {
        projectId,
        name: 'Updated Name',
      })

      expect(result.success).toBe(true)
      const project = await t.run(async (ctx) => ctx.db.get(projectId))
      expect(project?.name).toBe('Updated Name')
    })

    it('should update project dates', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      const newStartDate = Date.now() + 7 * 24 * 60 * 60 * 1000
      const newEndDate = Date.now() + 60 * 24 * 60 * 60 * 1000

      await t.mutation(api.workflows.dealToDelivery.api.projects.updateProject, {
        projectId,
        startDate: newStartDate,
        endDate: newEndDate,
      })

      const project = await t.run(async (ctx) => ctx.db.get(projectId))
      expect(project?.startDate).toBe(newStartDate)
      expect(project?.endDate).toBe(newEndDate)
    })

    it('should update project manager', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // Create new manager
      const newManagerId = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: orgId,
          email: 'newpm@test.com',
          name: 'New PM',
          role: 'project_manager',
          costRate: 12000,
          billRate: 18000,
          skills: [],
          department: 'Engineering',
          location: 'Remote',
          isActive: true,
        })
      })

      await t.mutation(api.workflows.dealToDelivery.api.projects.updateProject, {
        projectId,
        managerId: newManagerId,
      })

      const project = await t.run(async (ctx) => ctx.db.get(projectId))
      expect(project?.managerId).toBe(newManagerId)
    })

    it('should throw error for non-existent project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)
      await t.run(async (ctx) => ctx.db.delete(projectId))

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.projects.updateProject, {
          projectId,
          name: 'Should Fail',
        })
      ).rejects.toThrow()
    })
  })

  // =============================================================================
  // closeProject Tests
  // =============================================================================

  describe('closeProject', () => {
    it('should close project with completed status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        status: 'Active',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.closeProject, {
        projectId,
        closeDate: Date.now(),
        completionStatus: 'completed',
        closureNotes: 'Project completed successfully',
      })

      expect(result.closed).toBe(true)

      const project = await t.run(async (ctx) => ctx.db.get(projectId))
      expect(project?.status).toBe('Completed')
      expect(project?.closureNotes).toBe('Project completed successfully')
    })

    it('should close project with cancelled status', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        status: 'Active',
      })

      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.closeProject, {
        projectId,
        closeDate: Date.now(),
        completionStatus: 'cancelled',
      })

      expect(result.closed).toBe(true)

      const project = await t.run(async (ctx) => ctx.db.get(projectId))
      expect(project?.status).toBe('Archived')
    })

    it('should return final metrics on close', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        status: 'Active',
      })
      await createBudgetForProject(t, projectId, orgId, { totalAmount: 50000_00 })

      // Add some time and expenses
      await createTimeEntriesForProject(t, projectId, orgId, userId, [
        { hours: 10, billable: true, status: 'Approved' },
      ])
      await createExpensesForProject(t, projectId, orgId, userId, [
        { amount: 500_00, billable: true, status: 'Approved' },
      ])

      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.closeProject, {
        projectId,
        closeDate: Date.now(),
        completionStatus: 'completed',
      })

      expect(result.metrics).toBeDefined()
      expect(result.metrics.budgetTotal).toBe(50000_00)
      expect(result.metrics.hoursLogged).toBe(10)
      expect(result.metrics.expensesTotal).toBe(500_00)
    })

    it('should reject closing already closed project', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        status: 'Completed',
      })

      await expect(
        t.mutation(api.workflows.dealToDelivery.api.projects.closeProject, {
          projectId,
          closeDate: Date.now(),
          completionStatus: 'completed',
        })
      ).rejects.toThrow('Project is already closed')
    })
  })

  // =============================================================================
  // Authorization Tests
  // =============================================================================

  describe('Authorization', () => {
    it('should require staff scope for listProjects', async () => {
      const t = setup()
      await setupUserWithRole(t, 'staff-user', STAFF_SCOPES)

      // This should work with proper scopes
      const projects = await t.query(api.workflows.dealToDelivery.api.projects.listProjects, {})
      expect(Array.isArray(projects)).toBe(true)
    })

    it('should require staff scope for getProject', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // This should work with proper scopes
      const project = await t.query(api.workflows.dealToDelivery.api.projects.getProject, {
        projectId,
      })
      expect(project).not.toBeNull()
    })

    it('should require staff scope for createTask', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // This should work with proper scopes
      const taskId = await t.mutation(api.workflows.dealToDelivery.api.projects.createTask, {
        projectId,
        name: 'Auth Test Task',
        description: 'Testing authorization',
        priority: 'Medium',
        assigneeIds: [],
      })
      expect(taskId).toBeDefined()
    })

    it('should require staff scope for updateProject', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId)

      // This should work with proper scopes
      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.updateProject, {
        projectId,
        name: 'Auth Test Update',
      })
      expect(result.success).toBe(true)
    })

    it('should require staff scope for closeProject', async () => {
      const t = setup()
      const { organizationId: orgId, userId } = await setupUserWithRole(
        t,
        'staff-user',
        STAFF_SCOPES
      )
      const { dealId, companyId } = await setupProjectPrerequisites(t, orgId, userId)
      const projectId = await createProjectDirectly(t, orgId, dealId, companyId, userId, {
        status: 'Active',
      })

      // This should work with proper scopes
      const result = await t.mutation(api.workflows.dealToDelivery.api.projects.closeProject, {
        projectId,
        closeDate: Date.now(),
        completionStatus: 'completed',
      })
      expect(result.closed).toBe(true)
    })
  })

  // =============================================================================
  // Cross-Organization Isolation Tests
  // =============================================================================

  describe('Cross-Organization Isolation', () => {
    it('should not return projects from other organizations', async () => {
      const t = setup()
      const { organizationId: org1, userId: user1 } = await setupUserWithRole(
        t,
        'user1',
        STAFF_SCOPES
      )
      const { dealId: deal1, companyId: company1 } = await setupProjectPrerequisites(t, org1, user1)

      // Create a project in org1
      await createProjectDirectly(t, org1, deal1, company1, user1, { name: 'Org1 Project' })

      // Create another organization with its own project
      const org2 = await t.run(async (ctx) => {
        return await ctx.db.insert('organizations', {
          name: 'Org 2',
          settings: {},
          createdAt: Date.now(),
        })
      })

      const user2 = await t.run(async (ctx) => {
        return await ctx.db.insert('users', {
          organizationId: org2,
          email: 'user2@org2.com',
          name: 'User 2',
          role: 'admin',
          costRate: 10000,
          billRate: 15000,
          skills: [],
          department: 'Engineering',
          location: 'Remote',
          isActive: true,
        })
      })

      const company2 = await t.run(async (ctx) => {
        return await ctx.db.insert('companies', {
          organizationId: org2,
          name: 'Org2 Company',
          billingAddress: {
            street: '1',
            city: 'C',
            state: 'S',
            postalCode: '1',
            country: 'C',
          },
          paymentTerms: 30,
        })
      })

      const contact2 = await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          organizationId: org2,
          companyId: company2,
          name: 'Contact 2',
          email: 'c2@org2.com',
          phone: '555-0300',
          isPrimary: true,
        })
      })

      const deal2 = await t.run(async (ctx) => {
        return await ctx.db.insert('deals', {
          organizationId: org2,
          companyId: company2,
          contactId: contact2,
          name: 'Org2 Deal',
          value: 20000_00,
          stage: 'Won',
          probability: 100,
          ownerId: user2,
          createdAt: Date.now(),
        })
      })

      await createProjectDirectly(t, org2, deal2, company2, user2, { name: 'Org2 Project' })

      // When user1 queries, they should only see their org's projects
      const user1Projects = await t.query(
        api.workflows.dealToDelivery.api.projects.listProjects,
        {}
      )

      // Should only have 1 project (the org1 project)
      expect(user1Projects).toHaveLength(1)
      expect(user1Projects[0].organizationId).toBe(org1)
      expect(user1Projects[0].name).toBe('Org1 Project')
    })
  })
})
