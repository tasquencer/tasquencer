import { Builder } from '../../../tasquencer'
import { getCompletedWorkItemByTask } from '../db/workflows'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { evaluateConditionTask } from '../workItems/evaluateCondition.workItem'
import { executePrimaryBranchTask } from '../workItems/executePrimaryBranch.workItem'
import { executeAlternateBranchTask } from '../workItems/executeAlternateBranch.workItem'

const mergeOutcomesTask = Builder.dummyTask()
  .withJoinType('xor')

export const conditionalExecutionWorkflow = Builder.workflow('conditionalExecution')
  .startCondition('start')
  .endCondition('end')
  .task('evaluateCondition', evaluateConditionTask.withSplitType('xor'))
  .task('executePrimaryBranch', executePrimaryBranchTask)
  .task('executeAlternateBranch', executeAlternateBranchTask)
  .dummyTask('mergeOutcomes', mergeOutcomesTask)
  .connectCondition('start', (to) => to.task('evaluateCondition'))
  .connectTask('evaluateCondition', (to) =>
    to
      .task('executePrimaryBranch')
      .task('executeAlternateBranch')
      .route(async ({ mutationCtx, route, parent }) => {
        const workItem = await getCompletedWorkItemByTask(mutationCtx.db, parent.workflow.id, 'evaluateCondition')
        if (workItem) {
          const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, workItem._id)
          // Type narrowing: check payload type before accessing type-specific properties
          if (metadata?.payload.type === 'evaluateCondition') {
            if (metadata.payload.conditionResult) {
              return route.toTask('executePrimaryBranch')
            }
            return route.toTask('executeAlternateBranch')
          }
        }
        // Default to executePrimaryBranch if no metadata found
        return route.toTask('executePrimaryBranch')
      })
  )
  .connectTask('executePrimaryBranch', (to) => to.task('mergeOutcomes'))
  .connectTask('executeAlternateBranch', (to) => to.task('mergeOutcomes'))
  .connectTask('mergeOutcomes', (to) => to.condition('end'))