/**
 * Projects API
 *
 * Domain-specific queries and mutations for project management.
 * These provide read access and helper mutations for work item handlers.
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/04-workflow-planning-phase.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getProject as getProjectFromDb,
  listProjectsByOrganization,
  listProjectsByStatus,
  listProjectsByManager,
  listProjectsByCompany,
  getBudgetByProjectId,
  listServicesByBudget,
  listTasksByProject,
  listTasksByStatus,
  listTasksByAssignee,
  getTask as getTaskFromDb,
  insertTask,
  updateTask as updateTaskInDb,
  getNextTaskSortOrder,
  calculateProjectHours,
  calculateProjectExpenses,
  listUninvoicedMilestones,
  listMilestonesByProject,
  listChangeOrdersByProject,
} from '../db'
import { getUser } from '../db/users'
import { getCompany } from '../db/companies'
import { authComponent } from '../../../auth'

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Lists projects for the current user's organization with optional filters.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.status - Optional filter by project status
 * @param args.managerId - Optional filter by project manager
 * @param args.companyId - Optional filter by company
 * @returns Array of projects (limited to 50)
 */
export const listProjects = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('Planning'),
        v.literal('Active'),
        v.literal('OnHold'),
        v.literal('Completed'),
        v.literal('Archived')
      )
    ),
    managerId: v.optional(v.id('users')),
    companyId: v.optional(v.id('companies')),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return []
    }

    // Apply filters based on provided arguments
    if (args.managerId) {
      return await listProjectsByManager(ctx.db, args.managerId)
    }

    if (args.companyId) {
      return await listProjectsByCompany(ctx.db, args.companyId)
    }

    if (args.status) {
      return await listProjectsByStatus(ctx.db, user.organizationId, args.status)
    }

    // No filters - return all projects for the organization
    return await listProjectsByOrganization(ctx.db, user.organizationId)
  },
})

/**
 * Gets a project by ID with budget, team, and metrics.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns The project with budget details and calculated metrics, or null
 */
export const getProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Fetch project
    const project = await getProjectFromDb(ctx.db, args.projectId)
    if (!project) {
      return null
    }

    // Load budget and calculate metrics in parallel
    const [budget, hours, expenses] = await Promise.all([
      getBudgetByProjectId(ctx.db, args.projectId),
      calculateProjectHours(ctx.db, args.projectId),
      calculateProjectExpenses(ctx.db, args.projectId),
    ])

    // Load services if budget exists
    const services = budget ? await listServicesByBudget(ctx.db, budget._id) : []

    // Calculate budget metrics
    const budgetTotal = budget?.totalAmount ?? 0
    const hoursUsed = hours.approved
    const expensesUsed = expenses.approved

    // Calculate estimated hours from services
    const estimatedHours = services.reduce((sum, s) => sum + s.estimatedHours, 0)

    return {
      ...project,
      budget: budget
        ? {
            ...budget,
            services,
          }
        : null,
      metrics: {
        budgetTotal,
        hoursTotal: hours.total,
        hoursApproved: hours.approved,
        hoursBillable: hours.billable,
        estimatedHours,
        hoursRemaining: Math.max(0, estimatedHours - hoursUsed),
        expensesTotal: expenses.total,
        expensesApproved: expenses.approved,
        expensesBillable: expenses.billable,
        budgetUsed: hoursUsed + expensesUsed,
        budgetRemaining: Math.max(0, budgetTotal - (hoursUsed + expensesUsed)),
      },
    }
  },
})

/**
 * Lists projects with full metrics for the projects list page.
 * Calculates health status, budget burn, timeline progress, etc.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.status - Optional filter by project status
 * @returns Projects with metrics and counts by status
 *
 * Reference: .review/recipes/psa-platform/specs/24-ui-projects-list.md
 */
