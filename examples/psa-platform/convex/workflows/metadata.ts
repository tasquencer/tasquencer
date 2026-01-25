import { makeGetWorkflowStructureQuery } from '@repo/tasquencer'

import { dealToDeliveryVersionManager } from "./dealToDelivery/definition";
import { invoiceVoidVersionManager } from "./dealToDelivery/invoiceVoidDefinition";

// Import version managers here after scaffolding:
// import { workflowVersionManager } from './<name>/definition'

export const { getWorkflowStructure, genericGetWorkflowStructure } =
  makeGetWorkflowStructureQuery([dealToDeliveryVersionManager, invoiceVoidVersionManager])
