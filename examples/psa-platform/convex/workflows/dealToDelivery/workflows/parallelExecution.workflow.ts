/**
 * Parallel Execution Workflow
 *
 * Implements true parallel task execution using AND-split/AND-join patterns.
 * Uses a dynamic composite task to spawn multiple singleTaskExecution workflows,
 * one for each task that can be executed concurrently.
 *
 * Flow:
 * 1. initParallelTasks - Identifies tasks with no blocking dependencies
 * 2. executeAllTasks (dynamic composite) - Spawns N child workflows in parallel
 * 3. syncParallelTasks - Final synchronization and status aggregation
 *
 * The dynamic composite task:
 * - In onEnabled: Reads parallelTaskIds from initParallelTasks metadata
 * - For each task ID: Initializes a singleTaskExecution workflow
 * - Default policy: Waits for ALL child workflows to complete (AND-join)
 *
 * Reference: docs/DYNAMIC_COMPOSITE_TASKS.md
 */
import { Builder } from '../../../tasquencer'
import { initParallelTasksTask } from '../workItems/initParallelTasks.workItem'
import { syncParallelTasksTask } from '../workItems/syncParallelTasks.workItem'
import { singleTaskExecutionWorkflow } from './singleTaskExecution.workflow'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { listWorkItemsByParentTask } from '../db/workflows'
import { getProjectByWorkflowId } from '../db/projects'
import { assertProjectExists } from '../exceptions'
import type { Id } from '../../../_generated/dataModel'

/**
 * Dynamic composite task that spawns multiple singleTaskExecution workflows.
 * Each child workflow executes one project task in parallel with others.
 */
const executeAllTasksComposite = Builder.dynamicCompositeTask([singleTaskExecutionWorkflow])
  .withActivities({
    onEnabled: async ({ mutationCtx, workflow, parent }) => {
      // Read parallelTaskIds from initParallelTasks work item metadata
      // TENET-ROUTING-DETERMINISM: Sort by _creationTime descending for deterministic selection
      const parentWorkflowId = parent.workflow.id

      // Get the project for this workflow (needed to get task IDs)
      const project = await getProjectByWorkflowId(mutationCtx.db, parentWorkflowId)

      // If no project found, this might be a sub-workflow. Try to get from parent.
      if (!project) {
        // Fallback: Get work items from initParallelTasks task in this workflow
        const workItems = await listWorkItemsByParentTask(
          mutationCtx.db,
          parentWorkflowId,
          'initParallelTasks'
        )

        if (workItems.length === 0) {
          // No parallel tasks identified - complete immediately
          return
        }

        // Get metadata for the initParallelTasks work items
        const workItemMetadata = await Promise.all(
          workItems.map(wi =>
            DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, wi._id)
          )
        )

        // Sort by _creationTime descending and find most recent with parallelTaskIds
        type MetadataType = Awaited<ReturnType<typeof DealToDeliveryWorkItemHelpers.getWorkItemMetadata>>
        const sortedMetadata = workItemMetadata
          .filter((m): m is NonNullable<MetadataType> => m !== null)
          .sort((a, b) => b._creationTime - a._creationTime)

        for (const metadata of sortedMetadata) {
          if (metadata.payload.type === 'initParallelTasks') {
            const taskIds = (metadata.payload as { parallelTaskIds?: Id<'tasks'>[] }).parallelTaskIds
            if (taskIds && taskIds.length > 0) {
              // Spawn one singleTaskExecution workflow per task
              // These execute in parallel (AND-split behavior)
              for (const taskId of taskIds) {
                await workflow.initialize.singleTaskExecution({ taskId })
              }
              return
            }
          }
        }
        return
      }

      assertProjectExists(project, { workflowId: parentWorkflowId })

      // Get work items from initParallelTasks task
      const workItems = await listWorkItemsByParentTask(
        mutationCtx.db,
        parentWorkflowId,
        'initParallelTasks'
      )

      if (workItems.length === 0) {
        // No parallel tasks identified - complete immediately
        return
      }

      // Get metadata for the initParallelTasks work items
      const workItemMetadata = await Promise.all(
        workItems.map(wi =>
          DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, wi._id)
        )
      )

      // Sort by _creationTime descending and find most recent with parallelTaskIds
      type MetadataType = Awaited<ReturnType<typeof DealToDeliveryWorkItemHelpers.getWorkItemMetadata>>
      const sortedMetadata = workItemMetadata
        .filter((m): m is NonNullable<MetadataType> => m !== null)
        .sort((a, b) => b._creationTime - a._creationTime)

      for (const metadata of sortedMetadata) {
        if (metadata.payload.type === 'initParallelTasks') {
          const taskIds = (metadata.payload as { parallelTaskIds?: Id<'tasks'>[] }).parallelTaskIds
          if (taskIds && taskIds.length > 0) {
            // Spawn one singleTaskExecution workflow per task
            // These execute in parallel (AND-split behavior)
            for (const taskId of taskIds) {
              await workflow.initialize.singleTaskExecution({ taskId })
            }
            return
          }
        }
      }

      // No tasks found to execute - composite will complete with no children
    },

    onWorkflowStateChanged: async ({ workflow }) => {
      // Log progress for debugging
      // eslint-disable-next-line no-console
      console.log(
        `[parallelExecution] Child workflow ${workflow.name} (${workflow.id}) ` +
        `transitioned from ${workflow.prevState} to ${workflow.nextState}`
      )
    },
  })
  // Default policy: AND-join - wait for ALL child workflows to complete
  // This is the correct behavior for parallel execution synchronization
  .withDescription('Executes multiple project tasks in parallel')

/**
 * The parallel execution workflow with true AND-split/AND-join parallelism.
 */
export const parallelExecutionWorkflow = Builder.workflow('parallelExecution')
  .startCondition('start')
  .endCondition('end')
  .task('initParallelTasks', initParallelTasksTask)
  .dynamicCompositeTask('executeAllTasks', executeAllTasksComposite)
  .task('syncParallelTasks', syncParallelTasksTask)
  .connectCondition('start', (to) => to.task('initParallelTasks'))
  .connectTask('initParallelTasks', (to) => to.task('executeAllTasks'))
  .connectTask('executeAllTasks', (to) => to.task('syncParallelTasks'))
  .connectTask('syncParallelTasks', (to) => to.condition('end'))
