import { Builder } from '../../../tasquencer'
import { createProjectTask } from '../workItems/createProject.workItem'
import { setBudgetTask } from '../workItems/setBudget.workItem'
import { resourcePlanningWorkflow } from './resourcePlanning.workflow'

/**
 * Composite tasks require onEnabled activities to initialize their child workflows.
 * Without this, the child workflow will never be created when the task is enabled.
 */
const allocateResourcesCompositeTask = Builder.compositeTask(resourcePlanningWorkflow)
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

export const planningPhaseWorkflow = Builder.workflow('planningPhase')
  .startCondition('start')
  .endCondition('end')
  .task('createProject', createProjectTask)
  .task('setBudget', setBudgetTask)
  .compositeTask('allocateResources', allocateResourcesCompositeTask)
  .connectCondition('start', (to) => to.task('createProject'))
  .connectTask('createProject', (to) => to.task('setBudget'))
  .connectTask('setBudget', (to) => to.task('allocateResources'))
  .connectTask('allocateResources', (to) => to.condition('end'))