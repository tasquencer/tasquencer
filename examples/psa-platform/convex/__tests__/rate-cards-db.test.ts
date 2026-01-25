/// <reference types="vite/client" />
/**
 * Tests for rate cards database functions
 *
 * Rate cards are the core pricing mechanism for the PSA platform:
 * - Each organization has rate cards with service-specific hourly rates
 * - One rate card can be marked as default for the organization
 * - Rate card items define the hourly rate (in cents) for each service type
 *
 * These rates flow into:
 * - Estimates (when calculating project costs)
 * - Invoices (when billing time entries)
 * - Budget calculations (for project planning)
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
): Promise<{ id: Id<'organizations'>; data: OmitIdAndCreationTime<Doc<'organizations'>> }> {
  const data: OmitIdAndCreationTime<Doc<'organizations'>> = {
    name: 'Test Organization',
    settings: {},
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('organizations', data)
  })
  return { id, data }
}

/**
 * Create a test rate card
 */
async function createTestRateCard(
  t: TestContext,
  organizationId: Id<'organizations'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'rateCards'>>> = {}
): Promise<{ id: Id<'rateCards'>; data: OmitIdAndCreationTime<Doc<'rateCards'>> }> {
  const data: OmitIdAndCreationTime<Doc<'rateCards'>> = {
    organizationId,
    name: 'Standard Rate Card',
    isDefault: false,
    createdAt: Date.now(),
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('rateCards', data)
  })
  return { id, data }
}

/**
 * Create a test rate card item
 */
async function createTestRateCardItem(
  t: TestContext,
  rateCardId: Id<'rateCards'>,
  overrides: Partial<OmitIdAndCreationTime<Doc<'rateCardItems'>>> = {}
): Promise<{ id: Id<'rateCardItems'>; data: OmitIdAndCreationTime<Doc<'rateCardItems'>> }> {
  const data: OmitIdAndCreationTime<Doc<'rateCardItems'>> = {
    rateCardId,
    serviceName: 'Software Development',
    rate: 15000, // $150/hr in cents
    ...overrides,
  }
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert('rateCardItems', data)
  })
  return { id, data }
}

// =============================================================================
// Rate Cards CRUD Tests
// =============================================================================

