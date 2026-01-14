// Main exports
export { Scaffolder, createScaffolder } from './core/scaffolder.js'

// Type exports
export type {
  ScaffolderInput,
  ExtractedWorkflow,
  ExtractedTask,
  ExtractedCondition,
  ExtractedFlow,
  CancellationRegion,
  AuthScope,
  RegularTask,
  DummyTask,
  CompositeTask,
  DynamicCompositeTask,
  WorkItem,
} from './types/input.js'

export type {
  ScaffolderConfig,
  ScaffoldResult,
  GeneratedFile,
  FileModification,
  NamingConventions,
} from './types/output.js'

// Schema exports for validation
export {
  scaffolderInputSchema,
  extractedWorkflowSchema,
  extractedTaskSchema,
  authScopeSchema,
} from './types/input.js'

// Utility exports
export { generateNames } from './core/naming.js'

// Generator exports (for advanced usage)
export {
  generateWorkflowFile,
  generateWorkItemFile,
  generateWorkItemFiles,
  generateScopesFile,
  generateDefinitionFile,
  generateSchemaFile,
} from './generators/index.js'

// Modifier exports (for advanced usage)
export {
  modifyAppAuthorization,
  modifyMetadata,
  modifySchema,
} from './modifiers/index.js'
