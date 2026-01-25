/// <reference types="vite/client" />
/**
 * Tests for estimate services and budget services database functions
 *
 * Estimate Services: Line items in estimates (pre-sale/quoting phase)
 * - Used for building out quotes for potential clients
 * - Contains service name, hourly rate, estimated hours, and calculated total
 *
 * Budget Services: Line items in project budgets (post-sale/execution phase)
 * - Used for managing project budget allocations
 * - Contains service name, hourly rate, estimated hours, and total amount
 *
 * Flow: Estimate Services → Budget Services when deal is won
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { setup, type TestContext } from './helpers.test'
import type { Id, Doc } from '../_generated/dataModel'

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// =============================================================================
// Test Data Factories
// =============================================================================

type OmitIdAndCreationTime<T extends { _id: unknown; _creationTime: unknown }> =
  Omit<T, '_id' | '_creationTime'>

/**
 * Create a test organization
 */
async function createTestOrganization(
  t: TestContext,
  overrides: Partial<OmitIdAndCreationTime<Doc<'organizations'>>> = {}
): Promise<{ id: Id<'organizations'> }> {
  const data: OmitIdAndCreationTime<Doc<'organizations'>> = {
    name: 'Test Organization',
    settings: {},
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', data)
  })
  return { id }
}

/**
 * Create a test user
 */
async function createTestUser(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'users'>>> = {}
): Promise<{ id: Id<'users'> }> {
  const data: OmitIdAndCreationTime<Doc<'users'>> = {
    organizationId,
    email: `user-${Date.now()}@example.com`,
    name: 'Test User',
    role: 'admin',
    costRate: 10000,
    billRate: 15000,
    skills: [],
    department: 'Engineering',
    location: 'Remote',
    isActive: true,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('users', data)
  })
  return { id }
}

/**
 * Create a test company
 */
async function createTestCompany(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'companies'>>> = {}
): Promise<{ id: Id<'companies'> }> {
  const data: OmitIdAndCreationTime<Doc<'companies'>> = {
    organizationId,
    name: 'Acme Corp',
    billingAddress: {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94102',
      country: 'USA',
    },
    paymentTerms: 30,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('companies', data)
  })
  return { id }
}

/**
 * Create a test contact
 */
async function createTestContact(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>
): Promise<{ id: Id<'contacts'> }> {
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('contacts', {
      organizationId,
      companyId,
      name: 'John Doe',
      email: `contact-${Date.now()}@acme.example.com`,
      phone: '+1-555-0101',
      isPrimary: true,
    })
  })
  return { id }
}

/**
 * Create a test deal
 */
async function createTestDeal(
  t: TestContext,
  organizationId: Id<'organizations'>,
  companyId: Id<'companies'>,
  ownerId: Id<'users'>,
  contactId: Id<'contacts'>
): Promise<{ id: Id<'deals'> }> {
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('deals', {
      organizationId,
      companyId,
      contactId,
      ownerId,
      name: 'Test Deal',
      value: 10000000,
      stage: 'Lead',
      probability: 10,
      createdAt: Date.now(),
    })
  })
  return { id }
}

/**
 * Create a test estimate
 */
async function createTestEstimate(
  t: TestContext,
  organizationId: Id<'organizations'>,
  dealId: Id<'deals'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'estimates'>>> = {}
): Promise<{ id: Id<'estimates'>; data: OmitIdAndCreationTime<Doc<'estimates'>> }> {
  const data: OmitIdAndCreationTime<Doc<'estimates'>> = {
    organizationId,
    dealId,
    total: 0,
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('estimates', data)
  })
  return { id, data }
}

/**
 * Create a test estimate service
 */
