import { Builder } from '../../../tasquencer'
import { createAndAssignTasksTask } from '../workItems/createAndAssignTasks.workItem'
import { monitorBudgetBurnTask } from '../workItems/monitorBudgetBurn.workItem'
import { pauseWorkTask } from '../workItems/pauseWork.workItem'
import { requestChangeOrderTask } from '../workItems/requestChangeOrder.workItem'
import { getChangeOrderApprovalTask } from '../workItems/getChangeOrderApproval.workItem'
import { timeTrackingWorkflow } from './timeTracking.workflow'
import { expenseTrackingWorkflow } from './expenseTracking.workflow'
import { sequentialExecutionWorkflow } from './sequentialExecution.workflow'
import { parallelExecutionWorkflow } from './parallelExecution.workflow'
import { conditionalExecutionWorkflow } from './conditionalExecution.workflow'
import { getProjectByWorkflowId } from '../db/projects'
import { listChangeOrdersByProject } from '../db/changeOrders'
import { listWorkItemsByParentTask } from '../db/workflows'
import { assertProjectExists } from '../exceptions'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
const finalizeTimeTrackingTask = Builder.dummyTask()

const finalizeExpenseTrackingTask = Builder.dummyTask()

const reviewExecutionTask = Builder.dummyTask()
  .withJoinType('or')

const completeExecutionTask = Builder.dummyTask()
  .withJoinType('xor')
