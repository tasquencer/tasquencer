import type { AuthScope } from '../types/input.js'
import type { GeneratedFile, NamingConventions } from '../types/output.js'
import { toCamelCase } from '../core/naming.js'

/**
 * Generate the scopes.ts file from AuthScope array
 *
 * Scopes with format "workflow:module:scope" or "workflow:module:submodule:scope"
 * are structured as nested modules. The last segment becomes the scope name,
 * and preceding segments (after the workflow name) become nested modules.
 */
export function generateScopesFile(
  scopes: AuthScope[],
  names: NamingConventions
): GeneratedFile {
  const { workflowName, scopeModuleName, displayName } = names

  const scopeTree = buildScopeTree(scopes, workflowName)
  const nestedModules = generateNestedModules(scopeTree)
  const nestedModuleRefs = Array.from(scopeTree.children.values())
    .map((child) => `  .withNestedModule(${moduleVarName([child.name])})`)
    .join('\n')

  const content = `import { createScopeModule } from '@repo/tasquencer'

${nestedModules}
export const ${scopeModuleName} = createScopeModule('${workflowName}')
  .withScope('staff', {
    description: 'Base scope for ${displayName} workflow staff members',
    tags: ['${workflowName}', 'staff'],
  })
${nestedModuleRefs}
`

  return {
    relativePath: 'scopes.ts',
    content,
  }
}

interface ParsedScope {
  name: string
  description: string
  tags: string[]
}

interface ScopeNode {
  name: string
  scopes: ParsedScope[]
  children: Map<string, ScopeNode>
}

function buildScopeTree(scopes: AuthScope[], workflowName: string): ScopeNode {
  const root: ScopeNode = {
    name: workflowName,
    scopes: [],
    children: new Map(),
  }

  for (const scope of scopes) {
    const parts = scope.name.split(':').filter(Boolean)
    const trimmed =
      parts[0] === workflowName ? parts.slice(1) : parts

    if (trimmed.length === 0) {
      continue
    }

    const modulePath = trimmed.slice(0, -1)
    const scopeName = trimmed[trimmed.length - 1]!
    const tags = [...modulePath, scopeName]

    let current = root
    for (const segment of modulePath) {
      const existing = current.children.get(segment)
      if (existing) {
        current = existing
      } else {
        const next: ScopeNode = {
          name: segment,
          scopes: [],
          children: new Map(),
        }
        current.children.set(segment, next)
        current = next
      }
    }

    current.scopes.push({
      name: scopeName,
      description: scope.description,
      tags,
    })
  }

  return root
}

function generateNestedModules(scopeTree: ScopeNode): string {
  const modules: string[] = []

  for (const child of scopeTree.children.values()) {
    collectModules(child, [child.name], modules)
  }

  return modules.join('\n')
}

function collectModules(node: ScopeNode, path: string[], modules: string[]): void {
  for (const child of node.children.values()) {
    collectModules(child, [...path, child.name], modules)
  }

  const moduleName = moduleVarName(path)
  const scopeDefs = node.scopes
    .map((scope) => {
      const tags = scope.tags.map((tag) => `'${tag}'`).join(', ')
      return `  .withScope('${scope.name}', {
    description: '${escapeString(scope.description)}',
    tags: [${tags}],
  })`
    })
    .join('\n')

  const nestedModuleRefs = Array.from(node.children.values())
    .map((child) => `  .withNestedModule(${moduleVarName([...path, child.name])})`)
    .join('\n')

  const chainParts = [scopeDefs, nestedModuleRefs].filter(Boolean).join('\n')

  modules.push(`const ${moduleName} = createScopeModule('${node.name}')
${chainParts}
`)
}

function escapeString(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, '\\n')
}

function moduleVarName(path: string[]): string {
  return `${toCamelCase(path.join('-'))}ScopeModule`
}