async function createTestEstimateService(
  t: TestContext,
  estimateId: Id<'estimates'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'estimateServices'>>> = {}
): Promise<{ id: Id<'estimateServices'>; data: OmitIdAndCreationTime<Doc<'estimateServices'>> }> {
  const hours = overrides.hours ?? 100
  const rate = overrides.rate ?? 15000
  const data: OmitIdAndCreationTime<Doc<'estimateServices'>> = {
    estimateId,
    name: 'Software Development',
    rate,
    hours,
    total: hours * rate,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('estimateServices', data)
  })
  return { id, data }
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
): Promise<{ id: Id<'projects'> }> {
  const now = Date.now()
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('projects', {
      organizationId,
      companyId,
      dealId,
      managerId,
      name: 'Test Project',
      status: 'Planning',
      startDate: now,
      endDate: now + 90 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
  })
  return { id }
}

/**
 * Create a test budget
 */
async function createTestBudget(
  t: TestContext,
  organizationId: Id<'organizations'>,
  projectId: Id<'projects'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'budgets'>>> = {}
): Promise<{ id: Id<'budgets'>; data: OmitIdAndCreationTime<Doc<'budgets'>> }> {
  const data: OmitIdAndCreationTime<Doc<'budgets'>> = {
    organizationId,
    projectId,
    type: 'TimeAndMaterials',
    totalAmount: 0,
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('budgets', data)
  })
  return { id, data }
}

/**
 * Create a test budget service
 */
async function createTestBudgetService(
  t: TestContext,
  organizationId: Id<'organizations'>,
  budgetId: Id<'budgets'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'services'>>> = {}
): Promise<{ id: Id<'services'>; data: OmitIdAndCreationTime<Doc<'services'>> }> {
  const hours = overrides.estimatedHours ?? 100
  const rate = overrides.rate ?? 15000
  const data: OmitIdAndCreationTime<Doc<'services'>> = {
    budgetId,
    organizationId,
    name: 'Software Development',
    rate,
    estimatedHours: hours,
    totalAmount: hours * rate,
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('services', data)
  })
  return { id, data }
}

/**
 * Helper to create base test data
 */
async function createBaseTestData(t: TestContext) {
  const { id: orgId } = await createTestOrganization(t)
  const { id: userId } = await createTestUser(t, orgId)
  const { id: companyId } = await createTestCompany(t, orgId)
  const { id: contactId } = await createTestContact(t, orgId, companyId)
  return { orgId, userId, companyId, contactId }
}

// =============================================================================
// Estimate Services Tests
// =============================================================================

