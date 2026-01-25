/**
 * Estimates API
 *
 * Domain-specific queries and mutations for estimate management.
 * These wrap domain functions with authorization and provide
 * helper mutations for work item handlers.
 *
 * TENET-AUTHZ: All queries and mutations are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/03-workflow-sales-phase.md
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import type { Id } from '../../../_generated/dataModel'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getEstimate as getEstimateFromDb,
  getEstimateByDealId,
  listEstimatesByDeal as listEstimatesByDealFromDb,
  insertEstimate,
  insertEstimateService,
  getEstimateService as getEstimateServiceFromDb,
  listEstimateServices,
  updateEstimateService as updateEstimateServiceInDb,
  deleteEstimateService as deleteEstimateServiceFromDb,
  recalculateEstimateTotal,
  getDeal,
  updateDeal,
} from '../db'

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Gets an estimate by ID with its services.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.estimateId - The estimate ID
 * @returns The estimate with services array, or null
 */
export const getEstimate = query({
  args: { estimateId: v.id('estimates') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const estimate = await getEstimateFromDb(ctx.db, args.estimateId)
    if (!estimate) {
      return null
    }

    const services = await listEstimateServices(ctx.db, args.estimateId)

    return {
      ...estimate,
      services,
    }
  },
})

/**
 * Gets the estimate for a deal (most recent).
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @returns The estimate with services array, or null if no estimate exists
 */
export const getEstimateByDeal = query({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const estimate = await getEstimateByDealId(ctx.db, args.dealId)
    if (!estimate) {
      return null
    }

    const services = await listEstimateServices(ctx.db, estimate._id)

    return {
      ...estimate,
      services,
    }
  },
})

/**
 * Lists all estimates for a deal.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @param args.limit - Optional: Maximum number of estimates to return (default 10)
 * @returns Array of estimates with their services
 */