export const listProjectsWithMetrics = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('Planning'),
        v.literal('Active'),
        v.literal('OnHold'),
        v.literal('Completed'),
        v.literal('Archived')
      )
    ),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return { projects: [], counts: { all: 0, active: 0, planning: 0, onHold: 0, completed: 0 } }
    }

    // Fetch all projects for the organization
    const allProjects = await listProjectsByOrganization(ctx.db, user.organizationId, 100)

    // Calculate counts
    const counts = {
      all: allProjects.length,
      active: allProjects.filter(p => p.status === 'Active').length,
      planning: allProjects.filter(p => p.status === 'Planning').length,
      onHold: allProjects.filter(p => p.status === 'OnHold').length,
      completed: allProjects.filter(p => p.status === 'Completed').length,
    }

    // Filter by status if provided
    const filteredProjects = args.status
      ? allProjects.filter(p => p.status === args.status)
      : allProjects

    // Enrich each project with metrics
    const projectsWithMetrics = await Promise.all(
      filteredProjects.map(async (project) => {
        // Load company, manager, budget, and metrics in parallel
        const [company, manager, budget, hours, expenses] = await Promise.all([
          project.companyId ? getCompany(ctx.db, project.companyId) : null,
          project.managerId ? getUser(ctx.db, project.managerId) : null,
          getBudgetByProjectId(ctx.db, project._id),
          calculateProjectHours(ctx.db, project._id),
          calculateProjectExpenses(ctx.db, project._id),
        ])

        // Get services for estimated hours if budget exists
        const services = budget ? await listServicesByBudget(ctx.db, budget._id) : []
        const estimatedHours = services.reduce((sum, s) => sum + s.estimatedHours, 0)

        // Calculate budget metrics
        const budgetTotal = budget?.totalAmount ?? 0
        const budgetBurned = hours.approved + expenses.approved
        const budgetBurnPercent = budgetTotal > 0 ? Math.round((budgetBurned / budgetTotal) * 100) : 0

        // Calculate timeline metrics
        const now = Date.now()
        const startDate = project.startDate
        const endDate = project.endDate
        let daysElapsed = 0
        let totalDays = 0
        let progressPercent = 0
        let timelineStatus: 'on_track' | 'delayed' | 'ahead' | 'not_started' = 'not_started'

        if (startDate && endDate) {
          totalDays = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)))
          if (now >= startDate) {
            daysElapsed = Math.ceil((Math.min(now, endDate) - startDate) / (1000 * 60 * 60 * 24))
            progressPercent = Math.min(100, Math.round((daysElapsed / totalDays) * 100))

            // Determine timeline status based on progress vs burn rate
            if (now > endDate) {
              timelineStatus = project.status === 'Completed' ? 'on_track' : 'delayed'
            } else if (budgetBurnPercent > progressPercent + 15) {
              timelineStatus = 'delayed'
            } else if (budgetBurnPercent < progressPercent - 15) {
              timelineStatus = 'ahead'
            } else {
              timelineStatus = 'on_track'
            }
          }
        }

        // Calculate health status per spec
        const isDelayed = timelineStatus === 'delayed'
        let healthStatus: 'healthy' | 'at_risk' | 'critical' | 'planning' = 'planning'
        if (project.status === 'Planning') {
          healthStatus = 'planning'
        } else if (budgetBurnPercent > 90 || isDelayed) {
          healthStatus = 'critical'
        } else if (budgetBurnPercent >= 75) {
          healthStatus = 'at_risk'
        } else {
          healthStatus = 'healthy'
        }

        // Calculate revenue (approved billable hours * average rate)
        // For simplicity, use a default rate. In full implementation,
        // this would sum (hours * service.rate) per service
        const avgRate = services.length > 0
          ? services.reduce((sum, s) => sum + s.rate, 0) / services.length
          : 15000 // $150/hr in cents
        const revenue = Math.round(hours.billable * avgRate / 100) // in cents

        // Calculate margin (revenue - costs) / revenue
        const costs = budgetBurned
        const margin = revenue > 0 ? Math.round(((revenue - costs) / revenue) * 100) : 0

        return {
          _id: project._id,
          name: project.name,
          status: project.status,
          company: company ? { _id: company._id, name: company.name } : null,
          manager: manager ? { _id: manager._id, name: manager.name } : null,
          startDate: project.startDate,
          endDate: project.endDate,
          budget: {
            total: budgetTotal,
            burned: budgetBurned,
            burnPercent: budgetBurnPercent,
          },
          timeline: {
            daysElapsed,
            totalDays,
            progressPercent,
            status: timelineStatus,
          },
          metrics: {
            hoursLogged: hours.total,
            hoursEstimated: estimatedHours,
            revenue,
            margin,
          },
          healthStatus,
        }
      })
    )

    return { projects: projectsWithMetrics, counts }
  },
})

