import { existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InitOptions, InitResult } from './types.js'
import { generateSubstitutions } from './substitution.js'
import { copyTemplate } from './copier.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Get the template directory path
 * Template is at packages/app-template relative to packages/scaffolder
 */
export function getTemplateDir(): string {
  // From dist/init/index.js, go up to packages/scaffolder, then to packages/app-template
  return resolve(__dirname, '../../../app-template')
}

/**
 * Initialize a new Tasquencer application from template
 */
export async function initApp(options: InitOptions): Promise<InitResult> {
  const { targetDir, appName, dryRun } = options
  const errors: string[] = []

  // Validate template exists
  const templateDir = getTemplateDir()
  if (!existsSync(templateDir)) {
    return {
      createdFiles: [],
      skippedFiles: [],
      errors: [`Template directory not found: ${templateDir}`],
    }
  }

  // Check if target directory exists and has files
  if (existsSync(targetDir)) {
    const contents = readdirSync(targetDir)
    const nonHiddenFiles = contents.filter((f) => !f.startsWith('.'))
    if (nonHiddenFiles.length > 0) {
      errors.push(
        `Target directory is not empty: ${targetDir}. Use an empty directory or specify a new path.`
      )
      return {
        createdFiles: [],
        skippedFiles: [],
        errors,
      }
    }
  }

  // Generate substitutions
  const substitutions = generateSubstitutions(appName)

  // Copy template with substitutions
  const { createdFiles, skippedFiles } = copyTemplate({
    templateDir,
    targetDir,
    substitutions,
    dryRun,
  })

  return {
    createdFiles,
    skippedFiles,
    errors,
  }
}

export type { InitOptions, InitResult } from './types.js'
