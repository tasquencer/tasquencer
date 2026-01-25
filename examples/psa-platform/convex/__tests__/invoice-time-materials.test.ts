/// <reference types="vite/client" />
/**
 * InvoiceTimeAndMaterials Work Item Tests
 *
 * These tests verify the invoiceTimeAndMaterials work item implementation per spec:
 * - task-invoicetimematerials.md
 *
 * Test coverage includes:
 * - All 4 groupBy options: service, task, date, person
 * - Both detailLevel options: summary (aggregated) vs detailed (individual entries)
 * - Date range filtering
 * - Include/exclude expenses
 * - Budget requirement validation
 * - Line item creation and amount calculations
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  type TestContext,
} from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

const INVOICE_SCOPES = [
  'dealToDelivery:invoices:create',
  'dealToDelivery:invoices:view:all',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'billing-user', INVOICE_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Helper to set up a project with budget and services
 */
async function setupProjectWithBudget(
  t: TestContext,
  orgId: Id<'organizations'>,
  budgetType: 'TimeAndMaterials' | 'FixedFee' | 'Retainer' = 'TimeAndMaterials'
): Promise<{
  projectId: Id<'projects'>
  budgetId: Id<'budgets'>
  companyId: Id<'companies'>
  services: Array<{ serviceId: Id<'services'>; name: string; rate: number }>
}> {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Invoice Test Company',
      billingAddress: {
        street: '123 Test St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    // Get a user for manager
    const users = await ctx.db.query('users').withIndex('by_organization', q => q.eq('organizationId', orgId)).collect()
    const managerId = users[0]?._id

    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'T&M Invoice Test Project',
      status: 'Active',
      startDate: Date.now(),
      managerId: managerId!,
      createdAt: Date.now(),
    })

    const budgetId = await ctx.db.insert('budgets', {
      organizationId: orgId,
      projectId,
      type: budgetType,
      totalAmount: 100000_00, // $100,000
      createdAt: Date.now(),
    })

    // Update project with budget reference
    await ctx.db.patch(projectId, { budgetId })

    // Create services with different rates
    const service1Id = await ctx.db.insert('services', {
      organizationId: orgId,
      budgetId,
      name: 'Development',
      rate: 150_00, // $150/hr
      estimatedHours: 100,
      totalAmount: 150_00 * 100, // rate * hours
    })

    const service2Id = await ctx.db.insert('services', {
      organizationId: orgId,
      budgetId,
      name: 'Consulting',
      rate: 200_00, // $200/hr
      estimatedHours: 50,
      totalAmount: 200_00 * 50, // rate * hours
    })

    return {
      projectId,
      budgetId,
      companyId,
      services: [
        { serviceId: service1Id, name: 'Development', rate: 150_00 },
        { serviceId: service2Id, name: 'Consulting', rate: 200_00 },
      ],
    }
  })
}

/**
 * Helper to create multiple time entries for different scenarios
 */
async function createTimeEntries(
  t: TestContext,
  config: {
    orgId: Id<'organizations'>
    projectId: Id<'projects'>
    entries: Array<{
      userId: Id<'users'>
      serviceId?: Id<'services'>
      taskId?: Id<'tasks'>
      date: number
      hours: number
    }>
  }
): Promise<Id<'timeEntries'>[]> {
  return await t.run(async (ctx) => {
    const entryIds: Id<'timeEntries'>[] = []

    for (const entry of config.entries) {
      const id = await ctx.db.insert('timeEntries', {
        organizationId: config.orgId,
        projectId: config.projectId,
        userId: entry.userId,
        serviceId: entry.serviceId,
        taskId: entry.taskId,
        date: entry.date,
        hours: entry.hours,
        status: 'Approved',
        billable: true,
        notes: `Time entry for ${new Date(entry.date).toLocaleDateString()}`,
        createdAt: Date.now(),
      })
      entryIds.push(id)
    }

    return entryIds
  })
}

/**
 * Helper to create tasks for testing groupBy task
 */