/**
 * Gets project budget with services.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns The budget with services, or null if no budget exists
 */
export const getProjectBudget = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const budget = await getBudgetByProjectId(ctx.db, args.projectId)
    if (!budget) {
      return null
    }

    const services = await listServicesByBudget(ctx.db, budget._id)

    return {
      ...budget,
      services,
    }
  },
})

/**
 * Lists tasks for a project with optional filters.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @param args.status - Optional filter by task status
 * @param args.assigneeId - Optional filter by assignee
 * @returns Array of tasks (limited to 100)
 */
export const listTasks = query({
  args: {
    projectId: v.id('projects'),
    status: v.optional(
      v.union(
        v.literal('Todo'),
        v.literal('InProgress'),
        v.literal('Review'),
        v.literal('Done'),
        v.literal('OnHold')
      )
    ),
    assigneeId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Apply filters based on provided arguments
    if (args.status) {
      return await listTasksByStatus(ctx.db, args.projectId, args.status)
    }

    if (args.assigneeId) {
      return await listTasksByAssignee(ctx.db, args.projectId, args.assigneeId)
    }

    // No filters - return all tasks for the project
    return await listTasksByProject(ctx.db, args.projectId)
  },
})

/**
 * Gets a task by ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.taskId - The task ID
 * @returns The task document or null
 */
export const getTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await getTaskFromDb(ctx.db, args.taskId)
  },
})

/**
 * Lists milestones for a project.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns Array of milestones
 */
export const listMilestones = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await listMilestonesByProject(ctx.db, args.projectId)
  },
})

/**
 * Lists uninvoiced milestones for a project (completed but not yet invoiced).
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns Array of uninvoiced milestones
 */
export const listProjectUninvoicedMilestones = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await listUninvoicedMilestones(ctx.db, args.projectId)
  },
})

// =============================================================================
// MUTATIONS (Helper mutations for work item handlers)
// =============================================================================

/**
 * Creates a project task.
 * This is a helper mutation that may be used by work item handlers.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @param args.name - Task name
 * @param args.description - Task description
 * @param args.priority - Task priority (Low, Medium, High, Urgent)
 * @param args.assigneeIds - Array of assigned user IDs
 * @param args.parentTaskId - Optional parent task ID for subtasks
 * @param args.dueDate - Optional due date timestamp
 * @param args.estimatedHours - Optional estimated hours
 * @param args.dependencies - Optional array of dependent task IDs
 * @returns The created task ID
 */
export const createTask = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
    description: v.string(),
    priority: v.union(
      v.literal('Low'),
      v.literal('Medium'),
      v.literal('High'),
      v.literal('Urgent')
    ),
    assigneeIds: v.array(v.id('users')),
    parentTaskId: v.optional(v.id('tasks')),
    dueDate: v.optional(v.number()),
    estimatedHours: v.optional(v.number()),
    dependencies: v.optional(v.array(v.id('tasks'))),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get project to verify it exists and get organization ID
    const project = await getProjectFromDb(ctx.db, args.projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    // Get next sort order
    const sortOrder = await getNextTaskSortOrder(ctx.db, args.projectId)

    // Create the task
    const taskId = await insertTask(ctx.db, {
      projectId: args.projectId,
      organizationId: project.organizationId,
      parentTaskId: args.parentTaskId,
      name: args.name,
      description: args.description,
      status: 'Todo',
      priority: args.priority,
      assigneeIds: args.assigneeIds,
      dueDate: args.dueDate,
      estimatedHours: args.estimatedHours,
      dependencies: args.dependencies ?? [],
      sortOrder,
      createdAt: Date.now(),
    })

    return taskId
  },
})

/**
 * Updates task properties.
 * This is a helper mutation that may be used by work item handlers.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.taskId - The task ID
 * @param args.name - Optional new task name
 * @param args.description - Optional new task description
 * @param args.status - Optional new task status
 * @param args.priority - Optional new task priority
 * @param args.assigneeIds - Optional new array of assigned user IDs
 * @param args.dueDate - Optional new due date timestamp
 * @param args.estimatedHours - Optional new estimated hours
 * @param args.dependencies - Optional new array of dependent task IDs
 * @param args.sortOrder - Optional new sort order
 */
