/**
 * Invoice Void Workflow API
 *
 * Provides APIs for voiding invoices via the Tasquencer workflow system.
 * This ensures TENET-WF-EXEC compliance with proper audit trails.
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { invoiceVoidVersionManager } from '../invoiceVoidDefinition'

export const {
  initializeRootWorkflow: initializeInvoiceVoidWorkflow,
  internalInitializeRootWorkflow: internalInitializeInvoiceVoidWorkflow,
  internalInitializeWorkItem: internalInitializeInvoiceVoidWorkItem,
  internalStartWorkItem: internalStartInvoiceVoidWorkItem,
  internalCompleteWorkItem: internalCompleteInvoiceVoidWorkItem,
  helpers: { getWorkflowTaskStates: getInvoiceVoidTaskStates },
} = invoiceVoidVersionManager.apiForVersion('v1')