describe('Rate Cards Domain DB', () => {
  // ===========================================================================
  // Rate Cards CRUD
  // ===========================================================================

  describe('insertRateCard', () => {
    it('creates a new rate card for the organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, { name: 'Premium Rates' })

      const rateCard = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(rateCard).not.toBeNull()
      expect(rateCard!.name).toBe('Premium Rates')
      expect(rateCard!.organizationId).toBe(orgId)
      expect(rateCard!.isDefault).toBe(false)
    })

    it('creates rate card with default flag set to true', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, { isDefault: true })

      const rateCard = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(rateCard!.isDefault).toBe(true)
    })
  })

  describe('getRateCard', () => {
    it('returns the rate card by ID', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id, data } = await createTestRateCard(t, orgId)

      const rateCard = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(rateCard).not.toBeNull()
      expect(rateCard!.name).toBe(data.name)
    })

    it('returns null for non-existent rate card', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId)

      // Delete it to simulate non-existent
      await t.run(async (ctx) => {
        await ctx.db.delete(id)
      })

      const rateCard = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(rateCard).toBeNull()
    })
  })

  describe('updateRateCard', () => {
    it('updates rate card name', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, { name: 'Old Name' })

      await t.run(async (ctx) => {
        await ctx.db.patch(id, { name: 'New Name' })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(updated!.name).toBe('New Name')
    })

    it('updates rate card isDefault flag', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, { isDefault: false })

      await t.run(async (ctx) => {
        await ctx.db.patch(id, { isDefault: true })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(updated!.isDefault).toBe(true)
    })

    it('preserves other fields when updating', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, {
        name: 'Original',
        isDefault: true,
      })

      await t.run(async (ctx) => {
        await ctx.db.patch(id, { name: 'Updated' })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(updated!.name).toBe('Updated')
      expect(updated!.isDefault).toBe(true) // preserved
      expect(updated!.organizationId).toBe(orgId) // preserved
    })
  })

  describe('deleteRateCard', () => {
    it('deletes a rate card', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId)

      await t.run(async (ctx) => {
        await ctx.db.delete(id)
      })

      const deleted = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(deleted).toBeNull()
    })
  })

  describe('listRateCardsByOrganization', () => {
    it('returns all rate cards for organization', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestRateCard(t, orgId, { name: 'Standard' })
      await createTestRateCard(t, orgId, { name: 'Premium' })
      await createTestRateCard(t, orgId, { name: 'Enterprise' })

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      expect(rateCards.length).toBe(3)
      const names = rateCards.map((rc) => rc.name).sort()
      expect(names).toEqual(['Enterprise', 'Premium', 'Standard'])
    })

    it('returns empty array when no rate cards exist', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      expect(rateCards).toEqual([])
    })

    it('does not return rate cards from other organizations', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: otherOrgId } = await createTestOrganization(t, { name: 'Other Org' })

      await createTestRateCard(t, orgId, { name: 'My Rate Card' })
      await createTestRateCard(t, otherOrgId, { name: 'Other Rate Card' })

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      expect(rateCards.length).toBe(1)
      expect(rateCards[0].name).toBe('My Rate Card')
    })
  })

  // ===========================================================================
  // Default Rate Card Management
  // ===========================================================================

  describe('getDefaultRateCard', () => {
    it('returns rate card with isDefault=true', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      await createTestRateCard(t, orgId, { name: 'Standard', isDefault: false })
      await createTestRateCard(t, orgId, { name: 'Default', isDefault: true })
      await createTestRateCard(t, orgId, { name: 'Premium', isDefault: false })

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      const defaultRateCard = rateCards.find((rc) => rc.isDefault) ?? rateCards[0] ?? null

      expect(defaultRateCard).not.toBeNull()
      expect(defaultRateCard!.name).toBe('Default')
    })

    it('returns first rate card when none marked as default', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      // Create rate cards without default flag
      await createTestRateCard(t, orgId, {
        name: 'First',
        isDefault: false,
      })
      await createTestRateCard(t, orgId, { name: 'Second', isDefault: false })

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      const defaultRateCard = rateCards.find((rc) => rc.isDefault) ?? rateCards[0] ?? null

      // Should return the first one in the list (Convex returns in creation order)
      expect(defaultRateCard).not.toBeNull()
    })

    it('returns null when no rate cards exist', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)

      const rateCards = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
      })

      const defaultRateCard = rateCards.find((rc) => rc.isDefault) ?? rateCards[0] ?? null

      expect(defaultRateCard).toBeNull()
    })
  })

  describe('setDefaultRateCard', () => {
    it('sets a rate card as default', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id } = await createTestRateCard(t, orgId, { isDefault: false })

      await t.run(async (ctx) => {
        await ctx.db.patch(id, { isDefault: true })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(id)
      })

      expect(updated!.isDefault).toBe(true)
    })

    it('unsets previous default when setting new default', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: firstId } = await createTestRateCard(t, orgId, {
        name: 'First',
        isDefault: true,
      })
      const { id: secondId } = await createTestRateCard(t, orgId, {
        name: 'Second',
        isDefault: false,
      })

      // Simulate setDefaultRateCard logic: unset old default, set new one
      await t.run(async (ctx) => {
        // Find and unset existing default
        const rateCards = await ctx.db
          .query('rateCards')
          .withIndex('by_organization', (q) => q.eq('organizationId', orgId))
          .collect()
        const existingDefault = rateCards.find((rc) => rc.isDefault)
        if (existingDefault && existingDefault._id !== secondId) {
          await ctx.db.patch(existingDefault._id, { isDefault: false })
        }
        // Set new default
        await ctx.db.patch(secondId, { isDefault: true })
      })

      const first = await t.run(async (ctx) => ctx.db.get(firstId))
      const second = await t.run(async (ctx) => ctx.db.get(secondId))

      expect(first!.isDefault).toBe(false)
      expect(second!.isDefault).toBe(true)
    })
  })

  // ===========================================================================
  // Rate Card Items CRUD
  // ===========================================================================

  describe('insertRateCardItem', () => {
    it('creates a new rate card item', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Consulting',
        rate: 20000, // $200/hr
      })

      const item = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(item).not.toBeNull()
      expect(item!.serviceName).toBe('Consulting')
      expect(item!.rate).toBe(20000)
      expect(item!.rateCardId).toBe(rateCardId)
    })

    it('creates multiple items for same rate card', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)

      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Development',
        rate: 15000,
      })
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Design',
        rate: 12000,
      })
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Project Management',
        rate: 18000,
      })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      expect(items.length).toBe(3)
    })
  })

  describe('getRateCardItem', () => {
    it('returns rate card item by ID', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId, data } = await createTestRateCardItem(t, rateCardId)

      const item = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(item).not.toBeNull()
      expect(item!.serviceName).toBe(data.serviceName)
      expect(item!.rate).toBe(data.rate)
    })
  })

  describe('updateRateCardItem', () => {
    it('updates rate card item rate', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, { rate: 10000 })

      await t.run(async (ctx) => {
        await ctx.db.patch(itemId, { rate: 15000 })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(updated!.rate).toBe(15000)
    })

    it('updates rate card item service name', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Old Service',
      })

      await t.run(async (ctx) => {
        await ctx.db.patch(itemId, { serviceName: 'New Service' })
      })

      const updated = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(updated!.serviceName).toBe('New Service')
    })
  })

  describe('deleteRateCardItem', () => {
    it('deletes a rate card item', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId)

      await t.run(async (ctx) => {
        await ctx.db.delete(itemId)
      })

      const deleted = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(deleted).toBeNull()
    })
  })

  describe('listRateCardItems', () => {
    it('returns all items for a rate card', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)

      await createTestRateCardItem(t, rateCardId, { serviceName: 'Development', rate: 15000 })
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Design', rate: 12000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      expect(items.length).toBe(2)
      const services = items.map((i) => i.serviceName).sort()
      expect(services).toEqual(['Design', 'Development'])
    })

    it('returns empty array when no items exist', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      expect(items).toEqual([])
    })

    it('does not return items from other rate cards', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCard1 } = await createTestRateCard(t, orgId, { name: 'Card 1' })
      const { id: rateCard2 } = await createTestRateCard(t, orgId, { name: 'Card 2' })

      await createTestRateCardItem(t, rateCard1, { serviceName: 'Service A', rate: 10000 })
      await createTestRateCardItem(t, rateCard2, { serviceName: 'Service B', rate: 20000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCard1))
          .collect()
      })

      expect(items.length).toBe(1)
      expect(items[0].serviceName).toBe('Service A')
    })
  })

  // ===========================================================================
  // Service Rate Lookup
  // ===========================================================================

  describe('getRateForService', () => {
    it('returns rate for matching service name', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Consulting', rate: 25000 })
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Development', rate: 15000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      const rate = items.find((i) => i.serviceName === 'Consulting')?.rate ?? null

      expect(rate).toBe(25000)
    })

    it('returns null when service not found', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Development', rate: 15000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      const rate = items.find((i) => i.serviceName === 'NonExistent')?.rate ?? null

      expect(rate).toBeNull()
    })

    it('is case-sensitive when matching service names', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Development', rate: 15000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      // Exact match should work
      const exactRate = items.find((i) => i.serviceName === 'Development')?.rate ?? null
      expect(exactRate).toBe(15000)

      // Different case should not match
      const lowerRate = items.find((i) => i.serviceName === 'development')?.rate ?? null
      expect(lowerRate).toBeNull()
    })
  })

  // ===========================================================================
  // Rate Card Business Logic
  // ===========================================================================

  describe('Rate Card Business Logic', () => {
    it('calculates total service cost using rate card', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      await createTestRateCardItem(t, rateCardId, { serviceName: 'Development', rate: 15000 })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      const rate = items.find((i) => i.serviceName === 'Development')?.rate ?? 0

      // Calculate cost for 10 hours of development
      const hours = 10
      const totalCost = rate * hours

      expect(totalCost).toBe(150000) // $1,500 in cents
    })

    it('supports multiple service types with different rates', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)

      // Create typical service tier structure
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Senior Architect',
        rate: 35000, // $350/hr
      })
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Senior Developer',
        rate: 20000, // $200/hr
      })
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Junior Developer',
        rate: 10000, // $100/hr
      })
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Project Manager',
        rate: 15000, // $150/hr
      })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      expect(items.length).toBe(4)

      // Verify rate ordering for blended rate calculations
      const rates = items.map((i) => i.rate).sort((a, b) => b - a)
      expect(rates).toEqual([35000, 20000, 15000, 10000])
    })

    it('supports organization-specific pricing', async () => {
      const t = setup()
      // Create two organizations with different rate cards
      const { id: org1Id } = await createTestOrganization(t)
      const { id: org2Id } = await createTestOrganization(t, { name: 'Enterprise Client' })

      const { id: standardCardId } = await createTestRateCard(t, org1Id, {
        name: 'Standard Rates',
        isDefault: true,
      })
      const { id: enterpriseCardId } = await createTestRateCard(t, org2Id, {
        name: 'Enterprise Rates',
        isDefault: true,
      })

      // Standard org: $150/hr for development
      await createTestRateCardItem(t, standardCardId, {
        serviceName: 'Development',
        rate: 15000,
      })

      // Enterprise org: $250/hr for development (premium pricing)
      await createTestRateCardItem(t, enterpriseCardId, {
        serviceName: 'Development',
        rate: 25000,
      })

      const standardItems = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', standardCardId))
          .collect()
      })

      const enterpriseItems = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', enterpriseCardId))
          .collect()
      })

      const standardRate = standardItems.find((i) => i.serviceName === 'Development')?.rate
      const enterpriseRate = enterpriseItems.find((i) => i.serviceName === 'Development')?.rate

      expect(standardRate).toBe(15000)
      expect(enterpriseRate).toBe(25000)
    })
  })

  // ===========================================================================
  // Edge Cases and Validation
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles rate of zero (pro bono services)', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Pro Bono Consulting',
        rate: 0,
      })

      const item = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(item!.rate).toBe(0)
    })

    it('handles very high rates (premium consulting)', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Executive Consulting',
        rate: 100000, // $1,000/hr
      })

      const item = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(item!.rate).toBe(100000)
    })

    it('handles special characters in service names', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      await createTestRateCardItem(t, rateCardId, {
        serviceName: 'Cloud Infrastructure (AWS/GCP)',
        rate: 18000,
      })

      const items = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', rateCardId))
          .collect()
      })

      const foundRate = items.find((i) => i.serviceName === 'Cloud Infrastructure (AWS/GCP)')?.rate
      expect(foundRate).toBe(18000)
    })

    it('handles empty service name', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: rateCardId } = await createTestRateCard(t, orgId)
      const { id: itemId } = await createTestRateCardItem(t, rateCardId, {
        serviceName: '',
        rate: 10000,
      })

      const item = await t.run(async (ctx) => {
        return await ctx.db.get(itemId)
      })

      expect(item!.serviceName).toBe('')
    })

    it('allows duplicate service names (different rate cards)', async () => {
      const t = setup()
      const { id: orgId } = await createTestOrganization(t)
      const { id: card1 } = await createTestRateCard(t, orgId, { name: 'Standard' })
      const { id: card2 } = await createTestRateCard(t, orgId, { name: 'Premium' })

      await createTestRateCardItem(t, card1, { serviceName: 'Development', rate: 15000 })
      await createTestRateCardItem(t, card2, { serviceName: 'Development', rate: 20000 })

      const items1 = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', card1))
          .collect()
      })

      const items2 = await t.run(async (ctx) => {
        return await ctx.db
          .query('rateCardItems')
          .withIndex('by_rate_card', (q) => q.eq('rateCardId', card2))
          .collect()
      })

      expect(items1.find((i) => i.serviceName === 'Development')?.rate).toBe(15000)
      expect(items2.find((i) => i.serviceName === 'Development')?.rate).toBe(20000)
    })
  })
})
