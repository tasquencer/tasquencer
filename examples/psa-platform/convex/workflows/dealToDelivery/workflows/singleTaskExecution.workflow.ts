/**
 * Single Task Execution Workflow
 *
 * A minimal workflow that executes a single project task.
 * Used by the parallel execution workflow to spawn multiple instances,
 * one for each task that can be executed concurrently.
 *
 * This workflow:
 * 1. Receives a taskId via the initialize action payload
 * 2. Stores the taskId mapping so the work item can read it
 * 3. The work item auto-initializes and auto-completes in onEnabled
 * 4. Signals completion to the parent dynamic composite task
 *
 * Reference: docs/DYNAMIC_COMPOSITE_TASKS.md - Fan-out pattern
 */
import { Builder } from '../../../tasquencer'
import { z } from 'zod'
import { zid } from 'convex-helpers/server/zod4'
import {
  insertParallelTaskMapping,
  deleteParallelTaskMapping,
  getParallelTaskMapping,
} from '../db/parallelTaskMappings'
import { getTask, updateTask } from '../db/tasks'
import { assertTaskExists } from '../exceptions'

/**
 * Workflow actions for single task execution.
 * Stores the taskId mapping when initialized so the work item can retrieve it.
 */
const singleTaskExecutionActions = Builder.workflowActions()
  .initialize(
    z.object({
      taskId: zid('tasks'),
    }),
    async ({ mutationCtx, workflow }, payload) => {
      const workflowId = await workflow.initialize()

      // Store the mapping so the work item can retrieve the taskId
      await insertParallelTaskMapping(mutationCtx.db, {
        workflowId,
        taskId: payload.taskId,
      })
    }
  )
  .cancel(
    z.any().optional(),
    async ({ mutationCtx, workflow }) => {
      // Clean up the mapping on cancellation
      await deleteParallelTaskMapping(mutationCtx.db, workflow.id)
      await workflow.cancel()
    }
  )

/**
 * A simple work item that auto-initializes and auto-completes.
 * Uses default actions (internal-only) since this is an auto-triggered task.
 */
const autoExecuteWorkItem = Builder.workItem('singleTaskExecution/autoExecute')

/**
 * The task that wraps the auto-execute work item.
 * The actual task execution happens in onEnabled activity.
 */
const autoExecuteTask = Builder.task(autoExecuteWorkItem).withActivities({
  onEnabled: async ({ mutationCtx, workItem, parent }) => {
    // Get the taskId from the mapping
    const mapping = await getParallelTaskMapping(mutationCtx.db, parent.workflow.id)

    if (!mapping) {
      // eslint-disable-next-line no-console
      console.warn(
        `[singleTaskExecution] No task mapping found for workflow ${parent.workflow.id}`
      )
      // Initialize - default actions auto-complete after initialization
      await workItem.initialize()
      return
    }

    // Get the task to execute
    const task = await getTask(mutationCtx.db, mapping.taskId)
    assertTaskExists(task, { taskId: mapping.taskId })

    // Execute the task: move from Todo to InProgress
    if (task.status === 'Todo') {
      await updateTask(mutationCtx.db, task._id, {
        status: 'InProgress',
      })
      // eslint-disable-next-line no-console
      console.log(
        `[singleTaskExecution] Started task "${task.name}" (${task._id})`
      )
    }

    // Initialize the work item - default actions auto-complete after initialization
    await workItem.initialize()
  },

  onCompleted: async ({ mutationCtx, parent }) => {
    // Clean up the mapping on completion
    await deleteParallelTaskMapping(mutationCtx.db, parent.workflow.id)
  },

  onFailed: async ({ mutationCtx, parent }) => {
    // Clean up the mapping on failure
    await deleteParallelTaskMapping(mutationCtx.db, parent.workflow.id)
  },

  onCanceled: async ({ mutationCtx, parent }) => {
    // Clean up the mapping on cancellation
    await deleteParallelTaskMapping(mutationCtx.db, parent.workflow.id)
  },
})

/**
 * The single task execution workflow wraps an auto-executing task.
 * Each instance handles exactly one project task.
 */
export const singleTaskExecutionWorkflow = Builder.workflow('singleTaskExecution')
  .withActions(singleTaskExecutionActions)
  .startCondition('start')
  .endCondition('end')
  .task('executeTask', autoExecuteTask)
  .connectCondition('start', (to) => to.task('executeTask'))
  .connectTask('executeTask', (to) => to.condition('end'))
