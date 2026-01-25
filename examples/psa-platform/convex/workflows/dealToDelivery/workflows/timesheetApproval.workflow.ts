import { Builder } from '../../../tasquencer'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { reviewTimesheetTask } from '../workItems/reviewTimesheet.workItem'
import { approveTimesheetTask } from '../workItems/approveTimesheet.workItem'
import { rejectTimesheetTask } from '../workItems/rejectTimesheet.workItem'
import { reviseTimesheetTask } from '../workItems/reviseTimesheet.workItem'
const completeApprovalTask = Builder.dummyTask()
export const timesheetApprovalWorkflow = Builder.workflow('timesheetApproval')
  .startCondition('start')
  .endCondition('end')
  .task('reviewTimesheet', reviewTimesheetTask.withJoinType('xor').withSplitType('xor'))
  .task('approveTimesheet', approveTimesheetTask)
  .task('rejectTimesheet', rejectTimesheetTask)
  .task('reviseTimesheet', reviseTimesheetTask)
  .dummyTask('completeApproval', completeApprovalTask)
  .connectCondition('start', (to) => to.task('reviewTimesheet'))
  .connectTask('reviewTimesheet', (to) =>
    to
      .task('approveTimesheet')
      .task('rejectTimesheet')
      .route(async ({ mutationCtx, route, workItem }) => {
        // Get all completed work items for the reviewTimesheet task
        const workItemIds = await workItem.getAllWorkItemIds()

        // Fetch all metadata documents for deterministic ordering
        // TENET-ROUTING-DETERMINISM: In looped workflows (reviewTimesheet → rejectTimesheet → reviseTimesheet → reviewTimesheet),
        // we must read the most recent review decision to avoid routing based on stale data
        const allMetadata = await Promise.all(
          workItemIds.map(id => DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, id))
        )

        // Sort by _creationTime descending (most recent first) for deterministic routing
        const sortedMetadata = allMetadata
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .sort((a, b) => b._creationTime - a._creationTime)

        // Find the most recent work item with a decision
        for (const metadata of sortedMetadata) {
          if (metadata.payload.type === 'reviewTimesheet' && metadata.payload.decision) {
            if (metadata.payload.decision === 'approve') {
              return route.toTask('approveTimesheet')
            } else if (metadata.payload.decision === 'reject') {
              return route.toTask('rejectTimesheet')
            }
          }
        }

        // Fallback: if no decision found, default to approve
        // This should not happen in normal operation
        return route.toTask('approveTimesheet')
      })
  )
  .connectTask('approveTimesheet', (to) => to.task('completeApproval'))
  .connectTask('rejectTimesheet', (to) => to.task('reviseTimesheet'))
  .connectTask('reviseTimesheet', (to) => to.task('reviewTimesheet'))
  .connectTask('completeApproval', (to) => to.condition('end'))