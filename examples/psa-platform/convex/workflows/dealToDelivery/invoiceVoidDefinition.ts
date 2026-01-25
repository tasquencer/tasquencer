/**
 * Invoice Void Workflow Definition
 *
 * Registers the invoice void workflow with the version manager.
 * This workflow is used to void invoices outside the normal billing flow,
 * providing TENET-WF-EXEC compliance for invoice status transitions.
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { versionManagerFor } from '../../tasquencer'
import { invoiceVoidWorkflow } from './workflows/invoiceVoid.workflow'

export const invoiceVoidVersionManager = versionManagerFor('invoiceVoid')
  .registerVersion('v1', invoiceVoidWorkflow)
  .build()
