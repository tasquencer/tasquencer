import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import type {
  ScaffolderInput,
  ExtractedWorkflow,
  AuthScope,
} from '../types/input.js'
import type {
  ScaffolderConfig,
  ScaffoldResult,
  GeneratedFile,
  FileModification,
  NamingConventions,
} from '../types/output.js'
import { scaffolderInputSchema } from '../types/input.js'
import { generateNames } from './naming.js'
import { sanitizeScaffolderInput } from './sanitize.js'
import {
  generateWorkflowFile,
  generateWorkItemFiles,
  generateScopesFile,
  generateDefinitionFile,
  generateSchemaFile,
} from '../generators/index.js'
import {
  modifyAppAuthorization,
  modifyMetadata,
  modifySchema,
} from '../modifiers/index.js'

const DEFAULT_CONFIG: Required<ScaffolderConfig> = {
  outputDir: './convex',
  dryRun: false,
  workflowsDir: 'workflows',
  appAuthorizationPath: 'authorization.ts',
  metadataPath: 'workflows/metadata.ts',
  schemaPath: 'schema.ts',
}

export class Scaffolder {
  private config: Required<ScaffolderConfig>

  constructor(config: ScaffolderConfig) {
    const merged = { ...DEFAULT_CONFIG, ...config }
    this.config = {
      ...merged,
      outputDir: isAbsolute(merged.outputDir)
        ? merged.outputDir
        : resolve(process.cwd(), merged.outputDir),
    }
  }

  /**
   * Generate workflow code from designer output
   */
  async generate(input: ScaffolderInput): Promise<ScaffoldResult> {
    const result: ScaffoldResult = {
      createdFiles: [],
      modifiedFiles: [],
      warnings: [],
      errors: [],
    }

    try {
      // Validate input
      const validationResult = scaffolderInputSchema.safeParse(input)
      if (!validationResult.success) {
        result.errors.push(`Invalid input: ${validationResult.error.message}`)
        return result
      }

      const sanitizedInput = sanitizeScaffolderInput(input)
      const { mainWorkflow, subWorkflows = [], scopes } = sanitizedInput
      const allWorkflows = [mainWorkflow, ...subWorkflows]
      const names = generateNames(mainWorkflow.name)

      // Generate files
      const generatedFiles = this.generateAllFiles(
        mainWorkflow,
        allWorkflows,
        scopes,
        names
      )
      result.createdFiles.push(...generatedFiles)

      // Modify registration files
      const modifications = this.generateModifications(names)
      result.modifiedFiles.push(...modifications)

      // Write files if not dry run
      if (!this.config.dryRun) {
        this.writeGeneratedFiles(generatedFiles, names)
        this.applyModifications(modifications)
      }
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      )
    }

    return result
  }

  private generateAllFiles(
    mainWorkflow: ExtractedWorkflow,
    allWorkflows: ExtractedWorkflow[],
    scopes: AuthScope[],
    names: NamingConventions
  ): GeneratedFile[] {
    const files: GeneratedFile[] = []

    // Generate workflow files for all workflows
    for (const workflow of allWorkflows) {
      files.push(generateWorkflowFile(workflow, allWorkflows))
    }

    // Generate work item files for all workflows
    for (const workflow of allWorkflows) {
      files.push(...generateWorkItemFiles(workflow.tasks))
    }

    // Generate scopes file
    files.push(generateScopesFile(scopes, names))

    // Generate definition file
    files.push(generateDefinitionFile(mainWorkflow, names))

    // Generate schema file
    files.push(generateSchemaFile(names))

    return files
  }

  private generateModifications(names: NamingConventions): FileModification[] {
    const modifications: FileModification[] = []

    // Modify appAuthorization.ts
    const appAuthPath = join(this.config.outputDir, this.config.appAuthorizationPath)
    if (existsSync(appAuthPath)) {
      const source = readFileSync(appAuthPath, 'utf-8')
      modifications.push(modifyAppAuthorization(source, appAuthPath, names))
    }

    // Modify metadata.ts
    const metadataPath = join(this.config.outputDir, this.config.metadataPath)
    if (existsSync(metadataPath)) {
      const source = readFileSync(metadataPath, 'utf-8')
      modifications.push(modifyMetadata(source, metadataPath, names))
    }

    // Modify schema.ts
    const schemaPath = join(this.config.outputDir, this.config.schemaPath)
    if (existsSync(schemaPath)) {
      const source = readFileSync(schemaPath, 'utf-8')
      modifications.push(modifySchema(source, schemaPath, names))
    }

    return modifications
  }

  private writeGeneratedFiles(
    files: GeneratedFile[],
    names: NamingConventions
  ): void {
    const workflowDir = join(
      this.config.outputDir,
      this.config.workflowsDir,
      names.directoryName
    )

    for (const file of files) {
      const fullPath = join(workflowDir, file.relativePath)
      const dir = dirname(fullPath)

      // Ensure directory exists
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(fullPath, file.content, 'utf-8')
    }
  }

  private applyModifications(modifications: FileModification[]): void {
    for (const mod of modifications) {
      writeFileSync(mod.filePath, mod.content, 'utf-8')
    }
  }
}

/**
 * Create a new scaffolder instance
 */
export function createScaffolder(config: ScaffolderConfig): Scaffolder {
  return new Scaffolder(config)
}
