import type { ExtractedWorkflow, ExtractedTask, ExtractedFlow, CancellationRegion } from '../types/input.js'
import type { GeneratedFile } from '../types/output.js'
import { toCamelCase, getTaskVariableName, getTaskExportName } from '../core/naming.js'
import { indent, joinLines } from '../utils/templates.js'

interface WorkflowGeneratorContext {
  workflow: ExtractedWorkflow
  allWorkflows: ExtractedWorkflow[]
}

/**
 * Generate a workflow file from an ExtractedWorkflow
 */
export function generateWorkflowFile(
  workflow: ExtractedWorkflow,
  allWorkflows: ExtractedWorkflow[]
): GeneratedFile {
  const ctx: WorkflowGeneratorContext = { workflow, allWorkflows }

  const imports = generateImports(ctx)
  const taskDefinitions = generateTaskDefinitions(ctx)
  const workflowDefinition = generateWorkflowDefinition(ctx)

  const content = joinLines([imports, '', taskDefinitions, '', workflowDefinition, ''])

  return {
    relativePath: `workflows/${workflow.name}.workflow.ts`,
    content,
  }
}

function generateImports(ctx: WorkflowGeneratorContext): string {
  const { workflow, allWorkflows } = ctx
  const imports: string[] = []

  // Builder import
  imports.push("import { Builder } from '../../../tasquencer'")

  // Task imports for regular tasks (import the task, not the work item)
  const regularTasks = workflow.tasks.filter((t) => t.type === 'task')
  for (const task of regularTasks) {
    const taskExportName = getTaskExportName(task.name)
    imports.push(`import { ${taskExportName} } from '../workItems/${task.name}.workItem'`)
  }

  // Subworkflow imports for composite tasks
  const compositeTasks = workflow.tasks.filter((t) => t.type === 'compositeTask')
  for (const task of compositeTasks) {
    if (task.type === 'compositeTask') {
      const subWorkflowExport = `${toCamelCase(task.subWorkflowName)}Workflow`
      imports.push(`import { ${subWorkflowExport} } from './${task.subWorkflowName}.workflow'`)
    }
  }

  // Subworkflow imports for dynamic composite tasks
  const dynamicTasks = workflow.tasks.filter((t) => t.type === 'dynamicCompositeTask')
  for (const task of dynamicTasks) {
    if (task.type === 'dynamicCompositeTask') {
      for (const subWorkflowName of task.workflowTypes) {
        const subWorkflowExport = `${toCamelCase(subWorkflowName)}Workflow`
        imports.push(`import { ${subWorkflowExport} } from './${subWorkflowName}.workflow'`)
      }
    }
  }

  return imports.join('\n')
}

function generateTaskDefinitions(ctx: WorkflowGeneratorContext): string {
  const { workflow } = ctx
  const definitions: string[] = []

  // Only generate definitions for dummy tasks (regular tasks are imported, composite defined inline)
  for (const task of workflow.tasks) {
    if (task.type === 'dummyTask') {
      definitions.push(generateDummyTaskDefinition(task, getTaskVariableName(task.name)))
    }
  }

  return definitions.join('\n\n')
}

function generateDummyTaskDefinition(
  task: ExtractedTask & { type: 'dummyTask' },
  varName: string
): string {
  const lines: string[] = [`const ${varName} = Builder.dummyTask()`]

  if (task.joinType !== 'and') {
    lines.push(`  .withJoinType('${task.joinType}')`)
  }
  if (task.splitType !== 'and') {
    lines.push(`  .withSplitType('${task.splitType}')`)
  }

  return lines.join('\n')
}

