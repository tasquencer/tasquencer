import { query } from '../_generated/server'
import { components } from '../_generated/api'
import { v } from 'convex/values'
import { assertUserHasScope } from '../authorization'

export const getRootSpans = query({
  args: {
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(components.tasquencerAudit.api.getRootSpans, args)
  },
})

export const getChildSpans = query({
  args: {
    traceId: v.string(),
    parentSpanId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAudit.api.getChildSpans,
      args,
    )
  },
})

export const getKeyEvents = query({
  args: {
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(components.tasquencerAudit.api.getKeyEvents, args)
  },
})

export const getWorkflowStateAtTime = query({
  args: {
    traceId: v.string(),
    workflowId: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAudit.api.getWorkflowStateAtTime,
      args,
    )
  },
})

export const getChildWorkflowInstances = query({
  args: {
    traceId: v.string(),
    taskName: v.string(),
    timestamp: v.number(),
    workflowName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAudit.api.getChildWorkflowInstances,
      args,
    )
  },
})

export const listRecentTraces = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(
      components.tasquencerAudit.api.listRecentTraces,
      args,
    )
  },
})

export const getTrace = query({
  args: {
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    await assertUserHasScope(ctx, 'system:admin')
    return await ctx.runQuery(components.tasquencerAudit.api.getTrace, args)
  },
})
