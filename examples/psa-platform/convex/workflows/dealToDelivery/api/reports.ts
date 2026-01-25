/**
 * Reports API
 *
 * Query endpoints for generating business reports and analytics.
 * These provide calculated metrics for utilization, profitability, and budget tracking.
 *
 * TENET-AUTHZ: All queries are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import { authComponent } from '../../../auth'
import { getUser, listActiveUsersByOrganization } from '../db/users'
import { calculateUserBookedHours } from '../db/bookings'
import { listTimeEntriesByUser } from '../db/timeEntries'
import { listProjectsByOrganization } from '../db/projects'
import { calculateProjectHours } from '../db/timeEntries'
import { calculateProjectExpenses } from '../db/expenses'
import { getBudgetByProjectId, listServicesByBudget } from '../db/budgets'
import { listInvoicesByProject } from '../db/invoices'

/**
 * Team member utilization data
 */
interface TeamMemberUtilization {
  userId: Id<'users'>
  userName: string
  department: string
  bookedHours: number
  actualHours: number
  billableHours: number
  availableHours: number
  utilizationRate: number
  billableUtilizationRate: number
}

/**
 * Utilization report result
 */
interface UtilizationReport {
  startDate: number
  endDate: number
  teamMembers: TeamMemberUtilization[]
  summary: {
    totalTeamMembers: number
    totalBookedHours: number
    totalActualHours: number
    totalBillableHours: number
    totalAvailableHours: number
    averageUtilizationRate: number
    averageBillableUtilizationRate: number
  }
}

/**
 * Calculate utilization for team members over a date range.
 *
 * This report shows:
 * - Booked hours (scheduled/allocated time)
 * - Actual hours (time entries logged)
 * - Billable hours (billable time entries)
 * - Available hours (capacity based on working hours per day)
 * - Utilization rate (actual/available)
 * - Billable utilization rate (billable/available)
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.startDate - Start of the date range (epoch ms)
 * @param args.endDate - End of the date range (epoch ms)
 * @param args.hoursPerDay - Standard working hours per day (default: 8)
 * @returns Utilization metrics for each team member and summary totals
 */
export const getUtilizationReport = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    hoursPerDay: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UtilizationReport> => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      return {
        startDate: args.startDate,
        endDate: args.endDate,
        teamMembers: [],
        summary: {
          totalTeamMembers: 0,
          totalBookedHours: 0,
          totalActualHours: 0,
          totalBillableHours: 0,
          totalAvailableHours: 0,
          averageUtilizationRate: 0,
          averageBillableUtilizationRate: 0,
        },
      }
    }

    const hoursPerDay = args.hoursPerDay ?? 8
    const organizationId = currentUser.organizationId

    // Calculate working days in the date range (excluding weekends)
    const workingDays = calculateWorkingDays(args.startDate, args.endDate)

    // Get all active team members
    const teamMembers = await listActiveUsersByOrganization(
      ctx.db,
      organizationId
    )

    // Calculate utilization for each team member
    const memberUtilizations: TeamMemberUtilization[] = []

    for (const member of teamMembers) {
      // Get booked hours for this member
      const bookedHours = await calculateUserBookedHours(
        ctx.db,
        member._id,
        args.startDate,
        args.endDate
      )

      // Get actual time entries for this member in the date range
      const timeEntries = await listTimeEntriesByUser(ctx.db, member._id, 1000)
      const entriesInRange = timeEntries.filter(
        (entry) => entry.date >= args.startDate && entry.date <= args.endDate
      )

      let actualHours = 0
      let billableHours = 0
      for (const entry of entriesInRange) {
        actualHours += entry.hours
        if (entry.billable) {
          billableHours += entry.hours
        }
      }

      // Calculate available hours based on working days
      const availableHours = workingDays * hoursPerDay

      // Calculate utilization rates
      const utilizationRate =
        availableHours > 0 ? (actualHours / availableHours) * 100 : 0
      const billableUtilizationRate =
        availableHours > 0 ? (billableHours / availableHours) * 100 : 0

      memberUtilizations.push({
        userId: member._id,
        userName: member.name,
        department: member.department,
        bookedHours,
        actualHours,
        billableHours,
        availableHours,
        utilizationRate: Math.round(utilizationRate * 100) / 100,
        billableUtilizationRate:
          Math.round(billableUtilizationRate * 100) / 100,
      })
    }

    // Calculate summary totals
    const totalTeamMembers = memberUtilizations.length
    const totalBookedHours = memberUtilizations.reduce(
      (sum, m) => sum + m.bookedHours,
      0
    )
    const totalActualHours = memberUtilizations.reduce(
      (sum, m) => sum + m.actualHours,
      0
    )
    const totalBillableHours = memberUtilizations.reduce(
      (sum, m) => sum + m.billableHours,
      0
    )
    const totalAvailableHours = memberUtilizations.reduce(
      (sum, m) => sum + m.availableHours,
      0
    )
    const averageUtilizationRate =
      totalAvailableHours > 0
        ? (totalActualHours / totalAvailableHours) * 100
        : 0
    const averageBillableUtilizationRate =
      totalAvailableHours > 0
        ? (totalBillableHours / totalAvailableHours) * 100
        : 0

    return {
      startDate: args.startDate,
      endDate: args.endDate,
      teamMembers: memberUtilizations,
      summary: {
        totalTeamMembers,
        totalBookedHours,
        totalActualHours,
        totalBillableHours,
        totalAvailableHours,
        averageUtilizationRate:
          Math.round(averageUtilizationRate * 100) / 100,
        averageBillableUtilizationRate:
          Math.round(averageBillableUtilizationRate * 100) / 100,
      },
    }
  },
})

