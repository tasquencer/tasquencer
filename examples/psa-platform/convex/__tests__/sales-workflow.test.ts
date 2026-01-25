/// <reference types="vite/client" />
/**
 * Sales Phase Workflow Integration Tests
 *
 * These tests verify the deal-to-delivery workflow execution through the sales phase.
 * Tests follow the contract defined in specs/03-workflow-sales-phase.md.
 *
 * Reference: .review/recipes/psa-platform/specs/03-workflow-sales-phase.md
 */

import { it, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  setup,
  setupUserWithRole,
  getTaskWorkItems,
  assertWorkflowState,
  assertTaskState,
  getDealByWorkflowId,
  type TestContext,
} from './helpers.test'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

// Store the test context at module level so we can access it in helpers
let testContext: TestContext
let authResult: Awaited<ReturnType<typeof setupUserWithRole>>

// All scopes needed for sales workflow tests
const SALES_SCOPES = [
  'dealToDelivery:deals:create',
  'dealToDelivery:deals:qualify',
  'dealToDelivery:deals:estimate',
  'dealToDelivery:deals:disqualify',
]

beforeEach(async () => {
  vi.useFakeTimers()
  testContext = setup()

  // Set up authenticated user with organization and required scopes
  authResult = await setupUserWithRole(testContext, 'sales-rep', SALES_SCOPES)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Wait for async workflow operations to complete.
 * Composite tasks (sub-workflows) need multiple rounds of scheduler processing.
 */
async function flushWorkflow(t: TestContext, rounds = 5) {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    await t.finishInProgressScheduledFunctions()
  }
}

/**
 * Helper to create test entities required for deal creation
 */
async function createTestEntities(t: TestContext, orgId: Id<'organizations'>) {
  return await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      organizationId: orgId,
      name: 'Test Company Inc',
      billingAddress: {
        street: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94102',
        country: 'USA',
      },
      paymentTerms: 30,
    })

    const contactId = await ctx.db.insert('contacts', {
      organizationId: orgId,
      companyId,
      name: 'John Doe',
      email: 'john@test.com',
      phone: '+1-555-0123',
      isPrimary: true,
    })

    return { companyId, contactId }
  })
}

/**
 * Helper to get the salesPhase workflow ID
 */
async function getSalesPhaseWorkflowId(
  t: TestContext,
  rootWorkflowId: Id<'tasquencerWorkflows'>
): Promise<Id<'tasquencerWorkflows'>> {
  const salesWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    { workflowId: rootWorkflowId, taskName: 'sales' }
  )
  if (salesWorkflows.length === 0) {
    throw new Error('Sales phase workflow not found')
  }
  return salesWorkflows[0]._id
}

/**
 * Helper to initialize and start the root workflow, returning the sales workflow ID
 */
async function initializeRootAndGetSalesWorkflow(t: TestContext) {
  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      payload: {
        dealName: 'Test Deal',
        clientName: 'Test Company',
        estimatedValue: 100000,
      },
    }
  )
  await flushWorkflow(t, 10)
  const salesWorkflowId = await getSalesPhaseWorkflowId(t, workflowId)
  return { rootWorkflowId: workflowId, salesWorkflowId }
}

describe('Deal-to-Delivery Workflow Initialization', () => {
  it('initializes workflow and creates sales phase composite task', async () => {
    // Initialize the root workflow
    const workflowId = await testContext.mutation(
      internal.testing.tasquencer.initializeRootWorkflow,
      {
        payload: {
          dealName: 'Test Deal',
          clientName: 'Test Company',
          estimatedValue: 100000,
        },
      }
    )

    expect(workflowId).toBeDefined()

    // Wait for workflow initialization to complete (multiple rounds for composite tasks)
    await flushWorkflow(testContext, 10)

    // Verify the root workflow is in initialized state
    // (Workflows transition to 'started' when a work item is started, not on initialization)
    await assertWorkflowState(testContext, workflowId, 'initialized')

    // Verify the sales composite task is enabled (child workflow was created)
    await assertTaskState(testContext, workflowId, 'sales', 'enabled')
  })

  it('creates salesPhase sub-workflow with createDeal task enabled', async () => {
    // Initialize the root workflow
    const workflowId = await testContext.mutation(
      internal.testing.tasquencer.initializeRootWorkflow,
      {
        payload: {
          dealName: 'Test Deal',
          clientName: 'Test Company',
          estimatedValue: 100000,
        },
      }
    )

    await flushWorkflow(testContext, 10)

    // Get the sales composite task's child workflow
    const salesWorkflows = await testContext.query(
      internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
      { workflowId, taskName: 'sales' }
    )

    expect(salesWorkflows.length).toBe(1)
    const salesWorkflowId = salesWorkflows[0]._id

    // Verify the salesPhase child workflow is in initialized state
    const salesWorkflow = await testContext.query(
      internal.testing.tasquencer.getWorkflowById,
      { workflowId: salesWorkflowId }
    )
    expect(salesWorkflow.state).toBe('initialized')

    // Verify createDeal task is enabled in the salesPhase workflow
    await assertTaskState(testContext, salesWorkflowId, 'createDeal', 'enabled')

    // Work items are not auto-created. They require explicit initializeWorkItem call.
    // This is the correct behavior - the UI will call initializeWorkItem when needed.
    const workItems = await getTaskWorkItems(
      testContext,
      salesWorkflowId,
      'createDeal'
    )
    expect(workItems.length).toBe(0)
  })
})

