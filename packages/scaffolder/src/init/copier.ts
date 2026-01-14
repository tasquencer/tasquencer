import {
  readdirSync,
  statSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { getExclusionPatterns, shouldExclude } from './exclusions.js'
import { applySubstitutions } from './substitution.js'

/**
 * Binary file extensions that should not have substitutions applied
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.webm',
  '.ogg',
  '.wav',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
])

export interface CopyOptions {
  templateDir: string
  targetDir: string
  substitutions: Map<string, string>
  dryRun: boolean
}

export interface CopyResult {
  createdFiles: string[]
  skippedFiles: string[]
}

/**
 * Copy template directory to target with substitutions
 */
export function copyTemplate(options: CopyOptions): CopyResult {
  const { templateDir, targetDir, substitutions, dryRun } = options

  const exclusionPatterns = getExclusionPatterns(templateDir)
  const createdFiles: string[] = []
  const skippedFiles: string[] = []

  // Recursively collect all files
  const allFiles = collectFiles(templateDir, templateDir, exclusionPatterns)

  for (const relativePath of allFiles) {
    const sourcePath = join(templateDir, relativePath)
    const targetPath = join(targetDir, relativePath)

    if (shouldExclude(relativePath, exclusionPatterns)) {
      skippedFiles.push(relativePath)
      continue
    }

    if (!dryRun) {
      // Ensure directory exists
      const targetDirPath = dirname(targetPath)
      if (!existsSync(targetDirPath)) {
        mkdirSync(targetDirPath, { recursive: true })
      }

      // Copy file with or without substitutions
      if (isBinaryFile(relativePath)) {
        const content = readFileSync(sourcePath)
        writeFileSync(targetPath, content)
      } else {
        const content = readFileSync(sourcePath, 'utf-8')
        const processed = applySubstitutions(content, substitutions)
        writeFileSync(targetPath, processed, 'utf-8')
      }
    }

    createdFiles.push(relativePath)
  }

  return { createdFiles, skippedFiles }
}

/**
 * Recursively collect all files in a directory
 */
function collectFiles(
  baseDir: string,
  currentDir: string,
  exclusionPatterns: string[]
): string[] {
  const files: string[] = []
  const entries = readdirSync(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name)
    const relativePath = relative(baseDir, fullPath)

    // Skip excluded directories early
    if (shouldExclude(relativePath, exclusionPatterns)) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...collectFiles(baseDir, fullPath, exclusionPatterns))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files
}

/**
 * Check if file is binary based on extension
 */
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}