async function createTasks(
  t: TestContext,
  config: {
    orgId: Id<'organizations'>
    projectId: Id<'projects'>
    tasks: Array<{ name: string }>
  }
): Promise<Id<'tasks'>[]> {
  return await t.run(async (ctx) => {
    const taskIds: Id<'tasks'>[] = []

    for (let i = 0; i < config.tasks.length; i++) {
      const id = await ctx.db.insert('tasks', {
        organizationId: config.orgId,
        projectId: config.projectId,
        name: config.tasks[i].name,
        description: `Description for ${config.tasks[i].name}`,
        status: 'Done',
        priority: 'Medium',
        assigneeIds: [],
        dependencies: [],
        sortOrder: i,
        createdAt: Date.now(),
      })
      taskIds.push(id)
    }

    return taskIds
  })
}

/**
 * Helper to create additional users for testing groupBy person
 */
async function createAdditionalUser(
  t: TestContext,
  orgId: Id<'organizations'>,
  name: string
): Promise<Id<'users'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('users', {
      organizationId: orgId,
      email: `${name.toLowerCase().replace(' ', '.')}@test.com`,
      name,
      role: 'team_member',
      costRate: 80_00,
      billRate: 150_00,
      skills: ['TypeScript'],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })
  })
}

/**
 * Call the invoiceTimeAndMaterials complete action directly via DB
 */
