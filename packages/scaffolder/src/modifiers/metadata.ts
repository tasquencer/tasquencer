import type { namedTypes } from 'ast-types'
import type { NamingConventions, FileModification } from '../types/output.js'
import {
  parseTypeScript,
  printAST,
  findLastImportIndex,
  createNamedImport,
  builders as b,
  recast,
} from '../utils/ast.js'

/**
 * Modify metadata.ts to add a new version manager
 *
 * Adds:
 * 1. Import statement for the version manager
 * 2. Version manager to the makeGetWorkflowStructureQuery array
 */
export function modifyMetadata(
  source: string,
  filePath: string,
  names: NamingConventions
): FileModification {
  const ast = parseTypeScript(source)
  const program = ast.program as namedTypes.Program

  // 1. Add import after the last version manager import
  const importSource = `./${names.directoryName}/definition`
  const newImport = createNamedImport(names.versionManagerName, importSource)

  if (!hasNamedImport(program, names.versionManagerName, importSource)) {
    const lastImportIndex = findLastImportIndex(program.body)
    program.body.splice(lastImportIndex + 1, 0, newImport)
  }

  // 2. Find makeGetWorkflowStructureQuery call and add to the array
  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee
      if (callee.type === 'Identifier' && callee.name === 'makeGetWorkflowStructureQuery') {
        // First argument should be an array
        const arrayArg = path.node.arguments[0] as namedTypes.ArrayExpression
        if (arrayArg && arrayArg.type === 'ArrayExpression') {
          const alreadyAdded = arrayArg.elements.some(
            (element) =>
              element?.type === 'Identifier' &&
              element.name === names.versionManagerName
          )
          if (!alreadyAdded) {
            arrayArg.elements.push(b.identifier(names.versionManagerName))
          }
        }
        return false
      }
      this.traverse(path)
      return undefined
    },
  })

  const modified = printAST(ast)

  return {
    filePath,
    content: modified,
    description: `Added ${names.versionManagerName} to makeGetWorkflowStructureQuery`,
  }
}

function hasNamedImport(
  program: namedTypes.Program,
  importName: string,
  importSource: string
): boolean {
  return program.body.some((node) => {
    if (node.type !== 'ImportDeclaration') {
      return false
    }
    if (
      node.source.type !== 'StringLiteral' ||
      node.source.value !== importSource
    ) {
      return false
    }
    return node.specifiers?.some(
      (specifier) =>
        specifier.type === 'ImportSpecifier' &&
        specifier.imported.type === 'Identifier' &&
        specifier.imported.name === importName
    )
  })
}
