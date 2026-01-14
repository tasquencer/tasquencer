import { z } from 'zod'

// =============================================================================
// Extracted Workflow Schema (matches designer output)
// =============================================================================

export const extractedConditionSchema = z.object({
  name: z.string(),
  isStartCondition: z.boolean(),
  isEndCondition: z.boolean(),
  isImplicitCondition: z.boolean(),
})

export const extractedFlowSchema = z.object({
  type: z.enum(['task->condition', 'condition->task', 'task->task']),
  from: z.string(),
  to: z.string(),
})

export const cancellationRegionSchema = z.object({
  owner: z.string(),
  tasks: z.array(z.string()),
  conditions: z.array(z.string()),
})

export const workItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
})

const baseTaskSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  joinType: z.enum(['and', 'xor', 'or']),
  splitType: z.enum(['and', 'xor', 'or']),
})

export const regularTaskSchema = baseTaskSchema.extend({
  type: z.literal('task'),
  workItem: workItemSchema.optional(),
})

export const dummyTaskSchema = baseTaskSchema.extend({
  type: z.literal('dummyTask'),
})

export const compositeTaskSchema = baseTaskSchema.extend({
  type: z.literal('compositeTask'),
  subWorkflowName: z.string(),
})

export const dynamicCompositeTaskSchema = baseTaskSchema.extend({
  type: z.literal('dynamicCompositeTask'),
  workflowTypes: z.array(z.string()),
  selectionLogic: z.string().optional(),
})

export const extractedTaskSchema = z.discriminatedUnion('type', [
  regularTaskSchema,
  dummyTaskSchema,
  compositeTaskSchema,
  dynamicCompositeTaskSchema,
])

export const extractedWorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tasks: z.array(extractedTaskSchema),
  conditions: z.array(extractedConditionSchema),
  flows: z.array(extractedFlowSchema),
  cancellationRegions: z.array(cancellationRegionSchema),
})

// =============================================================================
// Auth Scopes Schema
// =============================================================================

export const authScopeSchema = z.object({
  name: z.string(),
  description: z.string(),
})

// =============================================================================
// Scaffolder Input Schema
// =============================================================================

export const scaffolderInputSchema = z.object({
  mainWorkflow: extractedWorkflowSchema,
  subWorkflows: z.array(extractedWorkflowSchema).optional(),
  scopes: z.array(authScopeSchema),
})

// =============================================================================
// Type Exports
// =============================================================================

export type ExtractedCondition = z.infer<typeof extractedConditionSchema>
export type ExtractedFlow = z.infer<typeof extractedFlowSchema>
export type CancellationRegion = z.infer<typeof cancellationRegionSchema>
export type WorkItem = z.infer<typeof workItemSchema>
export type ExtractedTask = z.infer<typeof extractedTaskSchema>
export type RegularTask = z.infer<typeof regularTaskSchema>
export type DummyTask = z.infer<typeof dummyTaskSchema>
export type CompositeTask = z.infer<typeof compositeTaskSchema>
export type DynamicCompositeTask = z.infer<typeof dynamicCompositeTaskSchema>
export type ExtractedWorkflow = z.infer<typeof extractedWorkflowSchema>
export type AuthScope = z.infer<typeof authScopeSchema>
export type ScaffolderInput = z.infer<typeof scaffolderInputSchema>