/**
 * Project profitability data
 */
interface ProjectProfitability {
  projectId: Id<'projects'>
  projectName: string
  status: string
  revenue: number
  laborCost: number
  expenseCost: number
  totalCost: number
  grossProfit: number
  grossMargin: number
  totalHours: number
  billableHours: number
  effectiveRate: number
}

/**
 * Profitability report result
 */
interface ProfitabilityReport {
  projects: ProjectProfitability[]
  summary: {
    totalProjects: number
    totalRevenue: number
    totalLaborCost: number
    totalExpenseCost: number
    totalCost: number
    totalGrossProfit: number
    averageGrossMargin: number
    totalHours: number
    totalBillableHours: number
    averageEffectiveRate: number
  }
}

/**
 * Calculate profitability by project.
 *
 * This report shows for each project:
 * - Revenue (invoiced amounts)
 * - Labor cost (hours * team member cost rates)
 * - Expense cost (approved expenses)
 * - Gross profit (revenue - costs)
 * - Gross margin percentage
 * - Effective billing rate (revenue / billable hours)
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectIds - Optional list of project IDs to include (default: all)
 * @returns Profitability metrics for each project and summary totals
 */
export const getProfitabilityReport = query({
  args: {
    projectIds: v.optional(v.array(v.id('projects'))),
  },
  handler: async (ctx, args): Promise<ProfitabilityReport> => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      return {
        projects: [],
        summary: {
          totalProjects: 0,
          totalRevenue: 0,
          totalLaborCost: 0,
          totalExpenseCost: 0,
          totalCost: 0,
          totalGrossProfit: 0,
          averageGrossMargin: 0,
          totalHours: 0,
          totalBillableHours: 0,
          averageEffectiveRate: 0,
        },
      }
    }

    const organizationId = currentUser.organizationId

    // Get projects to analyze
    let projects = await listProjectsByOrganization(ctx.db, organizationId)
    if (args.projectIds && args.projectIds.length > 0) {
      projects = projects.filter((p) => args.projectIds!.includes(p._id))
    }

    const projectProfitabilities: ProjectProfitability[] = []

    for (const project of projects) {
      // Calculate hours
      const hours = await calculateProjectHours(ctx.db, project._id)

      // Calculate expenses
      const expenses = await calculateProjectExpenses(ctx.db, project._id)

      // Calculate revenue from paid/sent invoices
      const invoices = await listInvoicesByProject(ctx.db, project._id)
      let revenue = 0
      for (const invoice of invoices) {
        if (
          invoice.status === 'Paid' ||
          invoice.status === 'Sent' ||
          invoice.status === 'Viewed'
        ) {
          revenue += invoice.total
        }
      }

      // Calculate labor cost from time entries
      // For a more accurate calculation, we would need to look up each user's cost rate
      // For now, we use the project's budget labor cost or estimate from approved hours
      const budget = await getBudgetByProjectId(ctx.db, project._id)
      let laborCost = 0
      if (budget) {
        // Use budget's estimated labor portion as a proxy
        const services = await listServicesByBudget(ctx.db, budget._id)
        for (const service of services) {
          // Approximate labor cost as (estimatedHours * implicit cost rate)
          // In a real system, you'd calculate from actual time entries with user cost rates
          laborCost += service.estimatedHours * (service.rate * 0.6) // Assume 60% of bill rate is cost
        }
      }

      // Expense cost is the approved expense amount
      const expenseCost = expenses.approved

      // Calculate profitability metrics
      const totalCost = laborCost + expenseCost
      const grossProfit = revenue - totalCost
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0
      const effectiveRate =
        hours.billable > 0 ? revenue / hours.billable : 0

      projectProfitabilities.push({
        projectId: project._id,
        projectName: project.name,
        status: project.status,
        revenue,
        laborCost: Math.round(laborCost),
        expenseCost,
        totalCost: Math.round(totalCost),
        grossProfit: Math.round(grossProfit),
        grossMargin: Math.round(grossMargin * 100) / 100,
        totalHours: hours.total,
        billableHours: hours.billable,
        effectiveRate: Math.round(effectiveRate * 100) / 100,
      })
    }

    // Calculate summary totals
    const totalProjects = projectProfitabilities.length
    const totalRevenue = projectProfitabilities.reduce(
      (sum, p) => sum + p.revenue,
      0
    )
    const totalLaborCost = projectProfitabilities.reduce(
      (sum, p) => sum + p.laborCost,
      0
    )
    const totalExpenseCost = projectProfitabilities.reduce(
      (sum, p) => sum + p.expenseCost,
      0
    )
    const totalCost = totalLaborCost + totalExpenseCost
    const totalGrossProfit = totalRevenue - totalCost
    const averageGrossMargin =
      totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0
    const totalHours = projectProfitabilities.reduce(
      (sum, p) => sum + p.totalHours,
      0
    )
    const totalBillableHours = projectProfitabilities.reduce(
      (sum, p) => sum + p.billableHours,
      0
    )
    const averageEffectiveRate =
      totalBillableHours > 0 ? totalRevenue / totalBillableHours : 0

    return {
      projects: projectProfitabilities,
      summary: {
        totalProjects,
        totalRevenue,
        totalLaborCost,
        totalExpenseCost,
        totalCost,
        totalGrossProfit,
        averageGrossMargin: Math.round(averageGrossMargin * 100) / 100,
        totalHours,
        totalBillableHours,
        averageEffectiveRate: Math.round(averageEffectiveRate * 100) / 100,
      },
    }
  },
})

