import { Builder } from '../../../tasquencer'
import { closeProjectTask } from '../workItems/closeProject.workItem'
import { conductRetroTask } from '../workItems/conductRetro.workItem'
export const closePhaseWorkflow = Builder.workflow('closePhase')
  .startCondition('start')
  .endCondition('end')
  .task('closeProject', closeProjectTask)
  .task('conductRetro', conductRetroTask)
  .connectCondition('start', (to) => to.task('closeProject'))
  .connectTask('closeProject', (to) => to.task('conductRetro'))
  .connectTask('conductRetro', (to) => to.condition('end'))