function generateWorkflowDefinition(ctx: WorkflowGeneratorContext): string {
  const { workflow } = ctx
  const exportName = `${toCamelCase(workflow.name)}Workflow`

  const lines: string[] = [`export const ${exportName} = Builder.workflow('${workflow.name}')`]

  // Add conditions (start first, then regular, then end)
  const startCondition = workflow.conditions.find((c) => c.isStartCondition)
  const endCondition = workflow.conditions.find((c) => c.isEndCondition)
  const regularConditions = workflow.conditions.filter(
    (c) => !c.isStartCondition && !c.isEndCondition && !c.isImplicitCondition
  )

  if (startCondition) {
    lines.push(`  .startCondition('${startCondition.name}')`)
  }

  for (const cond of regularConditions) {
    lines.push(`  .condition('${cond.name}')`)
  }

  if (endCondition) {
    lines.push(`  .endCondition('${endCondition.name}')`)
  }

  // Add tasks
  for (const task of workflow.tasks) {
    lines.push(generateTaskRegistration(task, ctx))
  }

  // Add connections
  const connections = generateConnections(ctx)
  lines.push(...connections)

  // Add cancellation regions
  if (workflow.cancellationRegions && workflow.cancellationRegions.length > 0) {
    for (const region of workflow.cancellationRegions) {
      lines.push(generateCancellationRegion(region))
    }
  }

  return lines.join('\n')
}

function generateTaskRegistration(task: ExtractedTask, ctx: WorkflowGeneratorContext): string {
  switch (task.type) {
    case 'task':
      return generateRegularTaskRegistration(task)
    case 'dummyTask':
      return generateDummyTaskRegistration(task)
    case 'compositeTask':
      return generateCompositeTaskRegistration(task)
    case 'dynamicCompositeTask':
      return generateDynamicCompositeTaskRegistration(task)
  }
}

function generateRegularTaskRegistration(task: ExtractedTask & { type: 'task' }): string {
  const taskExport = getTaskExportName(task.name)
  let taskExpr = taskExport

  // Chain join/split types if non-default
  if (task.joinType !== 'and') {
    taskExpr += `.withJoinType('${task.joinType}')`
  }
  if (task.splitType !== 'and') {
    taskExpr += `.withSplitType('${task.splitType}')`
  }

  return `  .task('${task.name}', ${taskExpr})`
}

function generateDummyTaskRegistration(task: ExtractedTask & { type: 'dummyTask' }): string {
  const varName = getTaskVariableName(task.name)
  return `  .dummyTask('${task.name}', ${varName})`
}

function generateCompositeTaskRegistration(task: ExtractedTask & { type: 'compositeTask' }): string {
  const subWorkflowExport = `${toCamelCase(task.subWorkflowName)}Workflow`
  let taskExpr = `Builder.compositeTask(${subWorkflowExport})`

  if (task.joinType !== 'and') {
    taskExpr += `.withJoinType('${task.joinType}')`
  }
  if (task.splitType !== 'and') {
    taskExpr += `.withSplitType('${task.splitType}')`
  }

  return `  .compositeTask('${task.name}', ${taskExpr})`
}

function generateDynamicCompositeTaskRegistration(
  task: ExtractedTask & { type: 'dynamicCompositeTask' }
): string {
  const workflowExports = task.workflowTypes.map(
    (name) => `${toCamelCase(name)}Workflow`
  )
  const workflowArray = `[${workflowExports.join(', ')}]`

  let taskExpr = `Builder.dynamicCompositeTask(${workflowArray})`

  if (task.selectionLogic) {
    const selectionLogic = task.selectionLogic.trim()
    const isFunctionExpression =
      selectionLogic.startsWith('async') ||
      selectionLogic.startsWith('(') ||
      selectionLogic.startsWith('function')

    if (isFunctionExpression) {
      taskExpr += `.withActivities({\n  onEnabled: ${selectionLogic}\n})`
    } else {
      const body = indent(selectionLogic, 4)
      taskExpr += `.withActivities({\n  onEnabled: async ({ workflow, mutationCtx, parent }) => {\n${body}\n  }\n})`
    }
  }

  if (task.joinType !== 'and') {
    taskExpr += `.withJoinType('${task.joinType}')`
  }
  if (task.splitType !== 'and') {
    taskExpr += `.withSplitType('${task.splitType}')`
  }

  return `  .dynamicCompositeTask('${task.name}', ${taskExpr})`
}

