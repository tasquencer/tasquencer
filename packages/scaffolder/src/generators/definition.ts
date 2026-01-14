import type { ExtractedWorkflow } from '../types/input.js'
import type { GeneratedFile, NamingConventions } from '../types/output.js'
import { toCamelCase } from '../core/naming.js'

/**
 * Generate the definition.ts file with version manager
 */
export function generateDefinitionFile(
  mainWorkflow: ExtractedWorkflow,
  names: NamingConventions
): GeneratedFile {
  const { workflowName, versionManagerName } = names
  const mainWorkflowExport = `${toCamelCase(mainWorkflow.name)}Workflow`

  const content = `import { versionManagerFor } from '../../tasquencer'
import { ${mainWorkflowExport} } from './workflows/${mainWorkflow.name}.workflow'

export const ${versionManagerName} = versionManagerFor('${workflowName}')
  .registerVersion('v1', ${mainWorkflowExport})
  .build()

// Export API for version v1
export const {
  initializeRootWorkflow,
  initializeWorkItem,
  startWorkItem,
  completeWorkItem,
  failWorkItem,
  cancelWorkItem,
  helpers: { getWorkflowTaskStates },
} = ${versionManagerName}.apiForVersion('v1')
`

  return {
    relativePath: 'definition.ts',
    content,
  }
}