export const updateTask = mutation({
  args: {
    taskId: v.id('tasks'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('Todo'),
        v.literal('InProgress'),
        v.literal('Review'),
        v.literal('Done'),
        v.literal('OnHold')
      )
    ),
    priority: v.optional(
      v.union(
        v.literal('Low'),
        v.literal('Medium'),
        v.literal('High'),
        v.literal('Urgent')
      )
    ),
    assigneeIds: v.optional(v.array(v.id('users'))),
    dueDate: v.optional(v.number()),
    estimatedHours: v.optional(v.number()),
    dependencies: v.optional(v.array(v.id('tasks'))),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const { taskId, ...updates } = args

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value
      }
    }

    // Only update if there are changes
    if (Object.keys(filteredUpdates).length > 0) {
      await updateTaskInDb(ctx.db, taskId, filteredUpdates)
    }
  },
})

/**
 * Updates a project's general properties.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md (lines 177-181)
 *
 * @param args.projectId - The project ID
 * @param args.name - Optional new project name
 * @param args.description - Optional new description
 * @param args.startDate - Optional new start date
 * @param args.endDate - Optional new end date (actual/current)
 * @param args.plannedEndDate - Optional original planned end date for duration variance (spec 13 line 248-252)
 * @param args.managerId - Optional new manager
 * @returns Success status
 */
export const updateProject = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    plannedEndDate: v.optional(v.number()), // Original planned end date for duration variance (spec 13 line 248-252)
    managerId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const { projectId, ...updates } = args

    // Verify project exists
    const project = await getProjectFromDb(ctx.db, projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value
      }
    }

    // Only update if there are changes
    if (Object.keys(filteredUpdates).length > 0) {
      const { updateProject: updateProjectInDb } = await import('../db/projects')
      await updateProjectInDb(ctx.db, projectId, filteredUpdates)
    }

    return { success: true }
  },
})

/**
 * Closes a project with final status and metrics.
 * Changes project status to Completed or Archived based on completion status.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md (lines 184-190)
 *
 * @param args.projectId - The project to close
 * @param args.closeDate - The closure date timestamp
 * @param args.completionStatus - Whether completed or cancelled
 * @param args.closureNotes - Optional notes about closure
 * @returns Closed status and final metrics
 */
export const closeProject = mutation({
  args: {
    projectId: v.id('projects'),
    closeDate: v.number(),
    completionStatus: v.union(v.literal('completed'), v.literal('cancelled')),
    closureNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify project exists
    const project = await getProjectFromDb(ctx.db, args.projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    if (project.status === 'Completed' || project.status === 'Archived') {
      throw new Error('Project is already closed')
    }

    // Calculate final metrics
    const [budget, hours, expenses] = await Promise.all([
      getBudgetByProjectId(ctx.db, args.projectId),
      calculateProjectHours(ctx.db, args.projectId),
      calculateProjectExpenses(ctx.db, args.projectId),
    ])

    const budgetTotal = budget?.totalAmount ?? 0
    const totalCost = hours.approved + expenses.approved
    const revenue = hours.billable + expenses.billable

    const metrics = {
      budgetTotal,
      totalCost,
      revenue,
      profit: revenue - totalCost,
      margin: revenue > 0 ? Math.round(((revenue - totalCost) / revenue) * 100) : 0,
      hoursLogged: hours.total,
      hoursApproved: hours.approved,
      expensesTotal: expenses.total,
      expensesApproved: expenses.approved,
    }

    // Update project status
    const newStatus = args.completionStatus === 'completed' ? 'Completed' : 'Archived'
    const { updateProject: updateProjectInDb } = await import('../db/projects')
    await updateProjectInDb(ctx.db, args.projectId, {
      status: newStatus,
      endDate: args.closeDate,
      closureNotes: args.closureNotes,
      closedAt: Date.now(),
    })

    return { closed: true, metrics }
  },
})

/**
 * Lists change orders for a project.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns Array of change orders (most recent first)
 */
export const listChangeOrders = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await listChangeOrdersByProject(ctx.db, args.projectId)
  },
})
