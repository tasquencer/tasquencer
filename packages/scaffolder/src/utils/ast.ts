import * as recast from 'recast'
import tsParser from 'recast/parsers/typescript.js'
import type { namedTypes } from 'ast-types'

const b = recast.types.builders

/**
 * Parse TypeScript source code into an AST
 */
export function parseTypeScript(source: string): namedTypes.File {
  return recast.parse(source, { parser: tsParser }) as namedTypes.File
}

/**
 * Print AST back to source code, preserving formatting where possible
 */
export function printAST(ast: recast.types.ASTNode): string {
  return recast.print(ast).code
}

/**
 * Find the index of the last import declaration in the program body
 */
export function findLastImportIndex(body: namedTypes.Program['body']): number {
  let lastIndex = -1
  for (let i = 0; i < body.length; i++) {
    const node = body[i]
    if (node && node.type === 'ImportDeclaration') {
      lastIndex = i
    }
  }
  return lastIndex
}

/**
 * Create a named import declaration
 * e.g., import { foo } from './bar'
 */
export function createNamedImport(
  specifierName: string,
  source: string
): namedTypes.ImportDeclaration {
  return b.importDeclaration(
    [b.importSpecifier(b.identifier(specifierName))],
    b.stringLiteral(source)
  ) as namedTypes.ImportDeclaration
}

/**
 * Create a default import declaration
 * e.g., import foo from './bar'
 */
export function createDefaultImport(
  specifierName: string,
  source: string
): namedTypes.ImportDeclaration {
  return b.importDeclaration(
    [b.importDefaultSpecifier(b.identifier(specifierName))],
    b.stringLiteral(source)
  ) as namedTypes.ImportDeclaration
}

/**
 * Find a call expression by the callee name
 */
export function findCallExpression(
  ast: recast.types.ASTNode,
  calleeName: string
): namedTypes.CallExpression | null {
  let found: namedTypes.CallExpression | null = null

  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee
      if (callee.type === 'Identifier' && callee.name === calleeName) {
        found = path.node
        return false
      }
      if (callee.type === 'MemberExpression') {
        // Check if it's a method chain ending with the name
        let current: namedTypes.MemberExpression | namedTypes.Identifier = callee
        while (current.type === 'MemberExpression') {
          if (
            current.property.type === 'Identifier' &&
            current.property.name === calleeName
          ) {
            found = path.node
            return false
          }
          current = current.object as
            | namedTypes.MemberExpression
            | namedTypes.Identifier
        }
      }
      this.traverse(path)
      return undefined
    },
  })

  return found
}

/**
 * Find a variable declaration by name
 */
export function findVariableDeclaration(
  ast: recast.types.ASTNode,
  name: string
): recast.types.namedTypes.VariableDeclarator | null {
  let found: recast.types.namedTypes.VariableDeclarator | null = null

  recast.visit(ast, {
    visitVariableDeclarator(path) {
      const id = path.node.id
      if (id.type === 'Identifier' && id.name === name) {
        found = path.node
        return false
      }
      this.traverse(path)
      return undefined
    },
  })

  return found
}

/**
 * Add an element to an array expression
 */
export function addToArrayExpression(
  array: namedTypes.ArrayExpression,
  element: namedTypes.Identifier | namedTypes.SpreadElement
): void {
  array.elements.push(element)
}

/**
 * Add a spread element to an object expression
 */
export function addSpreadToObject(
  obj: namedTypes.ObjectExpression,
  spreadName: string
): void {
  obj.properties.push(b.spreadElement(b.identifier(spreadName)))
}

/**
 * Create an identifier node
 */
export function createIdentifier(name: string): namedTypes.Identifier {
  return b.identifier(name) as namedTypes.Identifier
}

/**
 * Create a spread element node
 */
export function createSpreadElement(name: string): namedTypes.SpreadElement {
  return b.spreadElement(b.identifier(name)) as namedTypes.SpreadElement
}

/**
 * Get the recast builders for advanced AST manipulation
 */
export { b as builders }
export { recast }
