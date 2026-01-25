/**
 * Expenses API
 *
 * Domain-specific mutations and queries for expense management.
 * These provide data access for expense tracking within projects.
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getExpense as getExpenseFromDb,
  insertExpense,
  updateExpense as updateExpenseFromDb,
  updateExpenseStatus,
  listExpensesByUser,
  listExpensesByProject,
  listExpensesByStatus,
  calculateProjectExpenses,
} from '../db/expenses'
import { getUser } from '../db/users'
import { getProject } from '../db/projects'
import { authComponent } from '../../../auth'

// Receipt requirement threshold (in cents) - per spec 08-workflow-expense-tracking.md line 374
const RECEIPT_REQUIRED_THRESHOLD = 2500 // $25

// Expense type validator
const expenseTypeValidator = v.union(
  v.literal('Software'),
  v.literal('Travel'),
  v.literal('Materials'),
  v.literal('Subcontractor'),
  v.literal('Other'),
)

// Expense status validator
const expenseStatusValidator = v.union(
  v.literal('Draft'),
  v.literal('Submitted'),
  v.literal('Approved'),
  v.literal('Rejected'),
)

/**
 * Lists expenses with optional filters.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - Optional project filter
 * @param args.userId - Optional user filter
 * @param args.status - Optional status filter
 * @param args.type - Optional expense type filter
 * @returns Array of expenses matching the filters
 */
export const listExpenses = query({
  args: {
    projectId: v.optional(v.id('projects')),
    userId: v.optional(v.id('users')),
    status: v.optional(expenseStatusValidator),
    type: v.optional(expenseTypeValidator),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const authUser = await authComponent.getAuthUser(ctx)
    const user = await getUser(ctx.db, authUser.userId as Id<'users'>)
    if (!user) {
      return []
    }

    let expenses

    // Apply primary filter based on args
    if (args.projectId) {
      expenses = await listExpensesByProject(ctx.db, args.projectId)
    } else if (args.userId) {
      expenses = await listExpensesByUser(ctx.db, args.userId)
    } else if (args.status) {
      expenses = await listExpensesByStatus(ctx.db, user.organizationId, args.status)
    } else {
      // Default: list expenses by current user
      expenses = await listExpensesByUser(ctx.db, user._id)
    }

    // Apply additional filters
    if (args.status && args.projectId) {
      expenses = expenses.filter((e) => e.status === args.status)
    }
    if (args.userId && args.projectId) {
      expenses = expenses.filter((e) => e.userId === args.userId)
    }
    if (args.type) {
      expenses = expenses.filter((e) => e.type === args.type)
    }

    return expenses
  },
})

/**
 * Gets an expense by ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.expenseId - The expense ID
 * @returns The expense document or null
 */
export const getExpense = query({
  args: { expenseId: v.id('expenses') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Use domain function for data access
    return await getExpenseFromDb(ctx.db, args.expenseId)
  },
})

/**
 * Gets project expense summary statistics.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project ID
 * @returns Expense totals: total, billable, approved
 */
export const getProjectExpenseSummary = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    return await calculateProjectExpenses(ctx.db, args.projectId)
  },
})

/**
 * Creates a new expense in draft status.
 * This is a helper mutation for work item handlers.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.projectId - The project this expense belongs to
 * @param args.type - Expense type (Software, Travel, Materials, Subcontractor, Other)
 * @param args.amount - Amount in cents
 * @param args.currency - Currency code (e.g., "USD")
 * @param args.description - Description of the expense
 * @param args.date - Date of the expense (timestamp)
 * @param args.billable - Whether this expense is billable to client
 * @param args.receiptUrl - Optional URL to receipt image
 * @param args.markupRate - Optional markup multiplier (e.g., 1.1 for 10% markup)
 * @param args.vendorInfo - Optional vendor information
 * @returns The new expense ID
 */
