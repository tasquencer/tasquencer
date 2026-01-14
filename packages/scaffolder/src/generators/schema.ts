import type { GeneratedFile, NamingConventions } from '../types/output.js'

/**
 * Generate the schema.ts placeholder file
 */
export function generateSchemaFile(names: NamingConventions): GeneratedFile {
  const { displayName, workflowName } = names

  const content = `// ${displayName} Workflow Schema
// ================================
// This file defines the database tables for the ${displayName} workflow.
// Implement your domain tables and work item metadata table here.

// Example domain table:
// import { defineTable } from 'convex/server'
// import { v } from 'convex/values'
//
// const ${workflowName}Records = defineTable({
//   workflowId: v.id('tasquencerWorkflows'),
//   // Add your domain fields here
//   createdAt: v.number(),
// }).index('by_workflow_id', ['workflowId'])

// Example work item metadata table:
// import { defineWorkItemMetadataTable } from '../../tasquencer/workItemMetadata'
//
// const ${workflowName}WorkItems = defineWorkItemMetadataTable('${workflowName}Records')
//   .withPayload(
//     v.object({
//       type: v.union(v.literal('task1'), v.literal('task2')),
//       taskName: v.string(),
//     })
//   )

// Export tables as default for schema spread
export default {
  // ${workflowName}Records,
  // ${workflowName}WorkItems,
}
`

  return {
    relativePath: 'schema.ts',
    content,
  }
}
