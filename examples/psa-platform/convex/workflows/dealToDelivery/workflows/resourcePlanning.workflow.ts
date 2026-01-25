import { Builder } from '../../../tasquencer'
import { viewTeamAvailabilityTask } from '../workItems/viewTeamAvailability.workItem'
import { filterBySkillsRoleTask } from '../workItems/filterBySkillsRole.workItem'
import { recordPlannedTimeOffTask } from '../workItems/recordPlannedTimeOff.workItem'
import { createBookingsTask } from '../workItems/createBookings.workItem'
import { reviewBookingsTask } from '../workItems/reviewBookings.workItem'
import { checkConfirmationNeededTask } from '../workItems/checkConfirmationNeeded.workItem'
import { confirmBookingsTask } from '../workItems/confirmBookings.workItem'
import { getProjectByWorkflowId } from '../db/projects'
import { listBookingsByProject } from '../db/bookings'
import { getCompletedWorkItemByTask } from '../db/workflows'
import { assertProjectExists } from '../exceptions'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
const completeAllocationTask = Builder.dummyTask()
  .withJoinType('xor')
export const resourcePlanningWorkflow = Builder.workflow('resourcePlanning')
  .startCondition('start')
  .endCondition('end')
  .task('viewTeamAvailability', viewTeamAvailabilityTask)
  .task('filterBySkillsRole', filterBySkillsRoleTask.withJoinType('xor'))
  .task('recordPlannedTimeOff', recordPlannedTimeOffTask)
  .task('createBookings', createBookingsTask)
  .task('reviewBookings', reviewBookingsTask.withSplitType('xor'))
  .task('checkConfirmationNeeded', checkConfirmationNeededTask.withSplitType('xor'))
  .task('confirmBookings', confirmBookingsTask)
  .dummyTask('completeAllocation', completeAllocationTask)
  .connectCondition('start', (to) => to.task('viewTeamAvailability'))
  .connectTask('viewTeamAvailability', (to) => to.task('filterBySkillsRole'))
  .connectTask('filterBySkillsRole', (to) => to.task('recordPlannedTimeOff').task('createBookings'))
  .connectTask('recordPlannedTimeOff', (to) => to.task('reviewBookings'))
  .connectTask('createBookings', (to) => to.task('reviewBookings'))
  .connectTask('reviewBookings', (to) =>
    to
      .task('filterBySkillsRole')
      .task('checkConfirmationNeeded')
      .route(async ({ mutationCtx, route, parent }) => {
        const workItem = await getCompletedWorkItemByTask(mutationCtx.db, parent.workflow.id, 'reviewBookings')
        if (workItem) {
          const metadata = await DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, workItem._id)
          // Type narrowing: check payload type before accessing type-specific properties
          if (metadata?.payload.type === 'reviewBookings' && metadata.payload.needsMoreFiltering) {
            return route.toTask('filterBySkillsRole')
          }
        }
        // Default to checkConfirmationNeeded if no more filtering needed
        return route.toTask('checkConfirmationNeeded')
      })
  )
  .connectTask('checkConfirmationNeeded', (to) =>
    to
      .task('confirmBookings')
      .task('completeAllocation')
      .route(async ({ mutationCtx, route, parent }) => {
      // Check if there are any Tentative bookings needing confirmation
      const project = await getProjectByWorkflowId(mutationCtx.db, parent.workflow.id)
      assertProjectExists(project, { workflowId: parent.workflow.id })

      const bookings = await listBookingsByProject(mutationCtx.db, project._id)
      const hasTentativeBookings = bookings.some(b => b.type === 'Tentative')

      if (hasTentativeBookings) {
        return route.toTask('confirmBookings')
      }
      return route.toTask('completeAllocation')
    })
  )
  .connectTask('confirmBookings', (to) => to.task('completeAllocation'))
  .connectTask('completeAllocation', (to) => to.condition('end'))