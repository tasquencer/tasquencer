import { Builder } from '../../../tasquencer'
import { selectInvoicingMethodTask } from '../workItems/selectInvoicingMethod.workItem'
import { invoiceTimeAndMaterialsTask } from '../workItems/invoiceTimeAndMaterials.workItem'
import { invoiceFixedFeeTask } from '../workItems/invoiceFixedFee.workItem'
import { invoiceMilestoneTask } from '../workItems/invoiceMilestone.workItem'
import { invoiceRecurringTask } from '../workItems/invoiceRecurring.workItem'
import { reviewDraftTask } from '../workItems/reviewDraft.workItem'
import { editDraftTask } from '../workItems/editDraft.workItem'
import { finalizeInvoiceTask } from '../workItems/finalizeInvoice.workItem'
import { getProjectByWorkflowId } from '../db/projects'
import { getBudgetByProjectId } from '../db/budgets'
import { assertProjectExists } from '../exceptions'
import { DealToDeliveryWorkItemHelpers } from '../helpers'

export const invoiceGenerationWorkflow = Builder.workflow('invoiceGeneration')
  .startCondition('start')
  .endCondition('end')
  .task('selectInvoicingMethod', selectInvoicingMethodTask.withSplitType('xor'))
  .task('invoiceTimeAndMaterials', invoiceTimeAndMaterialsTask)
  .task('invoiceFixedFee', invoiceFixedFeeTask)
  .task('invoiceMilestone', invoiceMilestoneTask)
  .task('invoiceRecurring', invoiceRecurringTask)
  .task('reviewDraft', reviewDraftTask.withJoinType('xor').withSplitType('xor'))
  .task('editDraft', editDraftTask)
  .task('finalizeInvoice', finalizeInvoiceTask)
  .connectCondition('start', (to) => to.task('selectInvoicingMethod'))
  .connectTask('selectInvoicingMethod', (to) =>
    to
      .task('invoiceTimeAndMaterials')
      .task('invoiceFixedFee')
      .task('invoiceMilestone')
      .task('invoiceRecurring')
      .route(async ({ mutationCtx, route, parent }) => {
        // Get the project for this workflow
        const project = await getProjectByWorkflowId(mutationCtx.db, parent.workflow.id)
        assertProjectExists(project, { workflowId: parent.workflow.id })

        // Get the budget to determine invoicing method
        const budget = await getBudgetByProjectId(mutationCtx.db, project._id)
        if (!budget) {
          throw new Error('Project must have a budget before invoicing')
        }

        // Route based on budget type
        switch (budget.type) {
          case 'TimeAndMaterials':
            return route.toTask('invoiceTimeAndMaterials')
          case 'FixedFee':
            return route.toTask('invoiceFixedFee')
          case 'Retainer':
            return route.toTask('invoiceRecurring')
          default:
            // Default to TimeAndMaterials if unknown type
            return route.toTask('invoiceTimeAndMaterials')
        }
      })
  )
  .connectTask('invoiceTimeAndMaterials', (to) => to.task('reviewDraft'))
  .connectTask('invoiceFixedFee', (to) => to.task('reviewDraft'))
  .connectTask('invoiceMilestone', (to) => to.task('reviewDraft'))
  .connectTask('invoiceRecurring', (to) => to.task('reviewDraft'))
  .connectTask('reviewDraft', (to) =>
    to
      .task('editDraft')
      .task('finalizeInvoice')
      .route(async ({ mutationCtx, route, workItem }) => {
        // Get all work item IDs for this task
        const workItemIds = await workItem.getAllWorkItemIds()

        // Fetch all metadata documents for deterministic ordering
        // TENET-ROUTING-DETERMINISM: In looped workflows (reviewDraft → editDraft → reviewDraft),
        // we must read the most recent review decision to avoid routing based on stale data
        const allMetadata = await Promise.all(
          workItemIds.map(id => DealToDeliveryWorkItemHelpers.getWorkItemMetadata(mutationCtx.db, id))
        )

        // Sort by _creationTime descending (most recent first) for deterministic routing
        const sortedMetadata = allMetadata
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .sort((a, b) => b._creationTime - a._creationTime)

        // Find the most recent work item with an approval decision
        for (const metadata of sortedMetadata) {
          if (metadata.payload.type === 'reviewDraft' && metadata.payload.approved !== undefined) {
            if (metadata.payload.approved === true) {
              // Draft approved - proceed to finalization
              return route.toTask('finalizeInvoice')
            } else {
              // Draft needs edits - route to editDraft
              return route.toTask('editDraft')
            }
          }
        }

        // Fallback: if no decision found, default to finalize (happy path)
        // This should not happen in normal operation
        return route.toTask('finalizeInvoice')
      })
  )
  .connectTask('editDraft', (to) => to.task('reviewDraft'))
  .connectTask('finalizeInvoice', (to) => to.condition('end'))