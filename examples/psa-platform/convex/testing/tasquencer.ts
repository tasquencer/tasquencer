/**
 * Internal Workflow Testing Utilities
 *
 * This file provides internal testing APIs for workflow testing in the PSA platform.
 * It re-exports the internal workflow mutations from the dealToDelivery API and
 * provides additional query utilities for test assertions.
 *
 * Usage:
 * - Use the internal mutations to drive workflow execution in tests
 * - Use the queries to assert workflow state
 */

import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { isHumanClaim, isHumanOffer } from '@repo/tasquencer'
import {
  getDealByWorkflowId as getDealByWorkflowIdDomain,
  getProjectByWorkflowId as getProjectByWorkflowIdDomain,
  getProject,
  listWorkItemsWithMetadataByDeal,
} from '../workflows/dealToDelivery/db'

// =============================================================================
// Re-export Internal Workflow Mutations for Testing
// =============================================================================

export {
  internalInitializeRootWorkflow as initializeRootWorkflow,
  internalInitializeWorkItem as initializeWorkItem,
  internalStartWorkItem as startWorkItem,
  internalCompleteWorkItem as completeWorkItem,
  internalFailWorkItem as failWorkItem,
  internalCancelWorkItem as cancelWorkItem,
} from '../workflows/dealToDelivery/api/workflow'

// =============================================================================
// Workflow Queries
// =============================================================================

export const getWorkflowById = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
  },
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${args.workflowId} not found`)
    }
    return workflow
  },
})

export const getWorkflowTasks = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tasquencerTasks')
      .withIndex('by_workflow_id_and_state', (q) =>
        q.eq('workflowId', args.workflowId)
      )
      .collect()
  },
})

export const getWorkflowTasksByState = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
    state: v.union(
      v.literal('disabled'),
      v.literal('enabled'),
      v.literal('started'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('canceled')
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tasquencerTasks')
      .withIndex('by_workflow_id_and_state', (q) =>
        q.eq('workflowId', args.workflowId).eq('state', args.state)
      )
      .collect()
  },
})

export const getWorkflowConditions = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tasquencerConditions')
      .withIndex('by_workflow_id_and_name', (q) =>
        q.eq('workflowId', args.workflowId)
      )
      .collect()
  },
})

export const getWorkflowTaskWorkItems = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query('tasquencerTasks')
      .withIndex('by_workflow_id_name_and_generation', (q) =>
        q.eq('workflowId', args.workflowId).eq('name', args.taskName)
      )
      .order('desc')
      .first()

    if (!task) {
      throw new Error(
        `Task ${args.taskName} not found in workflow ${args.workflowId}`
      )
    }

    return await ctx.db
      .query('tasquencerWorkItems')
      .withIndex(
        'by_parent_workflow_id_task_name_task_generation_and_state',
        (q) =>
          q
            .eq('parent.workflowId', args.workflowId)
            .eq('parent.taskName', args.taskName)
            .eq('parent.taskGeneration', task.generation)
      )
      .collect()
  },
})

export const getWorkflowCompositeTaskWorkflows = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query('tasquencerTasks')
      .withIndex('by_workflow_id_name_and_generation', (q) =>
        q.eq('workflowId', args.workflowId).eq('name', args.taskName)
      )
      .order('desc')
      .first()

    if (!task) {
      throw new Error(
        `Task ${args.taskName} not found in workflow ${args.workflowId}`
      )
    }

    return await ctx.db
      .query('tasquencerWorkflows')
      .withIndex(
        'by_parent_workflow_id_task_name_task_generation_state_and_name',
        (q) =>
          q
            .eq('parent.workflowId', args.workflowId)
            .eq('parent.taskName', args.taskName)
            .eq('parent.taskGeneration', task.generation)
      )
      .collect()
  },
})

// =============================================================================
// Work Item Queries
// =============================================================================

export const getWorkItemById = internalQuery({
  args: {
    workItemId: v.id('tasquencerWorkItems'),
  },
  handler: async (ctx, args) => {
    const workItem = await ctx.db.get(args.workItemId)
    if (!workItem) {
      throw new Error(`Work item ${args.workItemId} not found`)
    }
    return workItem
  },
})

export const getWorkItemsByState = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
    state: v.union(
      v.literal('initialized'),
      v.literal('started'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('canceled')
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('tasquencerWorkItems')
      .withIndex(
        'by_parent_workflow_id_task_name_task_generation_and_state',
        (q) => q.eq('parent.workflowId', args.workflowId)
      )
      .filter((q) => q.eq(q.field('state'), args.state))
      .collect()
  },
})

export const getWorkItemsByProject = internalQuery({
  args: {
    projectId: v.id('projects'),
  },
  handler: async (ctx, args) => {
    const project = await getProject(ctx.db, args.projectId)
    if (!project?.dealId) {
      return []
    }

    const items = await listWorkItemsWithMetadataByDeal(ctx.db, project.dealId)

    return items
      .sort((a, b) => b.metadata._creationTime - a.metadata._creationTime)
      .map(({ metadata, workItem }) => ({
        metadataId: metadata._id,
        workItemId: metadata.workItemId,
        taskType: (metadata.payload as { type?: string }).type ?? workItem?.name,
        taskName:
          (metadata.payload as { taskName?: string }).taskName ?? workItem?.name,
        workItemState: workItem?.state ?? 'missing',
        parent: workItem?.parent,
        isHuman: isHumanOffer(metadata.offer),
        isClaimed: isHumanClaim(metadata.claim),
        offer: metadata.offer,
        claim: metadata.claim,
        createdAt: metadata._creationTime,
      }))
  },
})

// =============================================================================
// Aggregate/Domain Queries for Tests
// =============================================================================

export const getDealByWorkflowId = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
  },
  handler: async (ctx, args) => {
    // Delegate to domain function per TENET-DOMAIN-BOUNDARY
    return await getDealByWorkflowIdDomain(ctx.db, args.workflowId)
  },
})

export const getProjectByWorkflowId = internalQuery({
  args: {
    workflowId: v.id('tasquencerWorkflows'),
  },
  handler: async (ctx, args) => {
    // Delegate to domain function per TENET-DOMAIN-BOUNDARY
    return await getProjectByWorkflowIdDomain(ctx.db, args.workflowId)
  },
})