export const listEstimatesByDeal = query({
  args: {
    dealId: v.id('deals'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    const estimates = await listEstimatesByDealFromDb(
      ctx.db,
      args.dealId,
      args.limit ?? 10
    )

    // Load services for each estimate
    const estimatesWithServices = await Promise.all(
      estimates.map(async (estimate) => {
        const services = await listEstimateServices(ctx.db, estimate._id)
        return {
          ...estimate,
          services,
        }
      })
    )

    return estimatesWithServices
  },
})

// =============================================================================
// MUTATIONS (Helper mutations for work item handlers)
// =============================================================================

/**
 * Creates an estimate with services for a deal.
 * Used by createEstimate work item to build service breakdowns.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.dealId - The deal ID
 * @param args.services - Array of service line items to add
 * @returns The new estimate ID
 */
export const createEstimate = mutation({
  args: {
    dealId: v.id('deals'),
    services: v.array(
      v.object({
        name: v.string(),
        rate: v.number(),
        hours: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<'estimates'>> => {
    await requirePsaStaffMember(ctx)

    // Validate services array is not empty (spec 04-workflow-planning-phase.md line 149)
    if (args.services.length === 0) {
      throw new Error('Estimate must have at least one service')
    }

    // Validate rate and hours for each service (spec 04-workflow-planning-phase.md line 150)
    for (const service of args.services) {
      if (service.rate <= 0) {
        throw new Error(`Service rate must be greater than 0: ${service.name}`)
      }
      if (service.hours <= 0) {
        throw new Error(`Service hours must be greater than 0: ${service.name}`)
      }
    }

    // Get deal to verify it exists and get organization ID
    const deal = await getDeal(ctx.db, args.dealId)
    if (!deal) {
      throw new Error(`Deal not found: ${args.dealId}`)
    }

    // Calculate initial total from services
    const total = args.services.reduce(
      (sum, service) => sum + service.rate * service.hours,
      0
    )

    // Create the estimate
    const estimateId = await insertEstimate(ctx.db, {
      organizationId: deal.organizationId,
      dealId: args.dealId,
      total,
      createdAt: Date.now(),
    })

    // Create all service line items
    for (const service of args.services) {
      await insertEstimateService(ctx.db, {
        estimateId,
        name: service.name,
        rate: service.rate,
        hours: service.hours,
        total: service.rate * service.hours,
      })
    }

    // Sync deal value with estimate total
    // Per spec 03-workflow-sales-phase.md line 391: "Deal value always reflects current estimate total"
    await updateDeal(ctx.db, args.dealId, { value: total })

    return estimateId
  },
})

/**
 * Adds a service line item to an estimate.
 * Used to add individual services during estimate building.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.estimateId - The estimate ID
 * @param args.name - Service name (e.g., "Design", "Development")
 * @param args.rate - Hourly rate in cents
 * @param args.hours - Estimated hours
 * @returns The new service line item ID
 */
export const addEstimateService = mutation({
  args: {
    estimateId: v.id('estimates'),
    name: v.string(),
    rate: v.number(),
    hours: v.number(),
  },
  handler: async (ctx, args): Promise<Id<'estimateServices'>> => {
    await requirePsaStaffMember(ctx)

    // Validate rate and hours (spec 04-workflow-planning-phase.md line 150)
    if (args.rate <= 0) {
      throw new Error('Service rate must be greater than 0')
    }
    if (args.hours <= 0) {
      throw new Error('Service hours must be greater than 0')
    }

    // Verify estimate exists
    const estimate = await getEstimateFromDb(ctx.db, args.estimateId)
    if (!estimate) {
      throw new Error(`Estimate not found: ${args.estimateId}`)
    }

    // Calculate service total
    const total = args.rate * args.hours

    // Create the service line item
    const serviceId = await insertEstimateService(ctx.db, {
      estimateId: args.estimateId,
      name: args.name,
      rate: args.rate,
      hours: args.hours,
      total,
    })

    // Recalculate estimate total and sync deal value
    // Per spec 03-workflow-sales-phase.md line 391: "Deal value always reflects current estimate total"
    const newTotal = await recalculateEstimateTotal(ctx.db, args.estimateId)
    await updateDeal(ctx.db, estimate.dealId, { value: newTotal })

    return serviceId
  },
})

/**
 * Updates a service line item.
 * Used to modify service details during estimate refinement.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.serviceId - The service line item ID
 * @param args.name - Optional: New service name
 * @param args.rate - Optional: New hourly rate in cents
 * @param args.hours - Optional: New estimated hours
 */
export const updateEstimateService = mutation({
  args: {
    serviceId: v.id('estimateServices'),
    name: v.optional(v.string()),
    rate: v.optional(v.number()),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    // Validate rate and hours if provided (spec 04-workflow-planning-phase.md line 150)
    if (args.rate !== undefined && args.rate <= 0) {
      throw new Error('Service rate must be greater than 0')
    }
    if (args.hours !== undefined && args.hours <= 0) {
      throw new Error('Service hours must be greater than 0')
    }

    // Verify service exists
    const service = await getEstimateServiceFromDb(ctx.db, args.serviceId)
    if (!service) {
      throw new Error(`Estimate service not found: ${args.serviceId}`)
    }

    // Build updates object
    const updates: {
      name?: string
      rate?: number
      hours?: number
      total?: number
    } = {}

    if (args.name !== undefined) {
      updates.name = args.name
    }

    if (args.rate !== undefined) {
      updates.rate = args.rate
    }

    if (args.hours !== undefined) {
      updates.hours = args.hours
    }

    // Recalculate total if rate or hours changed
    const newRate = args.rate ?? service.rate
    const newHours = args.hours ?? service.hours
    if (args.rate !== undefined || args.hours !== undefined) {
      updates.total = newRate * newHours
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await updateEstimateServiceInDb(ctx.db, args.serviceId, updates)

      // Recalculate estimate total and sync deal value
      // Per spec 03-workflow-sales-phase.md line 391: "Deal value always reflects current estimate total"
      const newTotal = await recalculateEstimateTotal(ctx.db, service.estimateId)
      const estimate = await getEstimateFromDb(ctx.db, service.estimateId)
      if (estimate) {
        await updateDeal(ctx.db, estimate.dealId, { value: newTotal })
      }
    }
  },
})

/**
 * Deletes a service line item from an estimate.
 * Used to remove services during estimate refinement.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.serviceId - The service line item ID to delete
 */
export const deleteEstimateService = mutation({
  args: {
    serviceId: v.id('estimateServices'),
  },
  handler: async (ctx, args): Promise<void> => {
    await requirePsaStaffMember(ctx)

    // Verify service exists and get its estimate ID
    const service = await getEstimateServiceFromDb(ctx.db, args.serviceId)
    if (!service) {
      throw new Error(`Estimate service not found: ${args.serviceId}`)
    }

    const { estimateId } = service

    // Get the estimate to sync deal value later
    const estimate = await getEstimateFromDb(ctx.db, estimateId)
    if (!estimate) {
      throw new Error(`Estimate not found: ${estimateId}`)
    }

    // Delete the service
    await deleteEstimateServiceFromDb(ctx.db, args.serviceId)

    // Recalculate estimate total and sync deal value
    // Per spec 03-workflow-sales-phase.md line 391: "Deal value always reflects current estimate total"
    const newTotal = await recalculateEstimateTotal(ctx.db, estimateId)
    await updateDeal(ctx.db, estimate.dealId, { value: newTotal })
  },
})
