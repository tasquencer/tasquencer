/**
 * Invoice Void Workflow
 *
 * A standalone workflow for voiding invoices outside the normal billing flow.
 * Per TENET-WF-EXEC, invoice status transitions should be work item-driven
 * for proper audit trail through the Tasquencer workflow system.
 *
 * This workflow can be initialized at any time to void an invoice that's in
 * Finalized, Sent, or Viewed status.
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { Builder } from '../../../tasquencer'
import { voidInvoiceTask } from '../workItems/voidInvoice.workItem'

/**
 * The invoiceVoid workflow.
 *
 * Simple single-task workflow:
 * start → voidInvoice → end
 *
 * This workflow exists to provide TENET-WF-EXEC compliance for invoice voiding,
 * which is an "escape hatch" operation that can happen at any point after
 * an invoice is finalized.
 */
export const invoiceVoidWorkflow = Builder.workflow('invoiceVoid')
  .startCondition('start')
  .endCondition('end')
  .task('voidInvoice', voidInvoiceTask)
  .connectCondition('start', (to) => to.task('voidInvoice'))
  .connectTask('voidInvoice', (to) => to.condition('end'))
