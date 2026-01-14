import { describe, expect, it } from 'vitest'
import { generateScopesFile } from '../generators/scopes.js'
import { generateNames } from '../core/naming.js'

describe('generateScopesFile', () => {
  it('nests modules by colon segments and keeps scopes on leaf modules', () => {
    const names = generateNames('er')
    const result = generateScopesFile(
      [
        {
          name: 'er:nurse:triage:write',
          description: 'Write triage assessment',
        },
        {
          name: 'er:nurse:triage:read',
          description: 'Read triage assessment',
        },
        {
          name: 'er:billing:read',
          description: 'Read billing info',
        },
      ],
      names
    )

    expect(result.content).toEqual(`import { createScopeModule } from '@repo/tasquencer'

const nurseTriageScopeModule = createScopeModule('triage')
  .withScope('write', {
    description: 'Write triage assessment',
    tags: ['nurse', 'triage', 'write'],
  })
  .withScope('read', {
    description: 'Read triage assessment',
    tags: ['nurse', 'triage', 'read'],
  })

const nurseScopeModule = createScopeModule('nurse')
  .withNestedModule(nurseTriageScopeModule)

const billingScopeModule = createScopeModule('billing')
  .withScope('read', {
    description: 'Read billing info',
    tags: ['billing', 'read'],
  })

export const erScopeModule = createScopeModule('er')
  .withScope('staff', {
    description: 'Base scope for Er workflow staff members',
    tags: ['er', 'staff'],
  })
  .withNestedModule(nurseScopeModule)
  .withNestedModule(billingScopeModule)
`)
  })

  it('avoids colons in generated scope names', () => {
    const names = generateNames('er')
    const result = generateScopesFile(
      [
        {
          name: 'er:nurse:triage:write',
          description: 'Write triage assessment',
        },
      ],
      names
    )

    expect(result.content).toEqual(`import { createScopeModule } from '@repo/tasquencer'

const nurseTriageScopeModule = createScopeModule('triage')
  .withScope('write', {
    description: 'Write triage assessment',
    tags: ['nurse', 'triage', 'write'],
  })

const nurseScopeModule = createScopeModule('nurse')
  .withNestedModule(nurseTriageScopeModule)

export const erScopeModule = createScopeModule('er')
  .withScope('staff', {
    description: 'Base scope for Er workflow staff members',
    tags: ['er', 'staff'],
  })
  .withNestedModule(nurseScopeModule)
`)
  })
})