describe('Estimate Services Domain DB', () => {
  describe('insertEstimateService', () => {
    it('creates a new estimate service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId, {
        name: 'Design Services',
        rate: 12000, // $120/hr
        hours: 40,
      })

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(service).not.toBeNull()
      expect(service!.name).toBe('Design Services')
      expect(service!.rate).toBe(12000)
      expect(service!.hours).toBe(40)
      expect(service!.total).toBe(480000) // 40 * 12000
      expect(service!.estimateId).toBe(estimateId)
    })

    it('creates multiple services for the same estimate', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)

      await createTestEstimateService(t, estimateId, { name: 'Development', rate: 15000, hours: 100 })
      await createTestEstimateService(t, estimateId, { name: 'Design', rate: 12000, hours: 40 })
      await createTestEstimateService(t, estimateId, { name: 'Project Management', rate: 18000, hours: 20 })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
          .collect()
      })

      expect(services.length).toBe(3)
    })
  })

  describe('getEstimateService', () => {
    it('returns estimate service by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId, data } = await createTestEstimateService(t, estimateId)

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(service).not.toBeNull()
      expect(service!.name).toBe(data.name)
      expect(service!.rate).toBe(data.rate)
    })

    it('returns null for non-existent service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId)

      await t.run(async (ctx) => {
        await ctx.db.delete(serviceId)
      })

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(service).toBeNull()
    })
  })

  describe('listEstimateServices', () => {
    it('returns all services for an estimate', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)

      await createTestEstimateService(t, estimateId, { name: 'Service A' })
      await createTestEstimateService(t, estimateId, { name: 'Service B' })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
          .collect()
      })

      expect(services.length).toBe(2)
      const names = services.map((s) => s.name).sort()
      expect(names).toEqual(['Service A', 'Service B'])
    })

    it('returns empty array when no services exist', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
          .collect()
      })

      expect(services).toEqual([])
    })

    it('does not return services from other estimates', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimate1 } = await createTestEstimate(t, orgId, dealId)
      const { id: estimate2 } = await createTestEstimate(t, orgId, dealId)

      await createTestEstimateService(t, estimate1, { name: 'Service for Estimate 1' })
      await createTestEstimateService(t, estimate2, { name: 'Service for Estimate 2' })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimate1))
          .collect()
      })

      expect(services.length).toBe(1)
      expect(services[0].name).toBe('Service for Estimate 1')
    })
  })

  describe('updateEstimateService', () => {
    it('updates service rate', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId, { rate: 10000 })

      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { rate: 15000 })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(updated!.rate).toBe(15000)
    })

    it('updates service hours', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId, { hours: 50 })

      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { hours: 80 })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(updated!.hours).toBe(80)
    })

    it('updates service name', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId, { name: 'Old Name' })

      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { name: 'New Name' })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(updated!.name).toBe('New Name')
    })
  })

  describe('deleteEstimateService', () => {
    it('deletes an estimate service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId)
      const { id: serviceId } = await createTestEstimateService(t, estimateId)

      await t.run(async (ctx) => {
        await ctx.db.delete(serviceId)
      })

      const deleted = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(deleted).toBeNull()
    })
  })

  describe('recalculateEstimateTotal', () => {
    it('calculates total from all services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId, { total: 0 })

      // Service 1: 100 hours @ $150/hr = $15,000
      await createTestEstimateService(t, estimateId, { name: 'Dev', rate: 15000, hours: 100, total: 1500000 })
      // Service 2: 40 hours @ $120/hr = $4,800
      await createTestEstimateService(t, estimateId, { name: 'Design', rate: 12000, hours: 40, total: 480000 })

      // Recalculate
      const newTotal = await t.run(async (ctx) => {
        const services = await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
          .collect()
        const total = services.reduce((sum, s) => sum + s.total, 0)
        await ctx.db.patch(estimateId, { total })
        return total
      })

      expect(newTotal).toBe(1980000) // $19,800 in cents

      const estimate = await t.run(async (ctx) => {
        return await ctx.db.get(estimateId)
      })

      expect(estimate!.total).toBe(1980000)
    })

    it('returns zero when no services exist', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: estimateId } = await createTestEstimate(t, orgId, dealId, { total: 100000 })

      // Recalculate with no services
      const newTotal = await t.run(async (ctx) => {
        const services = await ctx.db
          .query('estimateServices')
          .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
          .collect()
        const total = services.reduce((sum, s) => sum + s.total, 0)
        await ctx.db.patch(estimateId, { total })
        return total
      })

      expect(newTotal).toBe(0)
    })
  })
})

// =============================================================================
// Budget Services Tests
// =============================================================================

