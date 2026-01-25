/**
 * Companies API
 *
 * Query and mutation endpoints for companies and contacts.
 *
 * TENET-AUTHZ: All endpoints are protected by scope-based authorization.
 * TENET-DOMAIN-BOUNDARY: All data access goes through domain functions (db.ts).
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { v } from 'convex/values'
import { mutation, query } from '../../../_generated/server'
import { requirePsaStaffMember } from '../domain/services/authorizationService'
import {
  getCompany as getCompanyFromDb,
  insertCompany,
  updateCompany as updateCompanyInDb,
  listCompaniesByOrganization,
  insertContact,
  getContact as getContactFromDb,
  updateContact as updateContactInDb,
  listContactsByCompany,
  listContactsByOrganization,
} from '../db'
import { getUser } from '../db/users'
import { EntityNotFoundError } from '@repo/tasquencer'

/**
 * Lists companies for the current user's organization.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @returns Array of companies (limited to 50)
 */
export const listCompanies = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const user = await getUser(ctx.db, userId)
    if (!user) {
      return []
    }

    // Use domain function for data access
    return await listCompaniesByOrganization(ctx.db, user.organizationId)
  },
})

/**
 * Gets a company by ID with its contacts.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.companyId - The company ID
 * @returns The company document with contacts, or null if not found
 */
export const getCompany = query({
  args: { companyId: v.id('companies') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Use Promise.all for parallel loading of company and contacts
    const [company, contacts] = await Promise.all([
      getCompanyFromDb(ctx.db, args.companyId),
      listContactsByCompany(ctx.db, args.companyId),
    ])

    if (!company) {
      return null
    }

    return {
      ...company,
      contacts,
    }
  },
})

/**
 * Lists contacts, optionally filtered by company.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.companyId - Optional company ID to filter by
 * @returns Array of contacts
 */
export const listContacts = query({
  args: { companyId: v.optional(v.id('companies')) },
  handler: async (ctx, args) => {
    const userId = await requirePsaStaffMember(ctx)

    // If companyId provided, filter by company
    if (args.companyId) {
      return await listContactsByCompany(ctx.db, args.companyId)
    }

    // Otherwise, list all contacts for the user's organization
    const user = await getUser(ctx.db, userId)
    if (!user) {
      return []
    }

    return await listContactsByOrganization(ctx.db, user.organizationId)
  },
})

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Creates a new company for the current user's organization.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.name - Company name
 * @param args.billingAddress - Company billing address
 * @param args.paymentTerms - Payment terms in days (default 30)
 * @returns The created company ID
 */
export const createCompany = mutation({
  args: {
    name: v.string(),
    billingAddress: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      postalCode: v.string(),
      country: v.string(),
    }),
    paymentTerms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePsaStaffMember(ctx)

    // Get current user to determine their organization
    const user = await getUser(ctx.db, userId)
    if (!user) {
      throw new EntityNotFoundError('User', { userId })
    }

    // Create company using domain function
    const companyId = await insertCompany(ctx.db, {
      organizationId: user.organizationId,
      name: args.name,
      billingAddress: args.billingAddress,
      paymentTerms: args.paymentTerms ?? 30,
    })

    return companyId
  },
})

/**
 * Updates an existing company.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.companyId - The company ID to update
 * @param args.name - Updated company name
 * @param args.billingAddress - Updated billing address
 * @param args.paymentTerms - Updated payment terms
 */
export const updateCompany = mutation({
  args: {
    companyId: v.id('companies'),
    name: v.optional(v.string()),
    billingAddress: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        postalCode: v.string(),
        country: v.string(),
      })
    ),
    paymentTerms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify company exists
    const company = await getCompanyFromDb(ctx.db, args.companyId)
    if (!company) {
      throw new EntityNotFoundError('Company', { companyId: args.companyId })
    }

    // Build updates object with only provided fields
    const updates: Parameters<typeof updateCompanyInDb>[2] = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.billingAddress !== undefined) updates.billingAddress = args.billingAddress
    if (args.paymentTerms !== undefined) updates.paymentTerms = args.paymentTerms

    // Update using domain function
    await updateCompanyInDb(ctx.db, args.companyId, updates)

    return { success: true }
  },
})

/**
 * Creates a new contact for a company.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.companyId - The company to add the contact to
 * @param args.name - Contact name
 * @param args.email - Contact email
 * @param args.phone - Contact phone number
 * @param args.isPrimary - Whether this is the primary contact
 * @returns The created contact ID
 */
export const createContact = mutation({
  args: {
    companyId: v.id('companies'),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePsaStaffMember(ctx)

    // Verify company exists and get organization
    const company = await getCompanyFromDb(ctx.db, args.companyId)
    if (!company) {
      throw new EntityNotFoundError('Company', { companyId: args.companyId })
    }

    // Get user to verify organization access
    const user = await getUser(ctx.db, userId)
    if (!user || user.organizationId !== company.organizationId) {
      throw new EntityNotFoundError('Company', { companyId: args.companyId })
    }

    // Create contact using domain function
    const contactId = await insertContact(ctx.db, {
      companyId: args.companyId,
      organizationId: company.organizationId,
      name: args.name,
      email: args.email,
      phone: args.phone,
      isPrimary: args.isPrimary ?? false,
    })

    return contactId
  },
})

/**
 * Updates an existing contact.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.contactId - The contact ID to update
 * @param args.name - Updated contact name
 * @param args.email - Updated email
 * @param args.phone - Updated phone number
 * @param args.isPrimary - Updated primary status
 */
export const updateContact = mutation({
  args: {
    contactId: v.id('contacts'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)

    // Verify contact exists
    const contact = await getContactFromDb(ctx.db, args.contactId)
    if (!contact) {
      throw new EntityNotFoundError('Contact', { contactId: args.contactId })
    }

    // Build updates object with only provided fields
    const updates: Parameters<typeof updateContactInDb>[2] = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.email !== undefined) updates.email = args.email
    if (args.phone !== undefined) updates.phone = args.phone
    if (args.isPrimary !== undefined) updates.isPrimary = args.isPrimary

    // Update using domain function
    await updateContactInDb(ctx.db, args.contactId, updates)

    return { success: true }
  },
})

/**
 * Gets a contact by ID.
 * Authorization: Requires dealToDelivery:staff scope.
 *
 * @param args.contactId - The contact ID
 * @returns The contact document or null if not found
 */
export const getContact = query({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, args) => {
    await requirePsaStaffMember(ctx)
    return await getContactFromDb(ctx.db, args.contactId)
  },
})
