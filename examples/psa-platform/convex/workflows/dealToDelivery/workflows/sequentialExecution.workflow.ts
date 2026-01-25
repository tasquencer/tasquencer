import { Builder } from '../../../tasquencer'
import { getNextTaskTask } from '../workItems/getNextTask.workItem'
import { executeTaskTask } from '../workItems/executeTask.workItem'
import { completeTaskTask } from '../workItems/completeTask.workItem'
import { getProjectByWorkflowId } from '../db/projects'
import { listTasksByProject } from '../db/tasks'
import { assertProjectExists } from '../exceptions'

const finishSequenceTask = Builder.dummyTask()

export const sequentialExecutionWorkflow = Builder.workflow('sequentialExecution')
  .startCondition('start')
  .endCondition('end')
  .task('getNextTask', getNextTaskTask.withJoinType('xor'))
  .task('executeTask', executeTaskTask)
  .task('completeTask', completeTaskTask.withSplitType('xor'))
  .dummyTask('finishSequence', finishSequenceTask)
  .connectCondition('start', (to) => to.task('getNextTask'))
  .connectTask('getNextTask', (to) => to.task('executeTask'))
  .connectTask('executeTask', (to) => to.task('completeTask'))
  .connectTask('completeTask', (to) =>
    to
      .task('getNextTask')
      .task('finishSequence')
      .route(async ({ mutationCtx, route, parent }) => {
        // Check if there are more tasks to process
        const project = await getProjectByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertProjectExists(project, { workflowId: parent.workflow.id })

        const tasks = await listTasksByProject(mutationCtx.db, project._id)
        const pendingTasks = tasks.filter(t => t.status === 'Todo' || t.status === 'InProgress')

        if (pendingTasks.length > 0) {
          return route.toTask('getNextTask')
        }
        return route.toTask('finishSequence')
      })
  )
  .connectTask('finishSequence', (to) => to.condition('end'))