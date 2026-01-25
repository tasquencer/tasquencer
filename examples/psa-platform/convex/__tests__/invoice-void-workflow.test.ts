/// <reference types="vite/client" />
/**
 * Invoice Void Workflow Integration Tests
 *
 * These tests verify the standalone invoiceVoid workflow that handles voiding invoices
 * outside of the normal deal-to-delivery billing flow.
 *
 * Per TENET-WF-EXEC, invoice voiding transitions should be work item-driven for proper
 * audit trails through the Tasquencer workflow system.
 *
 * The invoiceVoid workflow:
 * - start → voidInvoice → end
 *
 * Can void invoices in: Finalized, Sent, Viewed status
 * Cannot void: Draft (should be deleted), Paid (needs reversal first)
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import { setup, setupUserWithRole, type TestContext } from './helpers.test'
import { internal } from '../_generated/api'
import type { Id, Doc } from '../_generated/dataModel'

let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// Scopes needed for invoice void workflow
const INVOICE_VOID_SCOPES = ['dealToDelivery:invoices:void', 'dealToDelivery:invoices:view:all']

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()
  authResult = await setupUserWithRole(testContext, 'finance-manager', INVOICE_VOID_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Wait for async workflow operations to complete.
 */
async function flushWorkflow(t: TestContext, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    await t.finishInProgressScheduledFunctions()
  }
}

/**
 * Create test entities for invoice creation
 */
async function createTestEntities(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Invoice Void Test Company',
      billingAddress: {
        street: '123 Void Street',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    // Create a manager user for the project
    const managerId = await ctx.db.insert('users', {
      organizationId: orgId,
      email: 'manager@voidtest.com',
      name: 'Void Test Manager',
      role: 'project_manager',
      costRate: 10000,
      billRate: 15000,
      skills: [],
      department: 'Engineering',
      location: 'Remote',
      isActive: true,
    })

    // Create a project for invoice linking
    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      companyId,
      name: 'Void Test Project',
      status: 'Active',
      createdAt: Date.now(),
      startDate: Date.now(),
      managerId,
    })

    return { companyId, projectId }
  })
}

/**
 * Create an invoice with the specified status
 */
async function createInvoice(
  t: TestContext,
  orgId: Id<'organizations'>,
  projectId: Id<'projects'>,
  companyId: Id<'companies'>,
  status: Doc<'invoices'>['status'],
  options?: { number?: string; sentAt?: number; paidAt?: number; viewedAt?: number }
): Promise<Id<'invoices'>> {
  return await t.run(async (ctx) => {
    const invoiceData: Omit<Doc<'invoices'>, '_id' | '_creationTime'> = {
      organizationId: orgId,
      projectId,
      companyId,
      status,
      method: 'TimeAndMaterials',
      subtotal: 100000, // $1000
      tax: 0,
      total: 100000,
      dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    }

    if (options?.number) {
      invoiceData.number = options.number
    }
    if (status === 'Finalized' || status === 'Sent' || status === 'Viewed') {
      invoiceData.finalizedAt = Date.now()
      invoiceData.number = options?.number ?? 'INV-2026-00001'
    }
    if (options?.sentAt || status === 'Sent' || status === 'Viewed') {
      invoiceData.sentAt = options?.sentAt ?? Date.now()
    }
    if (options?.viewedAt || status === 'Viewed') {
      invoiceData.viewedAt = options?.viewedAt ?? Date.now()
    }
    if (status === 'Paid') {
      invoiceData.finalizedAt = Date.now()
      invoiceData.sentAt = Date.now()
      invoiceData.paidAt = options?.paidAt ?? Date.now()
      invoiceData.number = options?.number ?? 'INV-2026-00001'
    }

    // Add a line item so the invoice is valid
    const invoiceId = await ctx.db.insert('invoices', invoiceData)
    await ctx.db.insert('invoiceLineItems', {
      invoiceId,
      description: 'Test Services',
      quantity: 10,
      rate: 10000,
      amount: 100000,
      sortOrder: 1,
    })

    return invoiceId
  })
}

/**
 * Initialize the invoiceVoid workflow
 */
async function initializeInvoiceVoidWorkflow(t: TestContext): Promise<Id<'tasquencerWorkflows'>> {
  const workflowId = await t.mutation(
    internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkflow,
    { payload: {} }
  )
  await flushWorkflow(t, 10)
  return workflowId
}

/**
 * Complete the full invoiceVoid workflow
 */