/**
 * Project budget burn data
 */
interface ProjectBudgetBurn {
  projectId: Id<'projects'>
  projectName: string
  status: string
  budgetType: string
  totalBudget: number
  hoursSpent: number
  hoursRemaining: number
  hoursPercentUsed: number
  amountSpent: number
  amountRemaining: number
  amountPercentUsed: number
  burnRate: number // Amount per day based on recent activity
  projectedCompletionDate: number | null
  isOverBudget: boolean
}

/**
 * Budget burn report result
 */
interface BudgetBurnReport {
  projects: ProjectBudgetBurn[]
  summary: {
    totalProjects: number
    projectsOnTrack: number
    projectsAtRisk: number
    projectsOverBudget: number
    totalBudget: number
    totalSpent: number
    totalRemaining: number
    overallPercentUsed: number
  }
}

/**
 * Calculate budget burn rates for projects.
 *
 * This report shows for each project:
 * - Total budget (hours and amount)
 * - Hours/amount spent and remaining
 * - Percentage of budget consumed
 * - Burn rate (recent spending velocity)
 * - Projected completion date based on burn rate
 * - Over-budget indicator
 *
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectIds - Optional list of project IDs to include (default: all active)
 * @param args.riskThreshold - Percentage threshold for "at risk" status (default: 80)
 * @returns Budget burn metrics for each project and summary totals
 */