export const executionPhaseWorkflow = Builder.workflow('executionPhase')
  .startCondition('start')
  .endCondition('end')
  .task('createAndAssignTasks', createAndAssignTasksTask)
  .dynamicCompositeTask('executeProjectWork', Builder.dynamicCompositeTask([sequentialExecutionWorkflow, parallelExecutionWorkflow, conditionalExecutionWorkflow])
    .withActivities({
      onEnabled: async ({ mutationCtx, workflow, parent }) => {
        // Read execution strategy from createAndAssignTasks work item metadata
        // TENET-ROUTING-DETERMINISM: Sort by _creationTime descending for deterministic selection
        // TENET-DOMAIN-BOUNDARY: Use domain helper for work item queries

        const parentWorkflowId = parent.workflow.id

        // Use domain helper instead of direct db query
        const workItems = await listWorkItemsByParentTask(
          mutationCtx.db,
          parentWorkflowId,
          "createAndAssignTasks"
        )

        if (workItems.length === 0) {
          // Fallback to sequential if no work items found
          await workflow.initialize.sequentialExecution()
          return
        }

        // Get metadata for the createAndAssignTasks work items
        const workItemMetadata = await Promise.all(
          workItems.map(wi =>
            DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, wi._id)
          )
        )

        // Sort by _creationTime descending and find most recent with executionStrategy
        type MetadataType = Awaited<ReturnType<typeof DealToDeliveryWorkItemHelpers.getWorkItemMetadata>>
        const sortedMetadata = workItemMetadata
          .filter((m): m is NonNullable<MetadataType> => m !== null)
          .sort((a, b) => b._creationTime - a._creationTime)

        for (const metadata of sortedMetadata) {
          if (metadata.payload.type === 'createAndAssignTasks' && metadata.payload.executionStrategy) {
            // Initialize the appropriate workflow based on the selected strategy
            switch (metadata.payload.executionStrategy) {
              case 'sequential':
                await workflow.initialize.sequentialExecution()
                return
              case 'parallel':
                await workflow.initialize.parallelExecution()
                return
              case 'conditional':
                await workflow.initialize.conditionalExecution()
                return
            }
          }
        }

        // Fallback: default to sequential if no strategy found
        await workflow.initialize.sequentialExecution()
      },
    })
  )
  .compositeTask('trackTime', Builder.compositeTask(timeTrackingWorkflow)
    .withJoinType('xor')
    .withSplitType('xor')
    .withActivities({
      onEnabled: async ({ workflow }) => {
        // Initialize the time tracking child workflow when this composite task is enabled
        await workflow.initialize()
      },
    })
  )
  .dummyTask('finalizeTimeTracking', finalizeTimeTrackingTask)
  .compositeTask('trackExpenses', Builder.compositeTask(expenseTrackingWorkflow)
    .withJoinType('xor')
    .withSplitType('xor')
    .withActivities({
      onEnabled: async ({ workflow }) => {
        // Initialize the expense tracking child workflow when this composite task is enabled
        await workflow.initialize()
      },
    })
  )
  .dummyTask('finalizeExpenseTracking', finalizeExpenseTrackingTask)
  .dummyTask('reviewExecution', reviewExecutionTask)
  .task('monitorBudgetBurn', monitorBudgetBurnTask.withJoinType('xor').withSplitType('xor'))
  .task('pauseWork', pauseWorkTask)
  .task('requestChangeOrder', requestChangeOrderTask)
  .task('getChangeOrderApproval', getChangeOrderApprovalTask.withSplitType('xor'))
  .dummyTask('completeExecution', completeExecutionTask)
  .connectCondition('start', (to) => to.task('createAndAssignTasks'))
  .connectTask('createAndAssignTasks', (to) => to.task('executeProjectWork').task('trackTime').task('trackExpenses'))
  // Note: Self-loops on composite tasks are not supported in workflow type system.
  // Time tracking completion now flows directly to finalize step.
  // TODO: If looping is needed, add an intermediate condition node. (deferred:execution-phase-loops)
  .connectTask('trackTime', (to) =>
    to.task('finalizeTimeTracking').route(async ({ route }) => route.toTask('finalizeTimeTracking'))
  )
  .connectTask('trackExpenses', (to) =>
    to.task('finalizeExpenseTracking').route(async ({ route }) => route.toTask('finalizeExpenseTracking'))
  )
  .connectTask('executeProjectWork', (to) => to.task('reviewExecution'))
  .connectTask('finalizeTimeTracking', (to) => to.task('reviewExecution'))
  .connectTask('finalizeExpenseTracking', (to) => to.task('reviewExecution'))
  .connectTask('reviewExecution', (to) => to.task('monitorBudgetBurn'))
  .connectTask('monitorBudgetBurn', (to) =>
    to
      .task('completeExecution')
      .task('pauseWork')
      .route(async ({ mutationCtx, route, workItem }) => {
      // Get the budget burn result from work item metadata
      // The monitorBudgetBurn work item calculates burn and stores budgetOk in metadata
      const workItemIds = await workItem.getAllWorkItemIds()

      // Fetch all metadata documents for deterministic ordering
      // TENET-ROUTING-DETERMINISM: In looped workflows (monitorBudgetBurn → pauseWork → requestChangeOrder → getChangeOrderApproval → monitorBudgetBurn),
      // we must read the most recent budget check to avoid routing based on stale data
      const allMetadata = await Promise.all(
        workItemIds.map(id => DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, id))
      )

      // Sort by _creationTime descending (most recent first) for deterministic routing
      const sortedMetadata = allMetadata
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => b._creationTime - a._creationTime)

      // Find the most recent work item with a budget decision
      for (const metadata of sortedMetadata) {
        if (metadata.payload.type === 'monitorBudgetBurn' && metadata.payload.budgetOk !== undefined) {
          if (metadata.payload.budgetOk) {
            // Budget OK (burn <= 90%) - continue to completion
            return route.toTask('completeExecution')
          } else {
            // Budget overrun (burn > 90%) - pause work and request change order
            return route.toTask('pauseWork')
          }
        }
      }

      // Fallback: if no budget data found, default to completeExecution
      // This should not happen in normal operation
      return route.toTask('completeExecution')
    })
  )
  .connectTask('pauseWork', (to) => to.task('requestChangeOrder'))
  .connectTask('requestChangeOrder', (to) => to.task('getChangeOrderApproval'))
  .connectTask('getChangeOrderApproval', (to) =>
    to
      .task('monitorBudgetBurn')
      .task('completeExecution')
      .route(async ({ mutationCtx, route, parent }) => {
      // Check change order status
      const project = await getProjectByWorkflowId(mutationCtx.db, parent.workflow.id)
      assertProjectExists(project, { workflowId: parent.workflow.id })

      const changeOrders = await listChangeOrdersByProject(mutationCtx.db, project._id)
      const latestChangeOrder = changeOrders[0] // Most recent

      if (latestChangeOrder?.status === 'Approved') {
        return route.toTask('monitorBudgetBurn')
      }
      // Rejected or no change order - complete execution
      return route.toTask('completeExecution')
    })
  )
  .connectTask('completeExecution', (to) => to.condition('end'))