async function completeInvoiceVoidWorkflow(
  t: TestContext,
  workflowId: Id<'tasquencerWorkflows'>,
  invoiceId: Id<'invoices'>,
  reason?: string
): Promise<void> {
  // Initialize work item
  const workItemId = await t.mutation(
    internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkItem,
    {
      target: {
        path: ['invoiceVoid', 'voidInvoice', 'voidInvoice'],
        parentWorkflowId: workflowId,
        parentTaskName: 'voidInvoice',
      },
      args: { name: 'voidInvoice' as any, payload: { invoiceId } },
    }
  )
  await flushWorkflow(t, 5)

  // Start work item
  await t.mutation(
    internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalStartInvoiceVoidWorkItem,
    {
      workItemId,
      args: { name: 'voidInvoice' as any },
    }
  )
  await flushWorkflow(t, 5)

  // Complete work item
  await t.mutation(
    internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalCompleteInvoiceVoidWorkItem,
    {
      workItemId,
      args: {
        name: 'voidInvoice',
        payload: { invoiceId, reason },
      } as any,
    }
  )
  await flushWorkflow(t, 10)
}

// =============================================================================
// Workflow Initialization Tests
// =============================================================================

describe('Invoice Void Workflow Initialization', () => {
  it('initializes invoiceVoid workflow successfully', async () => {
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)

    expect(workflowId).toBeDefined()

    // Verify workflow is initialized (state becomes 'started' once work items begin)
    const workflow = await testContext.run(async (ctx) => {
      return await ctx.db.get(workflowId)
    })
    expect(workflow).toBeDefined()
    // Workflow state is 'initialized' after init, transitions to 'started' when work item starts
    expect(['initialized', 'started']).toContain(workflow?.state)
  })

  it('enables voidInvoice task after workflow starts', async () => {
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)

    // Check task state
    const tasks = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasquencerTasks')
        .withIndex('by_workflow_id_and_state', (q) => q.eq('workflowId', workflowId))
        .collect()
    })

    const voidInvoiceTask = tasks.find((t) => t.name === 'voidInvoice')
    expect(voidInvoiceTask).toBeDefined()
    expect(voidInvoiceTask?.state).toBe('enabled')
  })
})

// =============================================================================
// Void Invoice Work Item Tests
// =============================================================================

describe('VoidInvoice Work Item - Finalized Invoice', () => {
  it('voids a finalized invoice successfully', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create finalized invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // Verify initial status
    const invoiceBefore = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceBefore?.status).toBe('Finalized')

    // Initialize and complete void workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Client requested cancellation')

    // Verify invoice is now voided
    const invoiceAfter = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceAfter?.status).toBe('Void')
    expect(invoiceAfter?.voidedAt).toBeDefined()
    expect(invoiceAfter?.voidReason).toBe('Client requested cancellation')
  })
})

describe('VoidInvoice Work Item - Sent Invoice', () => {
  it('voids a sent invoice successfully', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create sent invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Sent'
    )

    // Verify initial status
    const invoiceBefore = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceBefore?.status).toBe('Sent')

    // Initialize and complete void workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Billing error')

    // Verify invoice is now voided
    const invoiceAfter = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceAfter?.status).toBe('Void')
    expect(invoiceAfter?.voidReason).toBe('Billing error')
  })
})

describe('VoidInvoice Work Item - Viewed Invoice', () => {
  it('voids a viewed invoice successfully', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create viewed invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Viewed'
    )

    // Verify initial status
    const invoiceBefore = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceBefore?.status).toBe('Viewed')

    // Initialize and complete void workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Duplicate invoice')

    // Verify invoice is now voided
    const invoiceAfter = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoiceAfter?.status).toBe('Void')
    expect(invoiceAfter?.voidReason).toBe('Duplicate invoice')
  })
})

// =============================================================================
// Business Rule Validation Tests
// =============================================================================

