#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScaffolder } from './core/scaffolder.js'
import { scaffolderInputSchema } from './types/input.js'
import { initApp, getTemplateDir } from './init/index.js'

const program = new Command()

const invocationCwd = process.env.INIT_CWD || process.cwd()

program
  .name('tasquencer-scaffold')
  .description('Generate tasquencer workflow code from designer output')
  .version('1.0.0')

program
  .command('generate')
  .description('Generate workflow files from JSON input')
  .option('-i, --input <file>', 'Input JSON file path')
  .option('-o, --output <dir>', 'Output directory', './convex')
  .option('-d, --dry-run', 'Preview changes without writing files')
  .option('-c, --config <file>', 'Config file path')
  .action(async (options) => {
    try {
      let input: unknown

      // Read input from file or stdin
      if (options.input) {
        const inputPath = resolve(invocationCwd, options.input)
        const content = readFileSync(inputPath, 'utf-8')
        input = JSON.parse(content)
      } else {
        // Read from stdin
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) {
          chunks.push(chunk)
        }
        const content = Buffer.concat(chunks).toString('utf-8')
        input = JSON.parse(content)
      }

      // Validate input
      const validationResult = scaffolderInputSchema.safeParse(input)
      if (!validationResult.success) {
        console.error('Invalid input:')
        console.error(validationResult.error.format())
        process.exit(1)
      }

      // Create scaffolder and generate
      const scaffolder = createScaffolder({
        outputDir: resolve(invocationCwd, options.output),
        dryRun: options.dryRun || false,
      })

      const result = await scaffolder.generate(validationResult.data)

      // Output results
      if (result.errors.length > 0) {
        console.error('Errors:')
        for (const error of result.errors) {
          console.error(`  - ${error}`)
        }
        process.exit(1)
      }

      if (result.warnings.length > 0) {
        console.warn('Warnings:')
        for (const warning of result.warnings) {
          console.warn(`  - ${warning}`)
        }
      }

      const action = options.dryRun ? 'Would create' : 'Created'
      const modifyAction = options.dryRun ? 'Would modify' : 'Modified'

      console.log(`\n${action} files:`)
      for (const file of result.createdFiles) {
        console.log(`  - ${file.relativePath}`)
      }

      if (result.modifiedFiles.length > 0) {
        console.log(`\n${modifyAction} files:`)
        for (const file of result.modifiedFiles) {
          console.log(`  - ${file.filePath} (${file.description})`)
        }
      }

      if (options.dryRun) {
        console.log('\n(dry run - no files were written)')
      } else {
        console.log('\nScaffolding complete!')
        console.log('\nNext steps:')
        console.log('1. Review generated files and implement TODO comments')
        console.log('2. Run `npx convex dev` to verify compilation')
        console.log('3. Implement domain logic in schema.ts')
        console.log('4. Complete work item handlers')
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command('validate')
  .description('Validate a JSON input file without generating')
  .argument('<file>', 'Input JSON file path')
  .action((file) => {
    try {
      const inputPath = resolve(process.cwd(), file)
      const content = readFileSync(inputPath, 'utf-8')
      const input = JSON.parse(content)

      const result = scaffolderInputSchema.safeParse(input)
      if (result.success) {
        console.log('Input is valid!')
        console.log(`Main workflow: ${result.data.mainWorkflow.name}`)
        console.log(`Tasks: ${result.data.mainWorkflow.tasks.length}`)
        console.log(`Conditions: ${result.data.mainWorkflow.conditions.length}`)
        console.log(`Flows: ${result.data.mainWorkflow.flows.length}`)
        console.log(`Scopes: ${result.data.scopes.length}`)
        if (result.data.subWorkflows) {
          console.log(`Subworkflows: ${result.data.subWorkflows.length}`)
        }
      } else {
        console.error('Validation failed:')
        console.error(result.error.format())
        process.exit(1)
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program
  .command('init')
  .description('Initialize a new Tasquencer application')
  .argument('[target-dir]', 'Target directory', '.')
  .requiredOption('-n, --name <name>', 'Application name')
  .option('-d, --dry-run', 'Preview changes without writing files')
  .action(async (targetDir: string, options: { name: string; dryRun?: boolean }) => {
    try {
      const resolvedTarget = resolve(invocationCwd, targetDir)

      console.log('\nInitializing new Tasquencer application...\n')
      console.log(`  App name: ${options.name}`)
      console.log(`  Target: ${resolvedTarget}`)
      console.log(`  Template: ${getTemplateDir()}`)

      const result = await initApp({
        targetDir: resolvedTarget,
        appName: options.name,
        dryRun: options.dryRun || false,
      })

      if (result.errors.length > 0) {
        console.error('\nErrors:')
        for (const error of result.errors) {
          console.error(`  - ${error}`)
        }
        process.exit(1)
      }

      const action = options.dryRun ? 'Would create' : 'Created'

      console.log(`\n${action} ${result.createdFiles.length} files:`)
      for (const file of result.createdFiles.slice(0, 10)) {
        console.log(`  - ${file}`)
      }
      if (result.createdFiles.length > 10) {
        console.log(`  ... and ${result.createdFiles.length - 10} more files`)
      }

      if (options.dryRun) {
        console.log('\n(dry run - no files were written)')
      } else {
        console.log('\nInitialization complete!')
        console.log('\nNext steps:')
        console.log(`  1. cd ${targetDir === '.' ? '.' : targetDir}`)
        console.log('  2. pnpm install')
        console.log('  3. npx convex dev')
        console.log('  4. pnpm dev')
        console.log('\nTo add a workflow:')
        console.log('  pnpm scaffolder generate -i workflow.json -o ./convex')
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program.parse()