function generateConnections(ctx: WorkflowGeneratorContext): string[] {
  const { workflow } = ctx
  const lines: string[] = []

  // Group flows by source
  const flowsBySource = new Map<string, ExtractedFlow[]>()
  for (const flow of workflow.flows) {
    const existing = flowsBySource.get(flow.from) || []
    existing.push(flow)
    flowsBySource.set(flow.from, existing)
  }

  // Generate connection for each source
  for (const [source, flows] of flowsBySource) {
    const sourceType = getSourceType(source, ctx)
    const task = workflow.tasks.find((t) => t.name === source)

    if (sourceType === 'condition') {
      lines.push(generateConditionConnection(source, flows))
    } else if (sourceType === 'task') {
      const splitType = task?.splitType || 'and'
      lines.push(generateTaskConnection(source, flows, splitType))
    }
  }

  return lines
}

function getSourceType(
  source: string,
  ctx: WorkflowGeneratorContext
): 'task' | 'condition' {
  const { workflow } = ctx
  const isTask = workflow.tasks.some((t) => t.name === source)
  return isTask ? 'task' : 'condition'
}

function generateConditionConnection(source: string, flows: ExtractedFlow[]): string {
  const targets = flows.map((f) => `.task('${f.to}')`).join('')
  return `  .connectCondition('${source}', (to) => to${targets})`
}

function generateTaskConnection(
  source: string,
  flows: ExtractedFlow[],
  splitType: 'and' | 'xor' | 'or'
): string {
  // Separate flows to tasks vs conditions
  const taskFlows = flows.filter((f) => f.type === 'task->task')
  const conditionFlows = flows.filter((f) => f.type === 'task->condition')

  // Build targets
  const targets: string[] = []
  for (const flow of taskFlows) {
    targets.push(`.task('${flow.to}')`)
  }
  for (const flow of conditionFlows) {
    targets.push(`.condition('${flow.to}')`)
  }

  // If single target or AND split, simple connection
  if (targets.length === 1 || splitType === 'and') {
    return `  .connectTask('${source}', (to) => to${targets.join('')})`
  }

  // XOR or OR split needs routing function
  const routeFunction = generateRouteFunction(flows, splitType)
  return [
    `  .connectTask('${source}', (to) =>`,
    `    to`,
    ...targets.map((t) => `      ${t}`),
    `      .route(${routeFunction})`,
    `  )`,
  ].join('\n')
}

function generateRouteFunction(
  flows: ExtractedFlow[],
  splitType: 'xor' | 'or'
): string {
  // Generate route expressions for all flows
  const routeExpressions = flows.map((flow) => {
    const routeMethod = flow.type === 'task->task' ? 'toTask' : 'toCondition'
    return `route.${routeMethod}('${flow.to}')`
  })

  if (routeExpressions.length === 0) {
    throw new Error('No flows provided for routing')
  }

  if (splitType === 'xor') {
    // XOR: pick one route randomly (placeholder for actual business logic)
    const allRoutes = routeExpressions.join(', ')
    return `async ({ route }) => {
      const routes = [${allRoutes}]
      return routes[Math.floor(Math.random() * routes.length)]!
    }`
  } else {
    // OR: return array of all routes
    const allRoutes = routeExpressions.join(', ')
    return `async ({ route }) => {
      return [${allRoutes}]
    }`
  }
}

function generateCancellationRegion(region: CancellationRegion): string {
  const parts: string[] = []

  for (const task of region.tasks) {
    parts.push(`.task('${task}')`)
  }
  for (const condition of region.conditions) {
    parts.push(`.condition('${condition}')`)
  }

  return [
    `  .withCancellationRegion('${region.owner}', (cr) =>`,
    `    cr`,
    ...parts.map((p) => `      ${p}`),
    `  )`,
  ].join('\n')
}