describe('VoidInvoice Business Rules', () => {
  it('rejects voiding a Draft invoice (should be deleted instead)', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create draft invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Draft'
    )

    // Try to void via workflow - should fail during complete
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)

    // Initialize work item
    const workItemId = await testContext.mutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkItem,
      {
        target: {
          path: ['invoiceVoid', 'voidInvoice', 'voidInvoice'],
          parentWorkflowId: workflowId,
          parentTaskName: 'voidInvoice',
        },
        args: { name: 'voidInvoice' as any, payload: { invoiceId } },
      }
    )
    await flushWorkflow(testContext, 5)

    // Start work item
    await testContext.mutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalStartInvoiceVoidWorkItem,
      {
        workItemId,
        args: { name: 'voidInvoice' as any },
      }
    )
    await flushWorkflow(testContext, 5)

    // Attempt to complete - should throw
    await expect(
      testContext.mutation(
        internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalCompleteInvoiceVoidWorkItem,
        {
          workItemId,
          args: {
            name: 'voidInvoice',
            payload: { invoiceId },
          } as any,
        }
      )
    ).rejects.toThrow(/Draft invoices should be deleted, not voided/)

    // Invoice should still be Draft
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.status).toBe('Draft')
  })

  it('rejects voiding a Paid invoice (needs reversal first)', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create paid invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Paid'
    )

    // Try to void via workflow - should fail during complete
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)

    // Initialize work item
    const workItemId = await testContext.mutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalInitializeInvoiceVoidWorkItem,
      {
        target: {
          path: ['invoiceVoid', 'voidInvoice', 'voidInvoice'],
          parentWorkflowId: workflowId,
          parentTaskName: 'voidInvoice',
        },
        args: { name: 'voidInvoice' as any, payload: { invoiceId } },
      }
    )
    await flushWorkflow(testContext, 5)

    // Start work item
    await testContext.mutation(
      internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalStartInvoiceVoidWorkItem,
      {
        workItemId,
        args: { name: 'voidInvoice' as any },
      }
    )
    await flushWorkflow(testContext, 5)

    // Attempt to complete - should throw
    await expect(
      testContext.mutation(
        internal.workflows.dealToDelivery.api.invoiceVoidWorkflow.internalCompleteInvoiceVoidWorkItem,
        {
          workItemId,
          args: {
            name: 'voidInvoice',
            payload: { invoiceId },
          } as any,
        }
      )
    ).rejects.toThrow(/Cannot void a paid invoice/)

    // Invoice should still be Paid
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.status).toBe('Paid')
  })

  it('handles idempotent voiding (already voided invoice completes silently)', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create and manually void an invoice
    const invoiceId = await testContext.run(async (ctx) => {
      const invId = await ctx.db.insert('invoices', {
        organizationId: authResult.organizationId as Id<'organizations'>,
        projectId,
        companyId,
        status: 'Void',
        method: 'TimeAndMaterials',
        subtotal: 50000,
        tax: 0,
        total: 50000,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
        finalizedAt: Date.now(),
        number: 'INV-2026-00002',
        voidedAt: Date.now(),
        voidReason: 'Previously voided',
      })
      return invId
    })

    // Void again via workflow - should complete silently
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Second void attempt')

    // Invoice should remain Void with original reason
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.status).toBe('Void')
    expect(invoice?.voidReason).toBe('Previously voided') // Original reason preserved
  })
})

// =============================================================================
// Audit Trail Tests
// =============================================================================

describe('VoidInvoice Audit Trail', () => {
  it('records voidedBy user for voided invoices', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create finalized invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // Void via workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Audit test')

    // Verify voidedBy is recorded
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.voidedBy).toBe(authResult.userId)
  })

  it('records voidedAt timestamp for voided invoices', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create finalized invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    const beforeVoid = Date.now()

    // Void via workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Timestamp test')

    // Verify voidedAt timestamp is recorded and reasonable
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.voidedAt).toBeDefined()
    expect(invoice?.voidedAt).toBeGreaterThanOrEqual(beforeVoid)
  })

  it('workflow completion creates proper Tasquencer audit trail', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create finalized invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // Void via workflow
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, 'Workflow audit test')

    // Verify workflow completed
    const workflow = await testContext.run(async (ctx) => {
      return await ctx.db.get(workflowId)
    })
    expect(workflow?.state).toBe('completed')

    // Verify work item completed
    const workItems = await testContext.run(async (ctx) => {
      return await ctx.db
        .query('tasquencerWorkItems')
        .withIndex('by_parent_workflow_id_task_name_task_generation_and_state', (q) =>
          q.eq('parent.workflowId', workflowId)
        )
        .collect()
    })
    expect(workItems.length).toBeGreaterThan(0)
    expect(workItems[0].state).toBe('completed')
  })
})

// =============================================================================
// Void Without Reason Tests
// =============================================================================

describe('VoidInvoice Without Reason', () => {
  it('allows voiding without providing a reason', async () => {
    const { companyId, projectId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Create finalized invoice
    const invoiceId = await createInvoice(
      testContext,
      authResult.organizationId as Id<'organizations'>,
      projectId,
      companyId,
      'Finalized'
    )

    // Void via workflow without reason
    const workflowId = await initializeInvoiceVoidWorkflow(testContext)
    await completeInvoiceVoidWorkflow(testContext, workflowId, invoiceId, undefined)

    // Verify invoice is voided
    const invoice = await testContext.run(async (ctx) => {
      return await ctx.db.get(invoiceId)
    })
    expect(invoice?.status).toBe('Void')
    expect(invoice?.voidReason).toBeUndefined()
  })
})
