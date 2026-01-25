import { defineSchema } from 'convex/server'
import { schema as tasquencerTables } from '@repo/tasquencer'

import dealToDeliveryTables from "./workflows/dealToDelivery/schema";

// Import workflow tables here after scaffolding:
// import workflowTables from './workflows/<name>/schema'

export default defineSchema({
  // Spread workflow tables here:
  // ...workflowTables,
  ...tasquencerTables,

  // Deal-to-delivery workflow tables (includes users, organizations, etc.)
  ...dealToDeliveryTables
})
