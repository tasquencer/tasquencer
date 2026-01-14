import { makeGetWorkflowStructureQuery } from '@repo/tasquencer'

// Import version managers here after scaffolding:
// import { workflowVersionManager } from './<name>/definition'

export const { getWorkflowStructure, genericGetWorkflowStructure } =
  makeGetWorkflowStructureQuery([
    // Register version managers here:
    // workflowVersionManager,
  ])