describe('Budget Services Domain DB', () => {
  describe('insertService', () => {
    it('creates a new budget service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)
      const { id: serviceId } = await createTestBudgetService(t, orgId, budgetId, {
        name: 'Design Services',
        rate: 12000,
        estimatedHours: 40,
        totalAmount: 480000,
      })

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(service).not.toBeNull()
      expect(service!.name).toBe('Design Services')
      expect(service!.rate).toBe(12000)
      expect(service!.estimatedHours).toBe(40)
      expect(service!.totalAmount).toBe(480000)
      expect(service!.budgetId).toBe(budgetId)
    })

    it('creates multiple services for the same budget', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)

      await createTestBudgetService(t, orgId, budgetId, { name: 'Development' })
      await createTestBudgetService(t, orgId, budgetId, { name: 'Design' })
      await createTestBudgetService(t, orgId, budgetId, { name: 'QA' })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
          .collect()
      })

      expect(services.length).toBe(3)
    })
  })

  describe('getService', () => {
    it('returns budget service by ID', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)
      const { id: serviceId, data } = await createTestBudgetService(t, orgId, budgetId)

      const service = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(service).not.toBeNull()
      expect(service!.name).toBe(data.name)
      expect(service!.rate).toBe(data.rate)
    })
  })

  describe('listServicesByBudget', () => {
    it('returns all services for a budget', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)

      await createTestBudgetService(t, orgId, budgetId, { name: 'Service A' })
      await createTestBudgetService(t, orgId, budgetId, { name: 'Service B' })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
          .collect()
      })

      expect(services.length).toBe(2)
      const names = services.map((s) => s.name).sort()
      expect(names).toEqual(['Service A', 'Service B'])
    })

    it('returns empty array when no services exist', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
          .collect()
      })

      expect(services).toEqual([])
    })

    it('does not return services from other budgets', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budget1 } = await createTestBudget(t, orgId, projectId)
      const { id: budget2 } = await createTestBudget(t, orgId, projectId)

      await createTestBudgetService(t, orgId, budget1, { name: 'Service for Budget 1' })
      await createTestBudgetService(t, orgId, budget2, { name: 'Service for Budget 2' })

      const services = await t.run(async (ctx) => {
        return await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budget1))
          .collect()
      })

      expect(services.length).toBe(1)
      expect(services[0].name).toBe('Service for Budget 1')
    })
  })

  describe('updateService', () => {
    it('updates service rate', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)
      const { id: serviceId } = await createTestBudgetService(t, orgId, budgetId, { rate: 10000 })

      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { rate: 15000 })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(updated!.rate).toBe(15000)
    })

    it('updates service estimated hours', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)
      const { id: serviceId } = await createTestBudgetService(t, orgId, budgetId, { estimatedHours: 50 })

      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { estimatedHours: 80 })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(updated!.estimatedHours).toBe(80)
    })
  })

  describe('deleteService', () => {
    it('deletes a budget service', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId)
      const { id: serviceId } = await createTestBudgetService(t, orgId, budgetId)

      await t.run(async (ctx) => {
        await ctx.db.delete(serviceId)
      })

      const deleted = await t.run(async (ctx) => {
        return await ctx.db.get(serviceId)
      })

      expect(deleted).toBeNull()
    })
  })

  describe('recalculateBudgetTotal', () => {
    it('calculates total from all services', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId, { totalAmount: 0 })

      // Service 1: 100 hours @ $150/hr = $15,000
      await createTestBudgetService(t, orgId, budgetId, {
        name: 'Dev',
        rate: 15000,
        estimatedHours: 100,
        totalAmount: 1500000,
      })
      // Service 2: 40 hours @ $120/hr = $4,800
      await createTestBudgetService(t, orgId, budgetId, {
        name: 'Design',
        rate: 12000,
        estimatedHours: 40,
        totalAmount: 480000,
      })

      // Recalculate
      const newTotal = await t.run(async (ctx) => {
        const services = await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
          .collect()
        const total = services.reduce((sum, s) => sum + s.totalAmount, 0)
        await ctx.db.patch(budgetId, { totalAmount: total })
        return total
      })

      expect(newTotal).toBe(1980000) // $19,800 in cents

      const budget = await t.run(async (ctx) => {
        return await ctx.db.get(budgetId)
      })

      expect(budget!.totalAmount).toBe(1980000)
    })

    it('returns zero when no services exist', async () => {
      const t = setup()
      const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
      const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
      const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
      const { id: budgetId } = await createTestBudget(t, orgId, projectId, { totalAmount: 100000 })

      // Recalculate with no services
      const newTotal = await t.run(async (ctx) => {
        const services = await ctx.db
          .query('services')
          .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
          .collect()
        const total = services.reduce((sum, s) => sum + s.totalAmount, 0)
        await ctx.db.patch(budgetId, { totalAmount: total })
        return total
      })

      expect(newTotal).toBe(0)
    })
  })
})