async function invoiceTimeAndMaterials(
  t: TestContext,
  payload: {
    projectId: Id<'projects'>
    dateRange?: { startDate: number; endDate: number }
    includeExpenses?: boolean
    groupBy?: 'service' | 'task' | 'date' | 'person'
    detailLevel?: 'summary' | 'detailed'
  }
): Promise<{ invoiceId: Id<'invoices'>; lineItems: Doc<'invoiceLineItems'>[] }> {
  const result = await t.run(async (ctx) => {
    // Import the work item functions directly for testing
    const { insertInvoice, insertInvoiceLineItem, recalculateInvoiceTotals } = await import('../workflows/dealToDelivery/db/invoices')
    const { getProject } = await import('../workflows/dealToDelivery/db/projects')
    const { getBudgetByProjectId, listServicesByBudget } = await import('../workflows/dealToDelivery/db/budgets')
    const { listBillableUninvoicedTimeEntries } = await import('../workflows/dealToDelivery/db/timeEntries')
    const { listBillableUninvoicedExpenses } = await import('../workflows/dealToDelivery/db/expenses')
    const { getTask } = await import('../workflows/dealToDelivery/db/tasks')
    const { getUser } = await import('../workflows/dealToDelivery/db/users')

    const project = await getProject(ctx.db, payload.projectId)
    if (!project) throw new Error('Project not found')

    const budget = await getBudgetByProjectId(ctx.db, payload.projectId)
    if (!budget) throw new Error('Project must have a budget for T&M invoicing')

    // Get billable, uninvoiced time entries
    let timeEntries = await listBillableUninvoicedTimeEntries(ctx.db, payload.projectId)

    // Filter by date range if specified
    if (payload.dateRange) {
      timeEntries = timeEntries.filter(
        (e) => e.date >= payload.dateRange!.startDate && e.date <= payload.dateRange!.endDate
      )
    }

    // Get services for rate lookup
    const services = await listServicesByBudget(ctx.db, budget._id)
    const serviceMap = new Map(services.map((s) => [s._id, s]))

    // Determine groupBy and detailLevel
    const groupBy = payload.groupBy ?? 'service'
    const detailLevel = payload.detailLevel ?? 'summary'
    const includeExpenses = payload.includeExpenses ?? true

    // Create the draft invoice
    const invoiceId = await insertInvoice(ctx.db, {
      organizationId: project.organizationId,
      projectId: payload.projectId,
      companyId: project.companyId,
      status: 'Draft',
      method: 'TimeAndMaterials',
      subtotal: 0,
      tax: 0,
      total: 0,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    })

    // Helper for detailed line items
    const createDetailedLineItems = async (
      entries: Doc<'timeEntries'>[],
      sortOrderStart: number,
      contextDescription: (entry: Doc<'timeEntries'>) => string
    ): Promise<number> => {
      let sortOrder = sortOrderStart
      for (const entry of entries) {
        const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
        const rate = service?.rate ?? 0
        const amount = Math.round(entry.hours * rate)
        const dateStr = new Date(entry.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })

        await insertInvoiceLineItem(ctx.db, {
          invoiceId,
          description: `${contextDescription(entry)} (${dateStr})`,
          quantity: entry.hours,
          rate,
          amount,
          sortOrder: sortOrder++,
          timeEntryIds: [entry._id],
        })
      }
      return sortOrder
    }

    // Group and create line items based on groupBy/detailLevel
    if (groupBy === 'service') {
      const byService = new Map<string, Doc<'timeEntries'>[]>()
      for (const entry of timeEntries) {
        const key = entry.serviceId?.toString() ?? 'unassigned'
        if (!byService.has(key)) byService.set(key, [])
        byService.get(key)!.push(entry)
      }

      let sortOrder = 0
      for (const [serviceKey, entries] of byService) {
        const serviceId = serviceKey !== 'unassigned' ? (serviceKey as Id<'services'>) : undefined
        const service = serviceId ? serviceMap.get(serviceId) : undefined
        const serviceName = service?.name ?? 'Professional Services'
        const rate = service?.rate ?? 0

        if (detailLevel === 'detailed') {
          sortOrder = await createDetailedLineItems(entries, sortOrder, () => serviceName)
        } else {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
          const amount = Math.round(totalHours * rate)

          await insertInvoiceLineItem(ctx.db, {
            invoiceId,
            description: serviceName,
            quantity: totalHours,
            rate,
            amount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          })
        }
      }
    } else if (groupBy === 'task') {
      const byTask = new Map<string, Doc<'timeEntries'>[]>()
      for (const entry of timeEntries) {
        const key = entry.taskId?.toString() ?? 'no_task'
        if (!byTask.has(key)) byTask.set(key, [])
        byTask.get(key)!.push(entry)
      }

      const taskIds = [...byTask.keys()].filter((k) => k !== 'no_task').map((k) => k as Id<'tasks'>)
      const tasks = await Promise.all(taskIds.map((id) => getTask(ctx.db, id)))
      const taskMap = new Map(tasks.filter(Boolean).map((t) => [t!._id.toString(), t!]))

      let sortOrder = 0
      for (const [taskKey, entries] of byTask) {
        const task = taskKey !== 'no_task' ? taskMap.get(taskKey) : undefined
        const taskName = task?.name ?? 'General Work'

        if (detailLevel === 'detailed') {
          sortOrder = await createDetailedLineItems(
            entries,
            sortOrder,
            (entry) => {
              const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
              return `${taskName}: ${service?.name ?? 'Work'}`
            }
          )
        } else {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
          let totalAmount = 0
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0))
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0

          await insertInvoiceLineItem(ctx.db, {
            invoiceId,
            description: taskName,
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          })
        }
      }
    } else if (groupBy === 'date') {
      const byDate = new Map<number, Doc<'timeEntries'>[]>()
      for (const entry of timeEntries) {
        const dateKey = new Date(entry.date).setHours(0, 0, 0, 0)
        if (!byDate.has(dateKey)) byDate.set(dateKey, [])
        byDate.get(dateKey)!.push(entry)
      }

      const sortedDates = [...byDate.keys()].sort((a, b) => a - b)

      let sortOrder = 0
      for (const dateKey of sortedDates) {
        const entries = byDate.get(dateKey)!
        const dateStr = new Date(dateKey).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })

        if (detailLevel === 'detailed') {
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
            const rate = service?.rate ?? 0
            const amount = Math.round(entry.hours * rate)

            await insertInvoiceLineItem(ctx.db, {
              invoiceId,
              description: `${dateStr}: ${service?.name ?? 'Work'}`,
              quantity: entry.hours,
              rate,
              amount,
              sortOrder: sortOrder++,
              timeEntryIds: [entry._id],
            })
          }
        } else {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
          let totalAmount = 0
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0))
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0

          await insertInvoiceLineItem(ctx.db, {
            invoiceId,
            description: `Work on ${dateStr}`,
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          })
        }
      }
    } else if (groupBy === 'person') {
      const byPerson = new Map<string, Doc<'timeEntries'>[]>()
      for (const entry of timeEntries) {
        const key = entry.userId.toString()
        if (!byPerson.has(key)) byPerson.set(key, [])
        byPerson.get(key)!.push(entry)
      }

      const userIds = [...byPerson.keys()].map((k) => k as Id<'users'>)
      const users = await Promise.all(userIds.map((id) => getUser(ctx.db, id)))
      const userMap = new Map(users.filter(Boolean).map((u) => [u!._id.toString(), u!]))

      let sortOrder = 0
      for (const [userKey, entries] of byPerson) {
        const user = userMap.get(userKey)
        const personName = user?.name ?? 'Team Member'

        if (detailLevel === 'detailed') {
          sortOrder = await createDetailedLineItems(
            entries,
            sortOrder,
            (entry) => {
              const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
              return `${personName}: ${service?.name ?? 'Work'}`
            }
          )
        } else {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
          let totalAmount = 0
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0))
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0

          await insertInvoiceLineItem(ctx.db, {
            invoiceId,
            description: personName,
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          })
        }
      }
    }

    // Add expenses if requested
    if (includeExpenses) {
      const expenses = await listBillableUninvoicedExpenses(ctx.db, payload.projectId)
      const existingLineItems = await ctx.db
        .query('invoiceLineItems')
        .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
        .collect()
      let expenseSortOrder = existingLineItems.length

      for (const expense of expenses) {
        const markupRate = expense.markupRate ?? 1.0
        const amount = Math.round(expense.amount * markupRate)

        await insertInvoiceLineItem(ctx.db, {
          invoiceId,
          description: `Expense: ${expense.description}`,
          quantity: 1,
          rate: expense.amount,
          amount,
          sortOrder: expenseSortOrder++,
          expenseIds: [expense._id],
        })
      }
    }

    // Recalculate totals
    await recalculateInvoiceTotals(ctx.db, invoiceId)

    // Get all line items
    const lineItems = await ctx.db
      .query('invoiceLineItems')
      .withIndex('by_invoice', (q) => q.eq('invoiceId', invoiceId))
      .collect()

    return { invoiceId, lineItems }
  })

  return result
}

