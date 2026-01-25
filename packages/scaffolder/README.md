# @repo/scaffolder

A scaffolder for generating Tasquencer workflow code from designer output. This tool takes JSON workflow definitions and generates production-ready TypeScript code for the Tasquencer workflow engine.

## Installation

```bash
pnpm add @repo/scaffolder
```

## CLI Usage

The scaffolder provides three main commands: `init`, `generate`, and `validate`.

### Initialize a New Application

Create a new Tasquencer application from a template:

```bash
# Initialize in current directory
pnpm tasquencer-scaffold init -n my-app

# Initialize in a specific directory
pnpm tasquencer-scaffold init ./my-project -n my-app

# Preview without creating files
pnpm tasquencer-scaffold init -n my-app --dry-run
```

**Options:**
- `-n, --name <name>` (required): Application name
- `-d, --dry-run`: Preview changes without writing files

After initialization:
```bash
cd my-project
pnpm install
pnpm convex dev
pnpm dev
```

### Generate Workflow Code

Generate workflow files from a JSON input file:

```bash
# From a file
pnpm tasquencer-scaffold generate -i workflow.json

# From stdin
cat workflow.json | pnpm tasquencer-scaffold generate

# Specify output directory
pnpm tasquencer-scaffold generate -i workflow.json -o ./convex

# Preview changes
pnpm tasquencer-scaffold generate -i workflow.json --dry-run
```

**Options:**
- `-i, --input <file>`: Input JSON file path (reads from stdin if not provided)
- `-o, --output <dir>`: Output directory (default: `./convex`)
- `-d, --dry-run`: Preview changes without writing files
- `-c, --config <file>`: Config file path

### Validate Input

Validate a workflow JSON file without generating code:

```bash
pnpm tasquencer-scaffold validate workflow.json
```

## Programmatic API

### Basic Usage

```typescript
import { createScaffolder } from '@repo/scaffolder'

const scaffolder = createScaffolder({
  outputDir: './convex',
  dryRun: false,
})

const result = await scaffolder.generate({
  mainWorkflow: {
    name: 'order-processing',
    description: 'Process customer orders',
    tasks: [
      {
        type: 'task',
        name: 'validate-order',
        joinType: 'and',
        splitType: 'and',
        workItem: { name: 'validateOrder' },
      },
      {
        type: 'task',
        name: 'process-payment',
        joinType: 'and',
        splitType: 'xor',
        workItem: { name: 'processPayment' },
      },
    ],
    conditions: [
      { name: 'start', isStartCondition: true, isEndCondition: false, isImplicitCondition: false },
      { name: 'end', isStartCondition: false, isEndCondition: true, isImplicitCondition: false },
    ],
    flows: [
      { type: 'condition->task', from: 'start', to: 'validate-order' },
      { type: 'task->task', from: 'validate-order', to: 'process-payment' },
      { type: 'task->condition', from: 'process-payment', to: 'end' },
    ],
    cancellationRegions: [],
  },
  subWorkflows: [],
  scopes: [
    { name: 'order:read', description: 'Read order data' },
    { name: 'order:write', description: 'Modify order data' },
  ],
})

console.log('Created files:', result.createdFiles)
console.log('Modified files:', result.modifiedFiles)
```

### Configuration Options

```typescript
interface ScaffolderConfig {
  /** Output directory for generated files (e.g., "./convex") */
  outputDir: string

  /** If true, don't actually write files */
  dryRun?: boolean

  /** Path to workflows directory relative to outputDir */
  workflowsDir?: string  // default: 'workflows'

  /** Path to app authorization file relative to outputDir */
  appAuthorizationPath?: string  // default: 'authorization.ts'

  /** Path to metadata file relative to outputDir */
  metadataPath?: string  // default: 'workflows/metadata.ts'

  /** Path to schema file relative to outputDir */
  schemaPath?: string  // default: 'schema.ts'
}
```

### Input Validation

Validate input before processing:

```typescript
import { scaffolderInputSchema } from '@repo/scaffolder'

const result = scaffolderInputSchema.safeParse(input)
if (!result.success) {
  console.error('Validation errors:', result.error.format())
}
```

## Input Schema

The scaffolder accepts JSON input conforming to this structure:

```typescript
interface ScaffolderInput {
  mainWorkflow: ExtractedWorkflow
  subWorkflows?: ExtractedWorkflow[]
  scopes: AuthScope[]
}

interface ExtractedWorkflow {
  name: string
  description?: string
  tasks: ExtractedTask[]
  conditions: ExtractedCondition[]
  flows: ExtractedFlow[]
  cancellationRegions: CancellationRegion[]
}

interface ExtractedCondition {
  name: string
  isStartCondition: boolean
  isEndCondition: boolean
  isImplicitCondition: boolean
}

interface ExtractedFlow {
  type: 'task->condition' | 'condition->task' | 'task->task'
  from: string
  to: string
}

interface CancellationRegion {
  owner: string
  tasks: string[]
  conditions: string[]
}

interface AuthScope {
  name: string
  description: string
}
```

### Task Types

The scaffolder supports four task types:

