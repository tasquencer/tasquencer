/**
 * Helper functions for generating code templates
 */

/**
 * Indent a string by a number of spaces
 */
export function indent(str: string, spaces: number): string {
  const indentation = ' '.repeat(spaces)
  return str
    .split('\n')
    .map((line) => (line.trim() ? indentation + line : line))
    .join('\n')
}

/**
 * Generate an import statement
 */
export function generateImport(
  names: string | string[],
  from: string,
  isDefault = false
): string {
  const nameList = Array.isArray(names) ? names : [names]

  if (isDefault) {
    return `import ${nameList[0]} from '${from}'`
  }

  return `import { ${nameList.join(', ')} } from '${from}'`
}

/**
 * Generate multiple import statements grouped by source
 */
export function generateImports(
  imports: Array<{ names: string[]; from: string; isDefault?: boolean }>
): string {
  return imports.map((i) => generateImport(i.names, i.from, i.isDefault)).join('\n')
}

/**
 * Wrap text in a template literal for multi-line strings
 */
export function templateLiteral(content: string): string {
  return '`' + content + '`'
}

/**
 * Generate a comment block
 */
export function generateComment(comment: string, isBlock = false): string {
  if (isBlock) {
    return `/**\n * ${comment}\n */`
  }
  return `// ${comment}`
}

/**
 * Generate an async arrow function
 */
export function asyncArrowFunction(
  params: string,
  body: string,
  inline = false
): string {
  if (inline) {
    return `async (${params}) => ${body}`
  }
  return `async (${params}) => {\n${indent(body, 2)}\n}`
}

/**
 * Quote a string value
 */
export function quote(str: string): string {
  return `'${str}'`
}

/**
 * Join array elements with proper formatting
 */
export function joinLines(lines: string[], separator = '\n'): string {
  return lines.filter(Boolean).join(separator)
}
