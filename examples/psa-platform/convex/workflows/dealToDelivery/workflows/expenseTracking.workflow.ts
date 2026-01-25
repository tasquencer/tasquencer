import { Builder } from '../../../tasquencer'
import { getCompletedWorkItemByTask } from '../db/workflows'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { selectExpenseTypeTask } from '../workItems/selectExpenseType.workItem'
import { logSoftwareExpenseTask } from '../workItems/logSoftwareExpense.workItem'
import { logTravelExpenseTask } from '../workItems/logTravelExpense.workItem'
import { logMaterialsExpenseTask } from '../workItems/logMaterialsExpense.workItem'
import { logSubcontractorExpenseTask } from '../workItems/logSubcontractorExpense.workItem'
import { logOtherExpenseTask } from '../workItems/logOtherExpense.workItem'
import { attachReceiptTask } from '../workItems/attachReceipt.workItem'
import { markBillableTask } from '../workItems/markBillable.workItem'
import { setBillableRateTask } from '../workItems/setBillableRate.workItem'
import { submitExpenseTask } from '../workItems/submitExpense.workItem'
export const expenseTrackingWorkflow = Builder.workflow('expenseTracking')
  .startCondition('start')
  .endCondition('end')
  .task('selectExpenseType', selectExpenseTypeTask.withSplitType('xor'))
  .task('logSoftwareExpense', logSoftwareExpenseTask)
  .task('logTravelExpense', logTravelExpenseTask)
  .task('logMaterialsExpense', logMaterialsExpenseTask)
  .task('logSubcontractorExpense', logSubcontractorExpenseTask)
  .task('logOtherExpense', logOtherExpenseTask)
  .task('attachReceipt', attachReceiptTask.withJoinType('xor'))
  .task('markBillable', markBillableTask.withSplitType('xor'))
  .task('setBillableRate', setBillableRateTask)
  .task('submitExpense', submitExpenseTask.withJoinType('xor'))
  .connectCondition('start', (to) => to.task('selectExpenseType'))
  .connectTask('selectExpenseType', (to) =>
    to
      .task('logSoftwareExpense')
      .task('logTravelExpense')
      .task('logMaterialsExpense')
      .task('logSubcontractorExpense')
      .task('logOtherExpense')
      .route(async ({ mutationCtx, route, parent }) => {
        const workItem = await getCompletedWorkItemByTask(mutationCtx.db, parent.workflow.id, 'selectExpenseType')
        if (workItem) {
          const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, workItem._id)
          if (metadata?.payload.type === 'selectExpenseType' && metadata.payload.selectedExpenseType) {
            const selectedExpenseType = metadata.payload.selectedExpenseType
            switch (selectedExpenseType) {
              case 'Software':
                return route.toTask('logSoftwareExpense')
              case 'Travel':
                return route.toTask('logTravelExpense')
              case 'Materials':
                return route.toTask('logMaterialsExpense')
              case 'Subcontractor':
                return route.toTask('logSubcontractorExpense')
              case 'Other':
              default:
                return route.toTask('logOtherExpense')
            }
          }
        }
        // Default to logOtherExpense if no metadata or selectedExpenseType found
        return route.toTask('logOtherExpense')
      })
  )
  .connectTask('logSoftwareExpense', (to) => to.task('attachReceipt'))
  .connectTask('logTravelExpense', (to) => to.task('attachReceipt'))
  .connectTask('logMaterialsExpense', (to) => to.task('attachReceipt'))
  .connectTask('logSubcontractorExpense', (to) => to.task('attachReceipt'))
  .connectTask('logOtherExpense', (to) => to.task('attachReceipt'))
  .connectTask('attachReceipt', (to) => to.task('markBillable'))
  .connectTask('markBillable', (to) =>
    to
      .task('setBillableRate')
      .task('submitExpense')
      .route(async ({ mutationCtx, route, parent }) => {
        const workItem = await getCompletedWorkItemByTask(mutationCtx.db, parent.workflow.id, 'markBillable')
        if (workItem) {
          const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, workItem._id)
          if (metadata?.payload.type === 'markBillable' && metadata.payload.isBillable) {
            return route.toTask('setBillableRate')
          }
        }
        // Default to submitExpense (non-billable path)
        return route.toTask('submitExpense')
      })
  )
  .connectTask('setBillableRate', (to) => to.task('submitExpense'))
  .connectTask('submitExpense', (to) => to.condition('end'))