export const getBudgetBurnReport = query({
  args: {
    projectIds: v.optional(v.array(v.id('projects'))),
    riskThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BudgetBurnReport> => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const currentUser = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!currentUser) {
      return {
        projects: [],
        summary: {
          totalProjects: 0,
          projectsOnTrack: 0,
          projectsAtRisk: 0,
          projectsOverBudget: 0,
          totalBudget: 0,
          totalSpent: 0,
          totalRemaining: 0,
          overallPercentUsed: 0,
        },
      }
    }

    const organizationId = currentUser.organizationId
    const riskThreshold = args.riskThreshold ?? 80

    // Get projects to analyze
    let projects = await listProjectsByOrganization(ctx.db, organizationId)
    if (args.projectIds && args.projectIds.length > 0) {
      projects = projects.filter((p) => args.projectIds!.includes(p._id))
    }

    const projectBurns: ProjectBudgetBurn[] = []

    for (const project of projects) {
      // Get budget information
      const budget = await getBudgetByProjectId(ctx.db, project._id)
      if (!budget) {
        continue // Skip projects without budgets
      }

      // Calculate budget totals from services
      const services = await listServicesByBudget(ctx.db, budget._id)
      let totalBudgetHours = 0
      let totalBudgetAmount = 0
      for (const service of services) {
        totalBudgetHours += service.estimatedHours
        totalBudgetAmount += service.totalAmount
      }

      // Calculate hours and expenses spent
      const hours = await calculateProjectHours(ctx.db, project._id)
      const expenses = await calculateProjectExpenses(ctx.db, project._id)

      // Calculate amount spent (billable hours * average rate + expenses)
      const avgRate =
        totalBudgetHours > 0 ? totalBudgetAmount / totalBudgetHours : 0
      const laborSpent = hours.approved * avgRate
      const amountSpent = laborSpent + expenses.approved

      // Calculate remaining
      const hoursRemaining = Math.max(0, totalBudgetHours - hours.total)
      const amountRemaining = Math.max(0, totalBudgetAmount - amountSpent)

      // Calculate percentages
      const hoursPercentUsed =
        totalBudgetHours > 0 ? (hours.total / totalBudgetHours) * 100 : 0
      const amountPercentUsed =
        totalBudgetAmount > 0 ? (amountSpent / totalBudgetAmount) * 100 : 0

      // Calculate burn rate (amount per day based on project age)
      const projectAgeMs = Date.now() - project._creationTime
      const projectAgeDays = Math.max(1, projectAgeMs / (24 * 60 * 60 * 1000))
      const burnRate = amountSpent / projectAgeDays

      // Project completion date based on burn rate
      let projectedCompletionDate: number | null = null
      if (burnRate > 0 && amountRemaining > 0) {
        const daysRemaining = amountRemaining / burnRate
        projectedCompletionDate = Date.now() + daysRemaining * 24 * 60 * 60 * 1000
      }

      // Check if over budget
      const isOverBudget = amountPercentUsed > 100 || hoursPercentUsed > 100

      projectBurns.push({
        projectId: project._id,
        projectName: project.name,
        status: project.status,
        budgetType: budget.type,
        totalBudget: totalBudgetAmount,
        hoursSpent: hours.total,
        hoursRemaining,
        hoursPercentUsed: Math.round(hoursPercentUsed * 100) / 100,
        amountSpent: Math.round(amountSpent),
        amountRemaining: Math.round(amountRemaining),
        amountPercentUsed: Math.round(amountPercentUsed * 100) / 100,
        burnRate: Math.round(burnRate * 100) / 100,
        projectedCompletionDate,
        isOverBudget,
      })
    }

    // Calculate summary
    const totalProjects = projectBurns.length
    const projectsOverBudget = projectBurns.filter((p) => p.isOverBudget).length
    const projectsAtRisk = projectBurns.filter(
      (p) => !p.isOverBudget && p.amountPercentUsed >= riskThreshold
    ).length
    const projectsOnTrack = totalProjects - projectsOverBudget - projectsAtRisk
    const totalBudget = projectBurns.reduce((sum, p) => sum + p.totalBudget, 0)
    const totalSpent = projectBurns.reduce((sum, p) => sum + p.amountSpent, 0)
    const totalRemaining = projectBurns.reduce(
      (sum, p) => sum + p.amountRemaining,
      0
    )
    const overallPercentUsed =
      totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0

    return {
      projects: projectBurns,
      summary: {
        totalProjects,
        projectsOnTrack,
        projectsAtRisk,
        projectsOverBudget,
        totalBudget,
        totalSpent,
        totalRemaining,
        overallPercentUsed: Math.round(overallPercentUsed * 100) / 100,
      },
    }
  },
})

/**
 * Helper function to calculate working days between two dates.
 * Excludes weekends (Saturday and Sunday).
 *
 * @param startDate - Start date (epoch ms)
 * @param endDate - End date (epoch ms)
 * @returns Number of working days
 */
function calculateWorkingDays(startDate: number, endDate: number): number {
  let workingDays = 0
  const current = new Date(startDate)
  const end = new Date(endDate)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++
    }
    current.setDate(current.getDate() + 1)
  }

  return workingDays
}
