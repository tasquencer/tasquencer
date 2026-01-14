import type { namedTypes } from 'ast-types'
import type { NamingConventions, FileModification } from '../types/output.js'
import {
  parseTypeScript,
  printAST,
  findLastImportIndex,
  createDefaultImport,
  builders as b,
  recast,
} from '../utils/ast.js'

/**
 * Modify schema.ts to add new workflow tables
 *
 * Adds:
 * 1. Default import for the tables
 * 2. Spread of tables in the defineSchema call
 */
export function modifySchema(
  source: string,
  filePath: string,
  names: NamingConventions
): FileModification {
  const ast = parseTypeScript(source)
  const program = ast.program as namedTypes.Program

  // 1. Add import after the last workflow tables import
  const importSource = `./workflows/${names.directoryName}/schema`
  const newImport = createDefaultImport(names.tablesName, importSource)

  if (!hasDefaultImport(program, names.tablesName, importSource)) {
    const lastImportIndex = findLastImportIndex(program.body)
    program.body.splice(lastImportIndex + 1, 0, newImport)
  }

  // 2. Find defineSchema call and add spread to the object
  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee
      if (callee.type === 'Identifier' && callee.name === 'defineSchema') {
        // First argument should be an object
        const objectArg = path.node.arguments[0] as namedTypes.ObjectExpression
        if (objectArg && objectArg.type === 'ObjectExpression') {
          const alreadyAdded = objectArg.properties.some(
            (property) =>
              property.type === 'SpreadElement' &&
              property.argument.type === 'Identifier' &&
              property.argument.name === names.tablesName
          )
          if (!alreadyAdded) {
            objectArg.properties.push(
              b.spreadElement(b.identifier(names.tablesName))
            )
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
    description: `Added ${names.tablesName} spread to defineSchema`,
  }
}

function hasDefaultImport(
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
        specifier.type === 'ImportDefaultSpecifier' &&
        specifier.local?.name === importName
    )
  })
}
