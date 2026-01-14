import type { NamingConventions } from '../types/output.js'

/**
 * Convert a string to camelCase
 * Handles: kebab-case, PascalCase, snake_case
 */
export function toCamelCase(str: string): string {
  const trimmed = str.trim()
  if (!trimmed) {
    return 'unnamed'
  }

  const normalized = trimmed
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

  if (!normalized) {
    return 'unnamed'
  }

  const camel = normalized
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toLowerCase())

  if (!/^[A-Za-z_]/.test(camel)) {
    return `n${camel}`
  }

  return camel
}

/**
 * Convert a string to PascalCase
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Convert a string to Title Case with spaces
 * "userProfile" -> "User Profile"
 * "lead-management" -> "Lead Management"
 */
export function toTitleCase(str: string): string {
  const camel = toCamelCase(str)
  return camel
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
    .trim()
}

/**
 * Generate all naming conventions from the raw input
 */
export function generateNames(input: string): NamingConventions {
  const workflowName = toCamelCase(input)

  return {
    raw: input,
    directoryName: workflowName,
    workflowName,
    scopeModuleName: `${workflowName}ScopeModule`,
    versionManagerName: `${workflowName}VersionManager`,
    workflowExportName: `${workflowName}Workflow`,
    tablesName: `${workflowName}Tables`,
    displayName: toTitleCase(input),
  }
}

/**
 * Generate work item export name from task name
 */
export function getWorkItemExportName(taskName: string): string {
  return `${toCamelCase(taskName)}WorkItem`
}

/**
 * Generate task variable name from task name
 */
export function getTaskVariableName(taskName: string): string {
  return `${toCamelCase(taskName)}Task`
}

/**
 * Generate actions variable name from task name
 */
export function getActionsVariableName(taskName: string): string {
  return `${toCamelCase(taskName)}Actions`
}

/**
 * Generate task export name from task name (what workflow imports)
 */
export function getTaskExportName(taskName: string): string {
  return `${toCamelCase(taskName)}Task`
}
