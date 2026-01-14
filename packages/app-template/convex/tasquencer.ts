import type { DataModel } from './_generated/dataModel'
import { Tasquencer } from '@repo/tasquencer'
import { components } from './_generated/api'

export const { Builder, Authorization, versionManagerFor } =
  Tasquencer.initialize<DataModel>(
    components.tasquencerAudit,
    components.tasquencerAuthorization,
  ).build()
