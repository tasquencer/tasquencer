import { Workflow } from '../elements/workflow'
import { WorkItem } from '../elements/workItem'
import { Task } from '../elements/task'
import {
  ElementNotFoundInPathError,
  WorkItemCannotHaveChildrenError,
} from '../exceptions'
import { CompositeTask } from '../elements/compositeTask'
import { DynamicCompositeTask } from '../elements/dynamicCompositeTask'
import { BaseTask } from '../elements/baseTask'
import { z } from 'zod'

function isNever(schema: z.ZodTypeAny): schema is z.ZodNever {
  return schema instanceof z.ZodNever
}

export function parsePayload(schema: z.ZodTypeAny, payload: unknown) {
  return isNever(schema) ? undefined : schema.parse(payload)
}

function isWorkflow(
  element: Workflow | BaseTask | WorkItem,
): element is Workflow {
  return element instanceof Workflow
}
function isTask(element: Workflow | BaseTask | WorkItem): element is Task {
  return element instanceof Task
}
function isCompositeTask(
  element: Workflow | BaseTask | WorkItem,
): element is CompositeTask {
  return element instanceof CompositeTask
}
function isDynamicCompositeTask(
  element: Workflow | BaseTask | WorkItem,
): element is DynamicCompositeTask {
  return element instanceof DynamicCompositeTask
}
function isWorkItem(
  element: Workflow | BaseTask | WorkItem,
): element is WorkItem {
  return element instanceof WorkItem
}

function getElementByPath(workflow: Workflow, path: string[]) {
  const [workflowName, ...rest] = path

  if (workflowName !== workflow.name) {
    throw new ElementNotFoundInPathError('Workflow', path)
  }

  let currentElement: Workflow | WorkItem | BaseTask = workflow

  for (let index = 0; index < rest.length; index++) {
    const elementName = rest[index]
    const remaining = rest.length - index - 1
    if (isWorkflow(currentElement)) {
      currentElement = currentElement.getTask(elementName) as BaseTask
      continue
    }

    if (isTask(currentElement)) {
      currentElement = currentElement.getWorkItem()
      continue
    }

    if (isCompositeTask(currentElement)) {
      currentElement = currentElement.getWorkflow()
      continue
    }

    if (isDynamicCompositeTask(currentElement)) {
      // For dynamic composite tasks, the next element in the path should be the workflow name
      if (remaining === 0) {
        // We're at the dynamic composite task itself
        break
      }
      const workflowName = elementName
      currentElement = currentElement.getWorkflow(workflowName)
      continue
    }

    if (isWorkItem(currentElement)) {
      throw new WorkItemCannotHaveChildrenError(path)
    }
  }

  return currentElement as Task | WorkItem | Workflow | CompositeTask
}

export function getWorkItemElementByPath(workflow: Workflow, path: string[]) {
  const element = getElementByPath(workflow, path)

  if (isWorkItem(element)) {
    return element
  }

  throw new ElementNotFoundInPathError('WorkItem', path)
}

export function getWorkflowElementByPath(workflow: Workflow, path: string[]) {
  const element = getElementByPath(workflow, path)

  if (isWorkflow(element)) {
    return element
  }

  throw new ElementNotFoundInPathError('Workflow', path)
}
