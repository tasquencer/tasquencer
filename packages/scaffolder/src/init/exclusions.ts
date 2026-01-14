import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Files and directories that are always excluded
 */
const ALWAYS_EXCLUDE = [
  'node_modules',
  '.git',
  '.DS_Store',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'convex/_generated',
  '.cache',
  '.vercel',
  '.output',
  '.vinxi',
  '.nitro',
  '.tanstack',
  'dist',
  'build',
]

/**
 * Parse .gitignore file and return patterns
 */
function parseGitignore(gitignorePath: string): string[] {
  if (!existsSync(gitignorePath)) {
    return []
  }

  const content = readFileSync(gitignorePath, 'utf-8')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/**
 * Get all exclusion patterns for a template directory
 */
export function getExclusionPatterns(templateDir: string): string[] {
  const gitignorePatterns = parseGitignore(join(templateDir, '.gitignore'))
  return [...new Set([...ALWAYS_EXCLUDE, ...gitignorePatterns])]
}

/**
 * Check if a relative path should be excluded based on patterns
 */
export function shouldExclude(relativePath: string, patterns: string[]): boolean {
  const parts = relativePath.split('/')

  for (const pattern of patterns) {
    // Direct match on any path segment
    if (parts.includes(pattern)) {
      return true
    }

    // Check if path starts with pattern (for directories)
    if (relativePath.startsWith(pattern + '/') || relativePath === pattern) {
      return true
    }

    // Simple glob matching for patterns ending with *
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1)
      if (relativePath.startsWith(prefix)) {
        return true
      }
    }
  }

  return false
}
