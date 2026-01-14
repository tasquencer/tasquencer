import { defineSchema, defineTable } from 'convex/server'
import { schema as tasquencerTables } from '@repo/tasquencer'

// Import workflow tables here after scaffolding:
// import workflowTables from './workflows/<name>/schema'

const users = defineTable({})

export default defineSchema({
  users,
  ...tasquencerTables,
  // Spread workflow tables here:
  // ...workflowTables,
})
