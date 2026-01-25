import { Builder } from '../../../tasquencer'
import { DealToDeliveryWorkItemHelpers } from '../helpers'
import { reviewExpenseTask } from '../workItems/reviewExpense.workItem'
import { approveExpenseTask } from '../workItems/approveExpense.workItem'
import { rejectExpenseTask } from '../workItems/rejectExpense.workItem'
import { reviseExpenseTask } from '../workItems/reviseExpense.workItem'
const completeExpenseApprovalTask = Builder.dummyTask()
export const expenseApprovalWorkflow = Builder.workflow('expenseApproval')
  .startCondition('start')
  .endCondition('end')
  .task('reviewExpense', reviewExpenseTask.withJoinType('xor').withSplitType('xor'))
  .task('approveExpense', approveExpenseTask)
  .task('rejectExpense', rejectExpenseTask)
  .task('reviseExpense', reviseExpenseTask)
  .dummyTask('completeExpenseApproval', completeExpenseApprovalTask)
  .connectCondition('start', (to) => to.task('reviewExpense'))
  .connectTask('reviewExpense', (to) =>
    to
      .task('approveExpense')
      .task('rejectExpense')
      .route(async ({ mutationCtx, route, workItem }) => {
        // Get the review decision from work item metadata
        // The reviewExpense work item stores the decision in metadata on completion
        const workItemIds = await workItem.getAllWorkItemIds()

        // Fetch all metadata documents for deterministic ordering
        // TENET-ROUTING-DETERMINISM: In looped workflows (reviewExpense → rejectExpense → reviseExpense → reviewExpense),
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
          if (metadata.payload.type === 'reviewExpense' && metadata.payload.decision) {
            if (metadata.payload.decision === 'approve') {
              return route.toTask('approveExpense')
            } else if (metadata.payload.decision === 'reject') {
              return route.toTask('rejectExpense')
            }
          }
        }

        // Fallback: if no decision found, default to approve
        // This should not happen in normal operation
        return route.toTask('approveExpense')
      })
  )
  .connectTask('approveExpense', (to) => to.task('completeExpenseApproval'))
  .connectTask('rejectExpense', (to) => to.task('reviseExpense'))
  .connectTask('reviseExpense', (to) => to.task('reviewExpense'))
  .connectTask('completeExpenseApproval', (to) => to.condition('end'))