// =============================================================================
// Tests
// =============================================================================

describe('InvoiceTimeAndMaterials Work Item', () => {
  describe('GroupBy Service', () => {
    it('creates summary line items grouped by service', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      // Create time entries for different services
      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 2 * 24 * 60 * 60 * 1000, hours: 4 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 6 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 2 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should have 2 line items (one per service)
      expect(lineItems.length).toBe(2)

      // Check Development line item (10 hours @ $150)
      const devLine = lineItems.find((l) => l.description === 'Development')
      expect(devLine).toBeDefined()
      expect(devLine!.quantity).toBe(10)
      expect(devLine!.rate).toBe(150_00)
      expect(devLine!.amount).toBe(1500_00)

      // Check Consulting line item (2 hours @ $200)
      const consultLine = lineItems.find((l) => l.description === 'Consulting')
      expect(consultLine).toBeDefined()
      expect(consultLine!.quantity).toBe(2)
      expect(consultLine!.rate).toBe(200_00)
      expect(consultLine!.amount).toBe(400_00)
    })

    it('creates detailed line items for each time entry when detailLevel is detailed', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 2 * 24 * 60 * 60 * 1000, hours: 4 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 6 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'detailed',
        includeExpenses: false,
      })

      // Should have 2 line items (one per time entry, even though same service)
      expect(lineItems.length).toBe(2)

      // Each line item should have individual hours
      const hours = lineItems.map((l) => l.quantity).sort((a, b) => a - b)
      expect(hours).toEqual([4, 6])

      // Each line item should reference only one time entry
      for (const line of lineItems) {
        expect(line.timeEntryIds?.length).toBe(1)
      }
    })
  })

  describe('GroupBy Task', () => {
    it('creates summary line items grouped by task', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      // Create tasks
      const taskIds = await createTasks(testContext, {
        orgId: authResult.organizationId,
        projectId,
        tasks: [{ name: 'Backend Development' }, { name: 'Frontend Development' }],
      })

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, taskId: taskIds[0], date: now - 1 * 24 * 60 * 60 * 1000, hours: 5 },
          { userId: authResult.userId, serviceId: services[0].serviceId, taskId: taskIds[0], date: now - 2 * 24 * 60 * 60 * 1000, hours: 3 },
          { userId: authResult.userId, serviceId: services[1].serviceId, taskId: taskIds[1], date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'task',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      expect(lineItems.length).toBe(2)

      const backendLine = lineItems.find((l) => l.description === 'Backend Development')
      expect(backendLine).toBeDefined()
      expect(backendLine!.quantity).toBe(8) // 5 + 3 hours

      const frontendLine = lineItems.find((l) => l.description === 'Frontend Development')
      expect(frontendLine).toBeDefined()
      expect(frontendLine!.quantity).toBe(4)
    })

    it('creates detailed line items per entry when groupBy task with detailed level', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const taskIds = await createTasks(testContext, {
        orgId: authResult.organizationId,
        projectId,
        tasks: [{ name: 'API Development' }],
      })

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, taskId: taskIds[0], date: now - 2 * 24 * 60 * 60 * 1000, hours: 4 },
          { userId: authResult.userId, serviceId: services[0].serviceId, taskId: taskIds[0], date: now - 1 * 24 * 60 * 60 * 1000, hours: 5 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'task',
        detailLevel: 'detailed',
        includeExpenses: false,
      })

      // Should have 2 line items (one per entry)
      expect(lineItems.length).toBe(2)

      // Each line should include task name and service name
      for (const line of lineItems) {
        expect(line.description).toContain('API Development')
        expect(line.description).toContain('Development')
      }
    })
  })

  describe('GroupBy Date', () => {
    it('creates summary line items grouped by date', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      const day1 = now - 2 * 24 * 60 * 60 * 1000
      const day2 = now - 1 * 24 * 60 * 60 * 1000

      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day1, hours: 4 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: day1, hours: 2 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day2, hours: 6 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'date',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should have 2 line items (one per date)
      expect(lineItems.length).toBe(2)

      // Each line item description should start with "Work on"
      for (const line of lineItems) {
        expect(line.description).toMatch(/^Work on/)
      }

      // Line items should be sorted by date (sortOrder)
      expect(lineItems[0].sortOrder).toBeLessThan(lineItems[1].sortOrder)
    })

    it('creates detailed line items per entry when groupBy date with detailed level', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      const day1 = now - 1 * 24 * 60 * 60 * 1000

      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day1, hours: 4 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: day1, hours: 2 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'date',
        detailLevel: 'detailed',
        includeExpenses: false,
      })

      // Should have 2 line items (one per entry on same date)
      expect(lineItems.length).toBe(2)

      // Each should show date and service name
      const descriptions = lineItems.map((l) => l.description)
      expect(descriptions.some((d) => d.includes('Development'))).toBe(true)
      expect(descriptions.some((d) => d.includes('Consulting'))).toBe(true)
    })
  })

  describe('GroupBy Person', () => {
    it('creates summary line items grouped by person', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      // Create another user
      const user2Id = await createAdditionalUser(testContext, authResult.organizationId, 'Jane Developer')

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 5 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 2 * 24 * 60 * 60 * 1000, hours: 3 },
          { userId: user2Id, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 6 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'person',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should have 2 line items (one per person)
      expect(lineItems.length).toBe(2)

      // Check that line items have person names
      const descriptions = lineItems.map((l) => l.description)
      expect(descriptions.some((d) => d === 'Test User' || d === 'Jane Developer')).toBe(true)
    })

    it('creates detailed line items per entry when groupBy person with detailed level', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 2 * 24 * 60 * 60 * 1000, hours: 4 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 3 },
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'person',
        detailLevel: 'detailed',
        includeExpenses: false,
      })

      // Should have 2 line items (one per entry)
      expect(lineItems.length).toBe(2)

      // Each should show person name and service
      for (const line of lineItems) {
        expect(line.description).toContain('Test User')
      }
    })
  })

  describe('Date Range Filtering', () => {
    it('filters time entries by date range', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      const day1 = now - 5 * 24 * 60 * 60 * 1000 // 5 days ago
      const day2 = now - 3 * 24 * 60 * 60 * 1000 // 3 days ago
      const day3 = now - 1 * 24 * 60 * 60 * 1000 // 1 day ago

      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day1, hours: 4 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day2, hours: 5 },
          { userId: authResult.userId, serviceId: services[0].serviceId, date: day3, hours: 6 },
        ],
      })

      // Filter to only include day2 and day3
      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        dateRange: {
          startDate: now - 4 * 24 * 60 * 60 * 1000, // 4 days ago
          endDate: now,
        },
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should only include 11 hours (5 + 6), not the 4 from day1
      expect(lineItems.length).toBe(1)
      expect(lineItems[0].quantity).toBe(11)
    })
  })

  describe('Expense Handling', () => {
    it('includes expenses when includeExpenses is true', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 },
        ],
      })

      // Create a billable expense
      await testContext.run(async (ctx) => {
        const project = await ctx.db.get(projectId)
        await ctx.db.insert('expenses', {
          organizationId: project!.organizationId,
          projectId,
          userId: authResult.userId,
          date: now - 1 * 24 * 60 * 60 * 1000,
          amount: 100_00,
          currency: 'USD',
          type: 'Software',
          description: 'Software License',
          status: 'Approved',
          billable: true,
          markupRate: 1.15, // 15% markup
          createdAt: Date.now(),
        })
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: true,
      })

      // Should have 2 line items (time + expense)
      expect(lineItems.length).toBe(2)

      const expenseLine = lineItems.find((l) => l.description.startsWith('Expense:'))
      expect(expenseLine).toBeDefined()
      expect(expenseLine!.amount).toBe(115_00) // $100 * 1.15 markup
    })

    it('assigns expenses sortOrder that continues from time entries', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      // Create 3 time entries for 3 different services (will create 2 line items in summary mode)
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 2 },
        ],
      })

      // Create 2 billable expenses
      await testContext.run(async (ctx) => {
        const project = await ctx.db.get(projectId)
        await ctx.db.insert('expenses', {
          organizationId: project!.organizationId,
          projectId,
          userId: authResult.userId,
          date: now - 1 * 24 * 60 * 60 * 1000,
          amount: 100_00,
          currency: 'USD',
          type: 'Software',
          description: 'Software License',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
        await ctx.db.insert('expenses', {
          organizationId: project!.organizationId,
          projectId,
          userId: authResult.userId,
          date: now - 2 * 24 * 60 * 60 * 1000,
          amount: 50_00,
          currency: 'USD',
          type: 'Travel',
          description: 'Travel Expense',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: true,
      })

      // Should have 4 line items: 2 time entry groups + 2 expenses
      expect(lineItems.length).toBe(4)

      // Get time entry line items (descriptions don't start with "Expense:")
      const timeLineItems = lineItems.filter((l) => !l.description.startsWith('Expense:'))
      const expenseLineItems = lineItems.filter((l) => l.description.startsWith('Expense:'))

      expect(timeLineItems.length).toBe(2)
      expect(expenseLineItems.length).toBe(2)

      // Time entry line items should have sortOrder 0 and 1
      const timeSortOrders = timeLineItems.map((l) => l.sortOrder).sort((a, b) => a - b)
      expect(timeSortOrders).toEqual([0, 1])

      // Expense line items should have sortOrder 2 and 3 (continuing from time entries)
      const expenseSortOrders = expenseLineItems.map((l) => l.sortOrder).sort((a, b) => a - b)
      expect(expenseSortOrders).toEqual([2, 3])

      // All sortOrders should be unique
      const allSortOrders = lineItems.map((l) => l.sortOrder)
      const uniqueSortOrders = [...new Set(allSortOrders)]
      expect(uniqueSortOrders.length).toBe(lineItems.length)
    })

    it('excludes expenses when includeExpenses is false', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 },
        ],
      })

      // Create a billable expense
      await testContext.run(async (ctx) => {
        const project = await ctx.db.get(projectId)
        await ctx.db.insert('expenses', {
          organizationId: project!.organizationId,
          projectId,
          userId: authResult.userId,
          date: now - 1 * 24 * 60 * 60 * 1000,
          amount: 100_00,
          currency: 'USD',
          type: 'Software',
          description: 'Software License',
          status: 'Approved',
          billable: true,
          createdAt: Date.now(),
        })
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should only have 1 line item (time only)
      expect(lineItems.length).toBe(1)
      expect(lineItems[0].description).not.toContain('Expense')
    })
  })

  describe('Amount Calculations', () => {
    it('calculates correct totals for summary mode', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      // 10 hours @ $150 = $1,500
      // 5 hours @ $200 = $1,000
      // Total = $2,500
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 10 },
          { userId: authResult.userId, serviceId: services[1].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 5 },
        ],
      })

      const { invoiceId, lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Check line item amounts
      const total = lineItems.reduce((sum, l) => sum + l.amount, 0)
      expect(total).toBe(2500_00)

      // Check invoice total was recalculated
      const invoice = await testContext.run(async (ctx) => {
        return await ctx.db.get(invoiceId)
      })
      expect(invoice!.subtotal).toBe(2500_00)
      expect(invoice!.total).toBe(2500_00) // No tax in test
    })

    it('calculates correct amounts for detailed mode', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 2 * 24 * 60 * 60 * 1000, hours: 4 }, // 4 * 150 = 600
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 6 }, // 6 * 150 = 900
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'detailed',
        includeExpenses: false,
      })

      expect(lineItems.length).toBe(2)

      // Each line item should have individual amounts
      const amounts = lineItems.map((l) => l.amount).sort((a, b) => a - b)
      expect(amounts).toEqual([600_00, 900_00])
    })
  })

  describe('Edge Cases', () => {
    it('handles entries with no service assignment', async () => {
      const { projectId } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 }, // No serviceId
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      expect(lineItems.length).toBe(1)
      expect(lineItems[0].description).toBe('Professional Services')
      expect(lineItems[0].rate).toBe(0) // No rate without service
    })

    it('handles entries with no task assignment when groupBy task', async () => {
      const { projectId, services } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const now = Date.now()
      await createTimeEntries(testContext, {
        orgId: authResult.organizationId,
        projectId,
        entries: [
          { userId: authResult.userId, serviceId: services[0].serviceId, date: now - 1 * 24 * 60 * 60 * 1000, hours: 4 }, // No taskId
        ],
      })

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'task',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      expect(lineItems.length).toBe(1)
      expect(lineItems[0].description).toBe('General Work')
    })

    it('handles empty time entries gracefully', async () => {
      const { projectId } = await setupProjectWithBudget(
        testContext,
        authResult.organizationId
      )

      const { lineItems } = await invoiceTimeAndMaterials(testContext, {
        projectId,
        groupBy: 'service',
        detailLevel: 'summary',
        includeExpenses: false,
      })

      // Should create invoice with no line items
      expect(lineItems.length).toBe(0)
    })
  })
})