#### Regular Task
A task with an associated work item:

```json
{
  "type": "task",
  "name": "validate-order",
  "description": "Validate the customer order",
  "joinType": "and",
  "splitType": "and",
  "workItem": {
    "name": "validateOrder",
    "description": "Validates order data"
  }
}
```

#### Dummy Task
A task with no work item (used for routing logic):

```json
{
  "type": "dummyTask",
  "name": "route-decision",
  "joinType": "xor",
  "splitType": "xor"
}
```

#### Composite Task
A task that embeds a sub-workflow:

```json
{
  "type": "compositeTask",
  "name": "payment-subprocess",
  "subWorkflowName": "payment-workflow",
  "joinType": "and",
  "splitType": "and"
}
```

#### Dynamic Composite Task
A task that dynamically selects from multiple sub-workflows:

```json
{
  "type": "dynamicCompositeTask",
  "name": "dynamic-handler",
  "workflowTypes": ["workflow-a", "workflow-b"],
  "selectionLogic": "return workflow.context.type === 'A' ? 'workflow-a' : 'workflow-b'",
  "joinType": "and",
  "splitType": "and"
}
```

### Join and Split Types

- `and`: All incoming/outgoing paths are required (parallel execution)
- `xor`: Exactly one incoming/outgoing path (exclusive choice)
- `or`: One or more incoming/outgoing paths

## Generated Files

The scaffolder generates the following file structure:

```
convex/
└── workflows/
    └── <workflow-name>/
        ├── workflows/
        │   ├── <main-workflow>.workflow.ts
        │   └── <sub-workflow>.workflow.ts
        ├── workItems/
        │   ├── <task-name>.workItem.ts
        │   └── ...
        ├── scopes.ts
        ├── definition.ts
        └── schema.ts
```

It also modifies these existing files if they exist:
- `authorization.ts` - Adds scope module registration
- `workflows/metadata.ts` - Adds workflow metadata
- `schema.ts` - Adds workflow tables

## Example Input File

```json
{
  "mainWorkflow": {
    "name": "order-fulfillment",
    "description": "End-to-end order fulfillment process",
    "tasks": [
      {
        "type": "task",
        "name": "receive-order",
        "joinType": "and",
        "splitType": "and",
        "workItem": { "name": "receiveOrder" }
      },
      {
        "type": "task",
        "name": "check-inventory",
        "joinType": "and",
        "splitType": "xor",
        "workItem": { "name": "checkInventory" }
      },
      {
        "type": "dummyTask",
        "name": "inventory-decision",
        "joinType": "xor",
        "splitType": "xor"
      },
      {
        "type": "task",
        "name": "ship-order",
        "joinType": "and",
        "splitType": "and",
        "workItem": { "name": "shipOrder" }
      },
      {
        "type": "task",
        "name": "backorder",
        "joinType": "and",
        "splitType": "and",
        "workItem": { "name": "createBackorder" }
      }
    ],
    "conditions": [
      { "name": "start", "isStartCondition": true, "isEndCondition": false, "isImplicitCondition": false },
      { "name": "end", "isStartCondition": false, "isEndCondition": true, "isImplicitCondition": false }
    ],
    "flows": [
      { "type": "condition->task", "from": "start", "to": "receive-order" },
      { "type": "task->task", "from": "receive-order", "to": "check-inventory" },
      { "type": "task->task", "from": "check-inventory", "to": "inventory-decision" },
      { "type": "task->task", "from": "inventory-decision", "to": "ship-order" },
      { "type": "task->task", "from": "inventory-decision", "to": "backorder" },
      { "type": "task->condition", "from": "ship-order", "to": "end" },
      { "type": "task->condition", "from": "backorder", "to": "end" }
    ],
    "cancellationRegions": []
  },
  "subWorkflows": [],
  "scopes": [
    { "name": "order:read", "description": "Read order information" },
    { "name": "order:write", "description": "Create and modify orders" },
    { "name": "inventory:read", "description": "Check inventory levels" }
  ]
}
```

## Advanced Usage

### Custom Generators

For advanced use cases, you can use individual generators:

```typescript
import {
  generateWorkflowFile,
  generateWorkItemFile,
  generateWorkItemFiles,
  generateScopesFile,
  generateDefinitionFile,
  generateSchemaFile,
} from '@repo/scaffolder'
```

### File Modifiers

Modify existing registration files:

```typescript
import {
  modifyAppAuthorization,
  modifyMetadata,
  modifySchema,
} from '@repo/scaffolder'
```

### Naming Utilities

Generate consistent naming conventions:

```typescript
import { generateNames } from '@repo/scaffolder'

const names = generateNames('order-processing')
// {
//   raw: 'order-processing',
//   directoryName: 'orderProcessing',
//   workflowName: 'orderProcessing',
//   scopeModuleName: 'orderProcessingScopeModule',
//   versionManagerName: 'orderProcessingVersionManager',
//   workflowExportName: 'orderProcessingWorkflow',
//   tablesName: 'orderProcessingTables',
//   displayName: 'Order Processing'
// }
```

## License

MIT
