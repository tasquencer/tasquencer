import { Builder } from '../../../tasquencer'
import { salesPhaseWorkflow } from './salesPhase.workflow'
import { planningPhaseWorkflow } from './planningPhase.workflow'
import { executionPhaseWorkflow } from './executionPhase.workflow'
import { billingPhaseWorkflow } from './billingPhase.workflow'
import { closePhaseWorkflow } from './closePhase.workflow'
import { getDealByWorkflowId } from '../db/deals'
import { assertDealExists } from '../exceptions'

const handleDealLostTask = Builder.dummyTask()

/**
 * Composite tasks require onEnabled activities to initialize their child workflows.
 * Without this, the child workflow will never be created when the task is enabled.
 */
const salesCompositeTask = Builder.compositeTask(salesPhaseWorkflow)
  .withSplitType('xor')
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

const planningCompositeTask = Builder.compositeTask(planningPhaseWorkflow)
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

const executionCompositeTask = Builder.compositeTask(executionPhaseWorkflow)
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

const billingCompositeTask = Builder.compositeTask(billingPhaseWorkflow)
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

const closeCompositeTask = Builder.compositeTask(closePhaseWorkflow)
  .withJoinType('and')
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize()
    },
  })

export const dealToDeliveryWorkflow = Builder.workflow('dealToDelivery')
  .startCondition('start')
  .endCondition('end')
  .compositeTask('sales', salesCompositeTask)
  .compositeTask('planning', planningCompositeTask)
  .compositeTask('execution', executionCompositeTask)
  .compositeTask('billing', billingCompositeTask)
  .compositeTask('close', closeCompositeTask)
  .dummyTask('handleDealLost', handleDealLostTask)
  .connectCondition('start', (to) => to.task('sales'))
  .connectTask('sales', (to) =>
    to
      .task('planning')
      .task('handleDealLost')
      .route(async ({ mutationCtx, route, parent }) => {
        // Route based on deal outcome from sales phase
        const deal = await getDealByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertDealExists(deal, { workflowId: parent.workflow.id })

        // Won → continue to planning, Lost/Disqualified → handle lost
        if (deal.stage === 'Won') {
          return route.toTask('planning')
        }
        return route.toTask('handleDealLost')
      })
  )
  .connectTask('planning', (to) => to.task('execution').task('billing'))
  .connectTask('execution', (to) => to.task('close'))
  .connectTask('billing', (to) => to.task('close'))
  .connectTask('close', (to) => to.condition('end'))
  .connectTask('handleDealLost', (to) => to.condition('end'))