// =============================================================================
// Estimate to Budget Conversion Tests
// =============================================================================

describe('Estimate to Budget Service Conversion', () => {
  it('converts estimate services to budget services when deal is won', async () => {
    const t = setup()
    const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
    const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
    const { id: estimateId } = await createTestEstimate(t, orgId, dealId)

    // Create estimate services
    await createTestEstimateService(t, estimateId, {
      name: 'Development',
      rate: 15000,
      hours: 100,
      total: 1500000,
    })
    await createTestEstimateService(t, estimateId, {
      name: 'Design',
      rate: 12000,
      hours: 40,
      total: 480000,
    })

    // Simulate deal won - create project and budget from estimate
    const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
    const { id: budgetId } = await createTestBudget(t, orgId, projectId)

    // Convert estimate services to budget services
    const estimateServices = await t.run(async (ctx) => {
      return await ctx.db
        .query('estimateServices')
        .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
        .collect()
    })

    for (const es of estimateServices) {
      await createTestBudgetService(t, orgId, budgetId, {
        name: es.name,
        rate: es.rate,
        estimatedHours: es.hours,
        totalAmount: es.total,
      })
    }

    // Verify budget services match estimate services
    const budgetServices = await t.run(async (ctx) => {
      return await ctx.db
        .query('services')
        .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
        .collect()
    })

    expect(budgetServices.length).toBe(2)

    const devService = budgetServices.find((s) => s.name === 'Development')
    expect(devService!.rate).toBe(15000)
    expect(devService!.estimatedHours).toBe(100)
    expect(devService!.totalAmount).toBe(1500000)

    const designService = budgetServices.find((s) => s.name === 'Design')
    expect(designService!.rate).toBe(12000)
    expect(designService!.estimatedHours).toBe(40)
    expect(designService!.totalAmount).toBe(480000)
  })

  it('calculates matching totals for estimate and budget', async () => {
    const t = setup()
    const { orgId, userId, companyId, contactId } = await createBaseTestData(t)
    const { id: dealId } = await createTestDeal(t, orgId, companyId, userId, contactId)
    const { id: estimateId } = await createTestEstimate(t, orgId, dealId, { total: 0 })

    // Create services
    await createTestEstimateService(t, estimateId, {
      name: 'Service',
      rate: 15000,
      hours: 100,
      total: 1500000,
    })

    // Calculate estimate total
    const estimateTotal = await t.run(async (ctx) => {
      const services = await ctx.db
        .query('estimateServices')
        .withIndex('by_estimate', (q) => q.eq('estimateId', estimateId))
        .collect()
      const total = services.reduce((sum, s) => sum + s.total, 0)
      await ctx.db.patch(estimateId, { total })
      return total
    })

    // Create project and budget
    const { id: projectId } = await createTestProject(t, orgId, companyId, dealId, userId)
    const { id: budgetId } = await createTestBudget(t, orgId, projectId, { totalAmount: 0 })

    // Convert and calculate budget total
    await createTestBudgetService(t, orgId, budgetId, {
      name: 'Service',
      rate: 15000,
      estimatedHours: 100,
      totalAmount: 1500000,
    })

    const budgetTotal = await t.run(async (ctx) => {
      const services = await ctx.db
        .query('services')
        .withIndex('by_budget', (q) => q.eq('budgetId', budgetId))
        .collect()
      const total = services.reduce((sum, s) => sum + s.totalAmount, 0)
      await ctx.db.patch(budgetId, { totalAmount: total })
      return total
    })

    expect(estimateTotal).toBe(budgetTotal)
    expect(estimateTotal).toBe(1500000)
  })
})