describe('CreateDeal Work Item Lifecycle', () => {
  it('initializes createDeal work item', async () => {
    const { salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)

    // Initialize the work item
    const workItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    // Verify work item was created
    const workItems = await getTaskWorkItems(testContext, salesWorkflowId, 'createDeal')
    expect(workItems.length).toBe(1)
    expect(workItems[0].state).toBe('initialized')
    expect(workItems[0]._id).toBe(workItemId)
  })

  it('starts createDeal work item', async () => {
    const { salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)

    // Initialize the work item
    const workItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    // Start the work item
    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    // Verify work item is started
    const workItems = await getTaskWorkItems(testContext, salesWorkflowId, 'createDeal')
    expect(workItems.length).toBe(1)
    expect(workItems[0].state).toBe('started')
  })

  it('completes createDeal work item and creates deal in Lead stage', async () => {
    const { rootWorkflowId, salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Initialize the work item
    const workItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    // Start the work item
    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    // Complete the work item with deal data
    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Enterprise SaaS Deal',
          value: 50000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 10)

    // Verify deal was created with Lead stage
    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal).not.toBeNull()
    expect(deal?.name).toBe('Enterprise SaaS Deal')
    expect(deal?.stage).toBe('Lead')
    expect(deal?.probability).toBe(10) // Lead stage probability
    expect(deal?.value).toBe(50000)

    // Verify work item is completed
    const workItems = await getTaskWorkItems(testContext, salesWorkflowId, 'createDeal')
    expect(workItems[0].state).toBe('completed')
  })

  it('enables qualifyLead task after createDeal completes', async () => {
    const { salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Initialize, start, and complete createDeal
    const workItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Test Deal',
          value: 25000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    // Verify createDeal task is completed
    await assertTaskState(testContext, salesWorkflowId, 'createDeal', 'completed')

    // Verify qualifyLead task is enabled
    await assertTaskState(testContext, salesWorkflowId, 'qualifyLead', 'enabled')

    // Verify qualifyLead work item was auto-initialized via onEnabled
    const workItems = await getTaskWorkItems(testContext, salesWorkflowId, 'qualifyLead')
    expect(workItems.length).toBe(1)
    expect(workItems[0].state).toBe('initialized')
  })
})

