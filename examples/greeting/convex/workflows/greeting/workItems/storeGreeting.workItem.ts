import { Builder } from '../../../tasquencer'
import { z } from 'zod'
import { authService } from '../../../authorization'
import { getGreetingByWorkflowId, updateGreetingMessage } from '../db'
import { initializeGreetingWorkItemAuth } from './authHelpers'
import { GreetingWorkItemHelpers } from '../helpers'
import { authComponent } from '../../../auth'
import { isHumanClaim } from '@repo/tasquencer'
import invariant from 'tiny-invariant'

const storeWritePolicy = authService.policies.requireScope('greeting:write')

const storeGreetingActions = authService.builders.workItemActions
  .start(z.never(), storeWritePolicy, async ({ mutationCtx, workItem }) => {
    const authUser = await authComponent.getAuthUser(mutationCtx)

    const userId = authUser.userId

    invariant(userId, 'USER_DOES_NOT_EXIST')

    await GreetingWorkItemHelpers.claimWorkItem(
      mutationCtx,
      workItem.id,
      userId,
    )
    await workItem.start()
  })
  .complete(
    z.object({
      message: z.string().min(1, 'Message is required'),
    }),
    storeWritePolicy,
    async ({ mutationCtx, workItem, parent }, payload) => {
      const authUser = await authComponent.getAuthUser(mutationCtx)

      const userId = authUser.userId

      invariant(userId, 'USER_DOES_NOT_EXIST')

      // Verify the user has claimed this work item
      const metadata = await GreetingWorkItemHelpers.getWorkItemMetadata(
        mutationCtx.db,
        workItem.id,
      )
      const claimedBy = isHumanClaim(metadata?.claim)
        ? metadata.claim.userId
        : null
      if (!claimedBy || claimedBy !== userId) {
        throw new Error('WORK_ITEM_NOT_CLAIMED_BY_USER')
      }

      // Get the greeting and update the message
      const greeting = await getGreetingByWorkflowId(
        mutationCtx.db,
        parent.workflow.id,
      )

      invariant(greeting, 'GREETING_NOT_FOUND')

      await updateGreetingMessage(mutationCtx.db, greeting._id, payload.message)
    },
  )

export const storeGreetingWorkItem = Builder.workItem(
  'storeGreeting',
).withActions(storeGreetingActions.build())

export const storeGreetingTask = Builder.task(
  storeGreetingWorkItem,
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    // Initialize the work item when the task is enabled
    const greeting = await getGreetingByWorkflowId(
      mutationCtx.db,
      parent.workflow.id,
    )

    invariant(greeting, 'GREETING_NOT_FOUND')

    const workItemId = await workItem.initialize()

    await initializeGreetingWorkItemAuth(mutationCtx, workItemId, {
      scope: 'greeting:write',
      greetingId: greeting._id,
      payload: {
        type: 'storeGreeting',
        taskName: 'Store Greeting',
      },
    })
  },
})
