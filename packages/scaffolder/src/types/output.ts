/**
 * Naming conventions generated from the workflow name
 */
export interface NamingConventions {
  /** Original input (e.g., "user-profile" or "userProfile") */
  raw: string

  /** Directory name in camelCase (e.g., "userProfile") */
  directoryName: string

  /** Workflow name in camelCase (e.g., "userProfile") */
  workflowName: string

  /** Scope module export name (e.g., "userProfileScopeModule") */
  scopeModuleName: string

  /** Version manager export name (e.g., "userProfileVersionManager") */
  versionManagerName: string

  /** Workflow export name (e.g., "userProfileWorkflow") */
  workflowExportName: string

  /** Schema tables import name (e.g., "userProfileTables") */
  tablesName: string

  /** Display name in Title Case (e.g., "User Profile") */
  displayName: string
}

/**
 * A generated file with its path and content
 */
export interface GeneratedFile {
  /** Relative path from output directory */
  relativePath: string

  /** File content */
  content: string
}

/**
 * A file modification with its path and new content
 */
export interface FileModification {
  /** Absolute path to the file */
  filePath: string

  /** New file content after modification */
  content: string

  /** Description of what was modified */
  description: string
}

/**
 * Result of the scaffolding operation
 */
export interface ScaffoldResult {
  /** Files that were created */
  createdFiles: GeneratedFile[]

  /** Files that were modified */
  modifiedFiles: FileModification[]

  /** Any warnings during generation */
  warnings: string[]

  /** Errors that prevented generation (empty if successful) */
  errors: string[]
}

/**
 * Configuration for the scaffolder
 */
export interface ScaffolderConfig {
  /** Output directory for generated files (e.g., "./convex") */
  outputDir: string

  /** If true, don't actually write files */
  dryRun?: boolean

  /** Path to workflows directory relative to outputDir */
  workflowsDir?: string

  /** Path to app authorization file relative to outputDir */
  appAuthorizationPath?: string

  /** Path to metadata file relative to outputDir */
  metadataPath?: string

  /** Path to schema file relative to outputDir */
  schemaPath?: string
}
