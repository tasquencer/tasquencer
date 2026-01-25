/**
 * Workflow Engine API Exports
 *
 * This file re-exports the workflow engine mutations and queries for the
 * dealToDelivery workflow. These are the core APIs for:
 * - Initializing workflows
 * - Starting, completing, failing, and canceling work items
 * - Querying workflow state
 *
 * UI components should use these APIs for workflow state changes. For
 * domain-specific operations (like creating a deal), use the mutations
 * in ./deals.ts which wrap these workflow APIs with business logic.
 *
 * Reference: .review/recipes/psa-platform/specs/26-api-endpoints.md
 */
import { dealToDeliveryVersionManager } from '../definition'

export const {
  initializeRootWorkflow,
  cancelRootWorkflow,
  initializeWorkflow,
  cancelWorkflow,
  initializeWorkItem,
  startWorkItem,
  completeWorkItem,
  failWorkItem,
  cancelWorkItem,
  internalInitializeRootWorkflow,
  internalCancelRootWorkflow,
  internalInitializeWorkflow,
  internalCancelWorkflow,
  internalInitializeWorkItem,
  internalStartWorkItem,
  internalCompleteWorkItem,
  internalFailWorkItem,
  internalCancelWorkItem,
  helpers: { getWorkflowTaskStates },
} = dealToDeliveryVersionManager.apiForVersion('v1')