export const createExpense = mutation({
  args: {
    projectId: v.id('projects'),
    type: expenseTypeValidator,
    amount: v.number(),
    currency: v.string(),
    description: v.string(),
    date: v.number(),
    billable: v.boolean(),
    receiptUrl: v.optional(v.string()),
    markupRate: v.optional(v.number()),
    vendorInfo: v.optional(
      v.object({
        name: v.string(),
        taxId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const user = await getUser(ctx.db, userId)
    if (!user) {
      throw new Error('User not found')
    }

    // Verify project exists and get organizationId
    const project = await getProject(ctx.db, args.projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    // Create expense in draft status
    const expenseId = await insertExpense(ctx.db, {
      organizationId: project.organizationId,
      userId: userId,
      projectId: args.projectId,
      type: args.type,
      amount: args.amount,
      currency: args.currency,
      billable: args.billable,
      markupRate: args.markupRate,
      receiptUrl: args.receiptUrl,
      status: 'Draft',
      date: args.date,
      description: args.description,
      vendorInfo: args.vendorInfo,
      createdAt: Date.now(),
    })

    return expenseId
  },
})

/**
 * Updates an existing expense.
 * Can only update expenses in Draft status.
 * This is a helper mutation for work item handlers.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.expenseId - The expense to update
 * @param args.type - Optional new expense type
 * @param args.amount - Optional new amount in cents
 * @param args.currency - Optional new currency code
 * @param args.description - Optional new description
 * @param args.date - Optional new date
 * @param args.billable - Optional new billable flag
 * @param args.receiptUrl - Optional new receipt URL
 * @param args.markupRate - Optional new markup rate
 * @param args.vendorInfo - Optional new vendor info
 */
export const updateExpense = mutation({
  args: {
    expenseId: v.id('expenses'),
    type: v.optional(expenseTypeValidator),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    description: v.optional(v.string()),
    date: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    receiptUrl: v.optional(v.string()),
    markupRate: v.optional(v.number()),
    vendorInfo: v.optional(
      v.object({
        name: v.string(),
        taxId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify expense exists and is in draft status
    const expense = await getExpenseFromDb(ctx.db, args.expenseId)
    if (!expense) {
      throw new Error('Expense not found')
    }

    if (expense.status !== 'Draft') {
      throw new Error('Can only update expenses in Draft status')
    }

    // Build updates object, excluding expenseId
    const { expenseId, ...updateFields } = args
    const updates: Record<string, unknown> = {}

    if (updateFields.type !== undefined) updates.type = updateFields.type
    if (updateFields.amount !== undefined) updates.amount = updateFields.amount
    if (updateFields.currency !== undefined) updates.currency = updateFields.currency
    if (updateFields.description !== undefined) updates.description = updateFields.description
    if (updateFields.date !== undefined) updates.date = updateFields.date
    if (updateFields.billable !== undefined) updates.billable = updateFields.billable
    if (updateFields.receiptUrl !== undefined) updates.receiptUrl = updateFields.receiptUrl
    if (updateFields.markupRate !== undefined) updates.markupRate = updateFields.markupRate
    if (updateFields.vendorInfo !== undefined) updates.vendorInfo = updateFields.vendorInfo

    if (Object.keys(updates).length > 0) {
      await updateExpenseFromDb(ctx.db, expenseId, updates)
    }
  },
})

/**
 * Submits an expense for approval.
 * Changes status from Draft to Submitted.
 * This is a helper mutation for work item handlers.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.expenseId - The expense to submit
 */
export const submitExpense = mutation({
  args: {
    expenseId: v.id('expenses'),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify expense exists and is in draft status
    const expense = await getExpenseFromDb(ctx.db, args.expenseId)
    if (!expense) {
      throw new Error('Expense not found')
    }

    if (expense.status !== 'Draft') {
      throw new Error('Can only submit expenses in Draft status')
    }

    // Validate required fields before submission
    if (!expense.description || expense.description.trim() === '') {
      throw new Error('Expense must have a description before submission')
    }
    if (expense.amount <= 0) {
      throw new Error('Expense must have a positive amount before submission')
    }

    // Validate receipt requirement per spec 08-workflow-expense-tracking.md line 374
    // Receipt is required for expenses > $25 or subcontractor expenses
    const receiptRequired = expense.amount > RECEIPT_REQUIRED_THRESHOLD ||
      expense.type === 'Subcontractor'

    if (receiptRequired && !expense.receiptUrl) {
      throw new Error(
        `Receipt is required for expenses over $${RECEIPT_REQUIRED_THRESHOLD / 100}. ` +
        `Please attach a receipt before submitting.`
      )
    }

    // Update status to Submitted
    await updateExpenseStatus(ctx.db, args.expenseId, 'Submitted')
  },
})

/**
 * Approves an expense.
 * Changes status from Submitted to Approved.
 * Can optionally adjust billable flag and markup rate.
 * Authorization: Requires dealToDelivery:staff scope (manager role).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md (lines 438-443)
 *
 * @param args.expenseId - The expense to approve
 * @param args.finalBillable - Optional adjustment to billable flag
 * @param args.finalMarkup - Optional adjustment to markup rate
 * @returns Success status
 */
export const approveExpense = mutation({
  args: {
    expenseId: v.id('expenses'),
    finalBillable: v.optional(v.boolean()),
    finalMarkup: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify expense exists and is in Submitted status
    const expense = await getExpenseFromDb(ctx.db, args.expenseId)
    if (!expense) {
      throw new Error('Expense not found')
    }

    if (expense.status !== 'Submitted') {
      throw new Error('Can only approve expenses in Submitted status')
    }

    // Build updates
    const updates: Record<string, unknown> = {
      status: 'Approved',
      approvedAt: Date.now(),
    }

    // Apply optional adjustments
    if (args.finalBillable !== undefined) {
      updates.billable = args.finalBillable
    }
    if (args.finalMarkup !== undefined) {
      updates.markupRate = args.finalMarkup
    }

    await updateExpenseFromDb(ctx.db, args.expenseId, updates)

    return { success: true }
  },
})

/**
 * Rejects an expense.
 * Changes status from Submitted to Rejected with reason.
 * Authorization: Requires dealToDelivery:staff scope (manager role).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md (lines 446-451)
 *
 * @param args.expenseId - The expense to reject
 * @param args.rejectionReason - Reason for rejection (required)
 * @param args.issues - Optional array of specific issues
 * @returns Success status
 */
export const rejectExpense = mutation({
  args: {
    expenseId: v.id('expenses'),
    rejectionReason: v.string(),
    issues: v.optional(
      v.array(
        v.object({
          type: v.string(),
          details: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify expense exists and is in Submitted status
    const expense = await getExpenseFromDb(ctx.db, args.expenseId)
    if (!expense) {
      throw new Error('Expense not found')
    }

    if (expense.status !== 'Submitted') {
      throw new Error('Can only reject expenses in Submitted status')
    }

    // Update status to Rejected with reason
    await updateExpenseFromDb(ctx.db, args.expenseId, {
      status: 'Rejected',
      rejectionComments: args.rejectionReason,
      rejectionIssues: args.issues,
      rejectedAt: Date.now(),
    })

    return { success: true }
  },
})

/**
 * Approves multiple expenses in batch.
 * Changes status from Submitted to Approved for all specified expenses.
 * Authorization: Requires dealToDelivery:staff scope (manager role).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 * Per spec 09-workflow-timesheet-approval.md pattern for bulk operations.
 *
 * @param args.expenseIds - Array of expense IDs to approve
 * @param args.finalBillable - Optional adjustment to billable flag (applied to all)
 * @param args.finalMarkup - Optional adjustment to markup rate (applied to all)
 * @returns Success status with count of approved expenses
 */
export const approveExpenses = mutation({
  args: {
    expenseIds: v.array(v.id('expenses')),
    finalBillable: v.optional(v.boolean()),
    finalMarkup: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const approverId = await requirePsaStaffMember(ctx)

    let approvedCount = 0

    for (const expenseId of args.expenseIds) {
      const expense = await getExpenseFromDb(ctx.db, expenseId)
      if (!expense) {
        throw new Error(`Expense not found: ${expenseId}`)
      }

      if (expense.status !== 'Submitted') {
        throw new Error(
          `Cannot approve expense with status "${expense.status}". Only Submitted expenses can be approved.`
        )
      }

      // Build updates
      const updates: Record<string, unknown> = {
        status: 'Approved',
        approvedBy: approverId,
        approvedAt: Date.now(),
      }

      // Apply optional adjustments
      if (args.finalBillable !== undefined) {
        updates.billable = args.finalBillable
      }
      if (args.finalMarkup !== undefined) {
        updates.markupRate = args.finalMarkup
      }

      await updateExpenseFromDb(ctx.db, expenseId, updates)
      approvedCount++
    }

    return { success: true, approvedCount }
  },
})

/**
 * Rejects multiple expenses in batch with a shared reason.
 * Changes status from Submitted to Rejected for all specified expenses.
 * Authorization: Requires dealToDelivery:staff scope (manager role).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 * Per spec 10-workflow-expense-approval.md for rejection handling.
 *
 * @param args.expenseIds - Array of expense IDs to reject
 * @param args.rejectionReason - Required rejection reason (applied to all)
 * @param args.issues - Optional array of specific issues (applied to all)
 * @returns Success status with count of rejected expenses
 */
export const rejectExpenses = mutation({
  args: {
    expenseIds: v.array(v.id('expenses')),
    rejectionReason: v.string(),
    issues: v.optional(
      v.array(
        v.object({
          type: v.string(),
          details: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    if (!args.rejectionReason || args.rejectionReason.trim().length === 0) {
      throw new Error('Rejection reason is required')
    }

    let rejectedCount = 0

    for (const expenseId of args.expenseIds) {
      const expense = await getExpenseFromDb(ctx.db, expenseId)
      if (!expense) {
        throw new Error(`Expense not found: ${expenseId}`)
      }

      if (expense.status !== 'Submitted') {
        throw new Error(
          `Cannot reject expense with status "${expense.status}". Only Submitted expenses can be rejected.`
        )
      }

      await updateExpenseFromDb(ctx.db, expenseId, {
        status: 'Rejected',
        rejectionComments: args.rejectionReason.trim(),
        rejectionIssues: args.issues,
        rejectedAt: Date.now(),
      })
      rejectedCount++
    }

    return { success: true, rejectedCount }
  },
})
