import type { ExtractedTask, RegularTask } from '../types/input.js'
import type { GeneratedFile } from '../types/output.js'
import { toCamelCase, getWorkItemExportName } from '../core/naming.js'

/**
 * Generate a work item file for a regular task
 */
export function generateWorkItemFile(task: RegularTask): GeneratedFile {
  const taskName = toCamelCase(task.name)
  const workItemExport = getWorkItemExportName(task.name)
  const workItemName = task.workItem?.name || task.name

  const description = task.description
    ? `/**\n * ${task.description}\n */\n`
    : ''

  const content = `import { Builder } from '../../../tasquencer'

${description}export const ${workItemExport} = Builder.workItem('${workItemName}')

export const ${taskName}Task = Builder.task(${workItemExport})
`

  return {
    relativePath: `workItems/${task.name}.workItem.ts`,
    content,
  }
}

/**
 * Generate work item files for all regular tasks in a workflow
 */
export function generateWorkItemFiles(tasks: ExtractedTask[]): GeneratedFile[] {
  const regularTasks = tasks.filter((t): t is RegularTask => t.type === 'task')
  return regularTasks.map(generateWorkItemFile)
}
