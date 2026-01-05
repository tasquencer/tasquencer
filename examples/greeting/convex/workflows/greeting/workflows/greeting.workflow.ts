import { Builder } from '../../../tasquencer'
import { z } from 'zod'
import { insertGreeting } from '../db'
import { storeGreetingTask } from '../workItems/storeGreeting.workItem'

const greetingWorkflowActions = Builder.workflowActions().initialize(
  z.any(),
  async ({ mutationCtx, workflow }) => {
    const workflowId = await workflow.initialize()

    // Create the greeting aggregate root with empty message
    // The message will be filled in by the storeGreeting work item
    await insertGreeting(mutationCtx.db, {
      workflowId,
      message: '',
      createdAt: Date.now(),
    })
  },
)

export const greetingWorkflow = Builder.workflow('greeting')
  .withActions(greetingWorkflowActions)
  .startCondition('start')
  .task('storeGreeting', storeGreetingTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('storeGreeting'))
  .connectTask('storeGreeting', (to) => to.condition('end'))
