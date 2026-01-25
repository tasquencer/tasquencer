import { Builder } from '../../../tasquencer'
import { getCompletedWorkItemByTask } from '../db/workflows'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { selectEntryMethodTask } from '../workItems/selectEntryMethod.workItem'
import { useTimerTask } from '../workItems/useTimer.workItem'
import { manualEntryTask } from '../workItems/manualEntry.workItem'
import { importFromCalendarTask } from '../workItems/importFromCalendar.workItem'
import { autoFromBookingsTask } from '../workItems/autoFromBookings.workItem'
import { submitTimeEntryTask } from '../workItems/submitTimeEntry.workItem'
export const timeTrackingWorkflow = Builder.workflow('timeTracking')
  .startCondition('start')
  .endCondition('end')
  .task('selectEntryMethod', selectEntryMethodTask.withSplitType('xor'))
  .task('useTimer', useTimerTask)
  .task('manualEntry', manualEntryTask)
  .task('importFromCalendar', importFromCalendarTask)
  .task('autoFromBookings', autoFromBookingsTask)
  .task('submitTimeEntry', submitTimeEntryTask.withJoinType('xor'))
  .connectCondition('start', (to) => to.task('selectEntryMethod'))
  .connectTask('selectEntryMethod', (to) =>
    to
      .task('useTimer')
      .task('manualEntry')
      .task('importFromCalendar')
      .task('autoFromBookings')
      .route(async ({ mutationCtx, route, parent }) => {
        const workItem = await getCompletedWorkItemByTask(
          mutationCtx.db,
          parent.workflow.id,
          'selectEntryMethod'
        )

        if (workItem) {
          const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(
            mutationCtx.db,
            workItem._id
          )

          // Type narrowing: check payload type before accessing type-specific properties
          if (metadata?.payload.type === 'selectEntryMethod' && metadata.payload.selectedMethod) {
            const selectedMethod = metadata.payload.selectedMethod
            switch (selectedMethod) {
              case 'timer':
                return route.toTask('useTimer')
              case 'manual':
                return route.toTask('manualEntry')
              case 'calendar':
                return route.toTask('importFromCalendar')
              case 'autoBooking':
                return route.toTask('autoFromBookings')
            }
          }
        }

        // Default to manualEntry if no metadata or selectedMethod found
        return route.toTask('manualEntry')
      })
  )
  .connectTask('useTimer', (to) => to.task('submitTimeEntry'))
  .connectTask('manualEntry', (to) => to.task('submitTimeEntry'))
  .connectTask('importFromCalendar', (to) => to.task('submitTimeEntry'))
  .connectTask('autoFromBookings', (to) => to.task('submitTimeEntry'))
  .connectTask('submitTimeEntry', (to) => to.condition('end'))