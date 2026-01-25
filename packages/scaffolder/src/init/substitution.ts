/**
 * Generate substitutions map from app name
 */
export function generateSubstitutions(appName: string): Map<string, string> {
  const substitutions = new Map<string, string>()

  // {{APP_NAME}} - original name
  substitutions.set('{{APP_NAME}}', appName)

  // {{PACKAGE_NAME}} - kebab-case for package.json name
  substitutions.set('{{PACKAGE_NAME}}', toKebabCase(appName))

  // {{APP_TITLE}} - title case for display
  substitutions.set('{{APP_TITLE}}', toTitleCase(appName))

  return substitutions
}

/**
 * Apply substitutions to content string
 */
export function applySubstitutions(
  content: string,
  substitutions: Map<string, string>
): string {
  let result = content
  for (const [placeholder, value] of substitutions) {
    result = result.replaceAll(placeholder, value)
  }
  return result
}

/**
 * Convert string to kebab-case
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * Convert string to Title Case
 */
function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