describe('QualifyLead Work Item', () => {
  it('qualifies lead and transitions deal to Qualified stage', async () => {
    const { rootWorkflowId, salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete createDeal
    const createDealWorkItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: createDealWorkItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: createDealWorkItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Qualified Deal',
          value: 75000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    // Get deal ID for qualifyLead
    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(deal).not.toBeNull()

    // Get the auto-initialized qualifyLead work item
    const qualifyWorkItems = await getTaskWorkItems(testContext, salesWorkflowId, 'qualifyLead')
    expect(qualifyWorkItems.length).toBe(1)
    const qualifyWorkItemId = qualifyWorkItems[0]._id

    // Start qualifyLead work item
    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: qualifyWorkItemId,
      args: { name: 'qualifyLead' as const },
    })
    await flushWorkflow(testContext, 5)

    // Complete qualifyLead with qualified=true
    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: qualifyWorkItemId,
      args: {
        name: 'qualifyLead' as const,
        payload: {
          dealId: deal!._id,
          qualified: true,
          qualificationNotes: 'Strong budget, clear timeline, decision maker engaged',
          budget: true,
          authority: true,
          need: true,
          timeline: true,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    // Verify deal stage transitioned to Qualified
    const updatedDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(updatedDeal?.stage).toBe('Qualified')
    expect(updatedDeal?.probability).toBe(25) // Qualified probability

    // Verify qualifyLead task is completed
    await assertTaskState(testContext, salesWorkflowId, 'qualifyLead', 'completed')
  })

  it('disqualifies lead and transitions deal to Disqualified stage', async () => {
    const { rootWorkflowId, salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete createDeal
    const createDealWorkItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: createDealWorkItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: createDealWorkItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Disqualified Deal',
          value: 10000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)

    // Get the auto-initialized qualifyLead work item
    const qualifyWorkItems = await getTaskWorkItems(testContext, salesWorkflowId, 'qualifyLead')
    const qualifyWorkItemId = qualifyWorkItems[0]._id

    // Start and complete qualifyLead with qualified=false
    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: qualifyWorkItemId,
      args: { name: 'qualifyLead' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: qualifyWorkItemId,
      args: {
        name: 'qualifyLead' as const,
        payload: {
          dealId: deal!._id,
          qualified: false,
          qualificationNotes: 'No budget allocated, timeline unclear',
          budget: false,
          authority: true,
          need: false,
          timeline: false,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    // Verify deal stage transitioned to Disqualified
    const updatedDeal = await getDealByWorkflowId(testContext, rootWorkflowId)
    expect(updatedDeal?.stage).toBe('Disqualified')
    expect(updatedDeal?.probability).toBe(0) // Disqualified probability
  })
})

describe('Sales Phase Routing', () => {
  it('routes to createEstimate after qualification', async () => {
    const { rootWorkflowId, salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete createDeal
    const createDealWorkItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: createDealWorkItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: createDealWorkItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Routing Test Deal',
          value: 100000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)

    // Get and complete qualifyLead
    const qualifyWorkItems = await getTaskWorkItems(testContext, salesWorkflowId, 'qualifyLead')
    const qualifyWorkItemId = qualifyWorkItems[0]._id

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: qualifyWorkItemId,
      args: { name: 'qualifyLead' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: qualifyWorkItemId,
      args: {
        name: 'qualifyLead' as const,
        payload: {
          dealId: deal!._id,
          qualified: true,
          qualificationNotes: 'Qualified for estimate',
          budget: true,
          authority: true,
          need: true,
          timeline: true,
        },
      },
    })
    await flushWorkflow(testContext, 20)

    // Verify routing went to createEstimate (not disqualifyLead)
    await assertTaskState(testContext, salesWorkflowId, 'createEstimate', 'enabled')
  })

  it('routes to disqualifyLead when lead is not qualified', async () => {
    const { rootWorkflowId, salesWorkflowId } = await initializeRootAndGetSalesWorkflow(testContext)
    const { companyId, contactId } = await createTestEntities(
      testContext,
      authResult.organizationId as Id<'organizations'>
    )

    // Complete createDeal
    const createDealWorkItemId = await testContext.mutation(
      internal.testing.tasquencer.initializeWorkItem,
      {
        target: {
          // Path navigates workflow network: root -> compositeTask -> childWorkflow -> task -> workItem
          path: ['dealToDelivery', 'sales', 'salesPhase', 'createDeal', 'createDeal'],
          parentWorkflowId: salesWorkflowId,
          parentTaskName: 'createDeal',
        },
        args: { name: 'createDeal' as const, payload: {} },
      }
    )
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: createDealWorkItemId,
      args: { name: 'createDeal' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: createDealWorkItemId,
      args: {
        name: 'createDeal' as const,
        payload: {
          organizationId: authResult.organizationId as Id<'organizations'>,
          companyId,
          contactId,
          name: 'Disqualify Routing Deal',
          value: 5000,
          ownerId: authResult.userId as Id<'users'>,
        },
      },
    })
    await flushWorkflow(testContext, 15)

    const deal = await getDealByWorkflowId(testContext, rootWorkflowId)

    // Get and complete qualifyLead with qualified=false
    const qualifyWorkItems = await getTaskWorkItems(testContext, salesWorkflowId, 'qualifyLead')
    const qualifyWorkItemId = qualifyWorkItems[0]._id

    await testContext.mutation(internal.testing.tasquencer.startWorkItem, {
      workItemId: qualifyWorkItemId,
      args: { name: 'qualifyLead' as const },
    })
    await flushWorkflow(testContext, 5)

    await testContext.mutation(internal.testing.tasquencer.completeWorkItem, {
      workItemId: qualifyWorkItemId,
      args: {
        name: 'qualifyLead' as const,
        payload: {
          dealId: deal!._id,
          qualified: false,
          qualificationNotes: 'No budget',
        },
      },
    })
    await flushWorkflow(testContext, 20)

    // Verify routing went to disqualifyLead
    await assertTaskState(testContext, salesWorkflowId, 'disqualifyLead', 'enabled')
  })
})
