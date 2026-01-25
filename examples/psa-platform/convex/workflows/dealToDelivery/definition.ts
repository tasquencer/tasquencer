/**
 * Deal to Delivery Workflow Definition
 *
 * This file registers the workflow versions with the version manager.
 * The workflow APIs are exported from ./api/workflow.ts
 *
 * Reference: .review/recipes/psa-platform/specs/14-workflow-master.md
 */
import { versionManagerFor } from '../../tasquencer'
import { dealToDeliveryWorkflow } from './workflows/dealToDelivery.workflow'

export const dealToDeliveryVersionManager = versionManagerFor('dealToDelivery')
  .registerVersion('v1', dealToDeliveryWorkflow)
  .build()
