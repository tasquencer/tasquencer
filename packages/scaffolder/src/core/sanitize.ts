import type {
  ScaffolderInput,
  ExtractedWorkflow,
  ExtractedTask,
  ExtractedFlow,
  CancellationRegion,
  AuthScope,
  WorkItem,
} from '../types/input.js'
import { toCamelCase } from './naming.js'

export function sanitizeScaffolderInput(input: ScaffolderInput): ScaffolderInput {
  const workflows = [input.mainWorkflow, ...(input.subWorkflows ?? [])]
  const workflowNameMap = new Map<string, string>()
  const usedWorkflowNames = new Set<string>()

  for (const workflow of workflows) {
    const baseName = toCamelCase(workflow.name)
    const uniqueName = makeUniqueName(baseName, usedWorkflowNames)
    workflowNameMap.set(workflow.name, uniqueName)
  }

  const mainWorkflow = sanitizeWorkflow(input.mainWorkflow, workflowNameMap)
  const subWorkflows = input.subWorkflows?.map((workflow) =>
    sanitizeWorkflow(workflow, workflowNameMap)
  )
  const scopes = input.scopes.map(sanitizeScope)

  return {
    ...input,
    mainWorkflow,
    subWorkflows,
    scopes,
  }
}

function sanitizeWorkflow(
  workflow: ExtractedWorkflow,
  workflowNameMap: Map<string, string>
): ExtractedWorkflow {
  const usedNames = new Set<string>()
  const taskNameMap = new Map<string, string>()
  const conditionNameMap = new Map<string, string>()
  const workItemNameMap = new Map<string, string>()
  const usedWorkItemNames = new Set<string>()

  const tasks = workflow.tasks.map((task) =>
    sanitizeTask(
      task,
      taskNameMap,
      workItemNameMap,
      usedNames,
      usedWorkItemNames,
      workflowNameMap
    )
  )
  const conditions = workflow.conditions.map((condition) => {
    const baseName = toCamelCase(condition.name)
    const name = makeUniqueName(baseName, usedNames)
    conditionNameMap.set(condition.name, name)
    return { ...condition, name }
  })

  const flows = workflow.flows.map((flow) =>
    sanitizeFlow(flow, taskNameMap, conditionNameMap)
  )

  const cancellationRegions = workflow.cancellationRegions.map((region) =>
    sanitizeCancellationRegion(region, taskNameMap, conditionNameMap)
  )

  return {
    ...workflow,
    name: workflowNameMap.get(workflow.name) ?? toCamelCase(workflow.name),
    tasks,
    conditions,
    flows,
    cancellationRegions,
  }
}

function sanitizeTask(
  task: ExtractedTask,
  taskNameMap: Map<string, string>,
  workItemNameMap: Map<string, string>,
  usedNames: Set<string>,
  usedWorkItemNames: Set<string>,
  workflowNameMap: Map<string, string>
): ExtractedTask {
  const baseName = toCamelCase(task.name)
  const name = makeUniqueName(baseName, usedNames)
  taskNameMap.set(task.name, name)

  switch (task.type) {
    case 'task':
      if (task.workItem?.name) {
        const workItemBaseName = toCamelCase(task.workItem.name)
        const workItemName = makeUniqueName(
          workItemBaseName,
          usedWorkItemNames
        )
        workItemNameMap.set(task.workItem.name, workItemName)
      } else {
        const workItemName = makeUniqueName(name, usedWorkItemNames)
        workItemNameMap.set(task.name, workItemName)
      }
      return {
        ...task,
        name,
        workItem: sanitizeWorkItem(task.workItem, workItemNameMap, task.name),
      }
    case 'dummyTask':
      return { ...task, name }
    case 'compositeTask':
      return {
        ...task,
        name,
        subWorkflowName:
          workflowNameMap.get(task.subWorkflowName) ??
          toCamelCase(task.subWorkflowName),
      }
    case 'dynamicCompositeTask':
      return {
        ...task,
        name,
        workflowTypes: task.workflowTypes.map(
          (workflowName) =>
            workflowNameMap.get(workflowName) ?? toCamelCase(workflowName)
        ),
      }
  }
}

function sanitizeWorkItem(
  workItem: WorkItem | undefined,
  workItemNameMap: Map<string, string>,
  fallbackName: string
): WorkItem | undefined {
  if (!workItem) {
    return undefined
  }

  return {
    ...workItem,
    name:
      workItemNameMap.get(workItem.name) ??
      workItemNameMap.get(fallbackName) ??
      toCamelCase(workItem.name),
  }
}

function sanitizeFlow(
  flow: ExtractedFlow,
  taskNameMap: Map<string, string>,
  conditionNameMap: Map<string, string>
): ExtractedFlow {
  switch (flow.type) {
    case 'condition->task':
      return {
        ...flow,
        from: conditionNameMap.get(flow.from) ?? toCamelCase(flow.from),
        to: taskNameMap.get(flow.to) ?? toCamelCase(flow.to),
      }
    case 'task->condition':
      return {
        ...flow,
        from: taskNameMap.get(flow.from) ?? toCamelCase(flow.from),
        to: conditionNameMap.get(flow.to) ?? toCamelCase(flow.to),
      }
    case 'task->task':
      return {
        ...flow,
        from: taskNameMap.get(flow.from) ?? toCamelCase(flow.from),
        to: taskNameMap.get(flow.to) ?? toCamelCase(flow.to),
      }
  }
}

function sanitizeCancellationRegion(
  region: CancellationRegion,
  taskNameMap: Map<string, string>,
  conditionNameMap: Map<string, string>
): CancellationRegion {
  const owner =
    taskNameMap.get(region.owner) ??
    conditionNameMap.get(region.owner) ??
    toCamelCase(region.owner)

  return {
    ...region,
    owner,
    tasks: region.tasks.map((name) => taskNameMap.get(name) ?? toCamelCase(name)),
    conditions: region.conditions.map(
      (name) => conditionNameMap.get(name) ?? toCamelCase(name)
    ),
  }
}

function sanitizeScope(scope: AuthScope): AuthScope {
  const parts = scope.name.split(':').map((part) => toCamelCase(part))
  return {
    ...scope,
    name: parts.join(':'),
  }
}

function makeUniqueName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }

  let suffix = 2
  let candidate = `${baseName}${suffix}`
  while (usedNames.has(candidate)) {
    suffix += 1
    candidate = `${baseName}${suffix}`
  }

  usedNames.add(candidate)
  return candidate
}
