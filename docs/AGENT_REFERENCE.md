# Tasquencer Agent Reference

> **Purpose**: Condensed API reference for AI agents generating Tasquencer workflow code.
> **For detailed docs**: See [WORKFLOWS_BASIC.md](./WORKFLOWS_BASIC.md), [WORKFLOWS_ADVANCED.md](./WORKFLOWS_ADVANCED.md), [CORE_CONCEPTS.md](./CORE_CONCEPTS.md)

---

## Builder API Quick Reference

### Workflow Builder

```typescript
Builder.workflow(name: string)
  .startCondition(name)      // Required - exactly one
  .endCondition(name)        // Required - exactly one
  .condition(name)           // Rarely needed (see "Explicit Conditions")
  .task(name, taskBuilder)
  .compositeTask(name, compositeTaskBuilder)
  .dummyTask(name, dummyTaskBuilder)
  .connectCondition(name, (to) => to.task(...))
  .connectTask(name, (to) => to.task(...).condition(...))
  .withCancellationRegion(taskName, (cr) => cr.task(...).condition(...))
  .withActions(workflowActions)
  .withActivities(workflowActivities)
```

### Task Builder

```typescript
Builder.task(workItemBuilder)
  .withSplitType('and' | 'xor' | 'or')  // Default: 'and'
  .withJoinType('and' | 'xor' | 'or')   // Default: 'and'
  .withActivities({
    onEnabled: async (ctx) => { /* initialize work items here */ },
    onStarted: async (ctx) => {},
    onCompleted: async (ctx) => {},
    onFailed: async (ctx) => {},
    onCanceled: async (ctx) => {},
    onWorkItemStateChanged: async (ctx) => {},
  })
  .withPolicy(async (ctx) => 'continue' | 'fail' | 'complete')
```

### Dummy Task Builder

```typescript
Builder.dummyTask()
  .withSplitType('and' | 'xor' | 'or')
  .withJoinType('and' | 'xor' | 'or')
  .withActivities({ onEnabled, onStarted, onCompleted })
  .withPolicy(async (ctx) => 'continue' | 'fail' | 'complete')
```

Use dummy tasks for:
- Synchronization points (OR-joins)
- Routing decisions without work
- State transitions at workflow points
- Coordination gates (with tick-task pattern)

### Work Item Builder

```typescript
Builder.workItem(name)
  .withActions(workItemActions)    // For user-facing work items
  .withActivities({
    onInitialized: async (ctx) => {},
    onStarted: async (ctx) => {},
    onCompleted: async (ctx) => {},
    onFailed: async (ctx) => {},
    onCanceled: async (ctx) => {},
  })
```

**Actions vs Activities:**
- **Actions**: External API (user calls). Define with `Builder.workItemActions().start(...).complete(...)`
- **Activities**: Internal callbacks (system reacts). For side effects, domain updates.

### Composite Task Builder

```typescript
Builder.compositeTask(workflowBuilder)
  .withSplitType('and' | 'xor' | 'or')
  .withJoinType('and' | 'xor' | 'or')
  .withActivities({
    onEnabled: async ({ workflow }) => {
      await workflow.initialize({ /* payload */ })
    },
    onWorkflowStateChanged: async ({ workflow }) => {},
  })
  .withPolicy(async (ctx) => 'continue' | 'fail' | 'complete')
```

---

## Control Flow Patterns

### Split/Join Types

| Type | Split Behavior | Join Behavior |
|------|----------------|---------------|
| **AND** | Fire ALL branches | Wait for ALL branches |
| **XOR** | Fire ONE branch (exclusive) | Fire when ANY ONE arrives (first wins) |
| **OR** | Fire 1+ branches (dynamic) | Wait for ALL FIRED branches (synchronized merge) |

**Critical OR-join distinction**: OR-join is NOT "fire on any" - that's XOR-join. OR-join is a synchronized merge that waits for all dynamically-selected branches.

### Route Functions

```typescript
.connectTask('taskName', (to) =>
  to
    .task('optionA')
    .task('optionB')
    .condition('someCondition')
    .route(async ({ mutationCtx, route, parent }) => {
      // Access domain data
      const data = await getDomainData(mutationCtx.db, parent.workflow.id)

      // XOR: return single route
      return route.toTask('optionA')

      // OR: return array of routes
      return [route.toTask('optionA'), route.toTask('optionB')]
    })
)
```

---

## Connection Rules (Bipartite Graph)

Tasquencer uses YAWL bipartite graph structure:

- ✅ `connectCondition()` → tasks only
- ✅ `connectTask()` → conditions or tasks
- ✅ Task → Task creates implicit condition automatically
- ❌ Condition → Condition is NOT allowed

### Prefer Implicit Conditions

```typescript
// ✅ PREFERRED: Task-to-task (implicit condition)
.connectTask('A', (to) => to.task('B'))

// ❌ VERBOSE: Explicit intermediate conditions
.connectTask('A', (to) => to.condition('afterA'))
.connectCondition('afterA', (to) => to.task('B'))
```

### When Explicit Conditions ARE Needed

1. `startCondition()` and `endCondition()` - always required
2. Deferred choice pattern - multiple tasks compete for same token
3. Multiple tasks converging to single merge point
4. Complex OR-join cancellation regions

---

## Work Item Lifecycle

**States**: `initialized` → `started` → `completed` | `failed` | `canceled`

### Auto-Trigger Pattern

For system tasks without human interaction:

```typescript
const autoTask = Builder.workItem('autoProcess')
  .withActions(
    Builder.workItemActions()
      .start(schema, async (ctx) => { await ctx.workItem.start() })
      .complete(schema, async (ctx) => { await ctx.workItem.complete() })
  )
  .withActivities({
    onInitialized: async (ctx) => {
      ctx.workItem.start({})  // Auto-start
    },
    onStarted: async (ctx) => {
      // Do processing...
      ctx.workItem.complete({})  // Auto-complete
    },
  })
```

**When to use auto-trigger:**
- ✅ System tasks, notifications, background jobs
- ✅ AI processing, automated tasks

**When NOT to use:**
- ❌ Deferred choice patterns (breaks the choice)
- ❌ User-interactive work items
- ❌ Cancellation region triggers

---

## Task Policies

Policies determine task behavior when work items change state.

### Default Policy (Automatic)

- `completed`: Complete if all work items finalized, else continue
- `failed`: Fail immediately (fail-fast)
- `canceled`: Complete if all work items finalized, else continue

### Custom Policy Example

```typescript
.withPolicy(async ({ task, transition }) => {
  const stats = await task.getStats()
  const allFinalized = stats.completed + stats.failed + stats.canceled === stats.total

  if (transition.nextState === 'failed') {
    // Custom: Allow some failures
    return stats.failed < 3 ? 'continue' : 'fail'
  }

  if (transition.nextState === 'completed') {
    return allFinalized ? 'complete' : 'continue'
  }

  return 'continue'
})
```

### Policy Execution Rules

- ✅ Called when work item reaches terminal state (completed/failed/canceled)
- ❌ NOT called during workflow cancellation (clean shutdown)
- ❌ NOT called for non-originating tasks when workflow fails

---

## Code Examples

### Simple Sequential Workflow

```typescript
const simpleWorkflow = Builder.workflow('simple')
  .startCondition('start')
  .task('step1', step1Task)
  .task('step2', step2Task)
  .task('step3', step3Task)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('step1'))
  .connectTask('step1', (to) => to.task('step2'))
  .connectTask('step2', (to) => to.task('step3'))
  .connectTask('step3', (to) => to.condition('end'))
```

### Parallel Execution (AND Split/Join)

```typescript
const parallelWorkflow = Builder.workflow('parallel')
  .startCondition('start')
  .task('prepare', prepareTask.withSplitType('and'))
  .task('taskA', taskA)
  .task('taskB', taskB)
  .task('taskC', taskC)
  .task('gather', gatherTask.withJoinType('and'))
  .endCondition('end')
  .connectCondition('start', (to) => to.task('prepare'))
  .connectTask('prepare', (to) => to.task('taskA').task('taskB').task('taskC'))
  .connectTask('taskA', (to) => to.task('gather'))
  .connectTask('taskB', (to) => to.task('gather'))
  .connectTask('taskC', (to) => to.task('gather'))
  .connectTask('gather', (to) => to.condition('end'))
```

### Conditional Routing (XOR Split)

```typescript
const conditionalWorkflow = Builder.workflow('conditional')
  .startCondition('start')
  .task('evaluate', evaluateTask.withSplitType('xor'))
  .task('approved', approvedTask)
  .task('rejected', rejectedTask)
  .task('finish', finishTask.withJoinType('xor'))
  .endCondition('end')
  .connectCondition('start', (to) => to.task('evaluate'))
  .connectTask('evaluate', (to) =>
    to
      .task('approved')
      .task('rejected')
      .route(async ({ mutationCtx, route, parent }) => {
        const data = await getData(mutationCtx.db, parent.workflow.id)
        return data.isApproved
          ? route.toTask('approved')
          : route.toTask('rejected')
      })
  )
  .connectTask('approved', (to) => to.task('finish'))
  .connectTask('rejected', (to) => to.task('finish'))
  .connectTask('finish', (to) => to.condition('end'))
```

### Dynamic Parallel (OR Split/Join)

```typescript
const dynamicParallel = Builder.workflow('bookTravel')
  .startCondition('start')
  .task('register', registerTask.withSplitType('or'))
  .task('bookFlight', flightTask)
  .task('bookHotel', hotelTask)
  .task('bookCar', carTask)
  .dummyTask('gather', Builder.dummyTask().withJoinType('or'))
  .task('pay', payTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('register'))
  .connectTask('register', (to) =>
    to
      .task('bookFlight')
      .task('bookHotel')
      .task('bookCar')
      .task('gather')
      .route(async ({ mutationCtx, route, parent }) => {
        const booking = await getBooking(mutationCtx.db, parent.workflow.id)
        const routes = []
        if (booking.needsFlight) routes.push(route.toTask('bookFlight'))
        if (booking.needsHotel) routes.push(route.toTask('bookHotel'))
        if (booking.needsCar) routes.push(route.toTask('bookCar'))
        routes.push(route.toTask('gather'))  // Always include gather point
        return routes
      })
  )
  .connectTask('bookFlight', (to) => to.task('gather'))
  .connectTask('bookHotel', (to) => to.task('gather'))
  .connectTask('bookCar', (to) => to.task('gather'))
  .connectTask('gather', (to) => to.task('pay'))
  .connectTask('pay', (to) => to.condition('end'))
```

### Cancellation Regions

```typescript
const withCancellation = Builder.workflow('racePattern')
  .startCondition('start')
  .task('split', splitTask.withSplitType('and'))
  .task('fastPath', fastTask)
  .task('slowPath', slowTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('split'))
  .connectTask('split', (to) => to.task('fastPath').task('slowPath'))
  .connectTask('fastPath', (to) => to.condition('end'))
  .connectTask('slowPath', (to) => to.condition('end'))
  // When fastPath completes, cancel slowPath
  .withCancellationRegion('fastPath', (cr) => cr.task('slowPath'))
```

### Composite Task (Nested Workflow)

```typescript
// Sub-workflow
const reviewWorkflow = Builder.workflow('review')
  .startCondition('start')
  .task('initialReview', initialTask)
  .task('finalReview', finalTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('initialReview'))
  .connectTask('initialReview', (to) => to.task('finalReview'))
  .connectTask('finalReview', (to) => to.condition('end'))

// Parent workflow with composite task
const parentWorkflow = Builder.workflow('parent')
  .startCondition('start')
  .task('prepare', prepareTask)
  .compositeTask('review',
    Builder.compositeTask(reviewWorkflow).withActivities({
      onEnabled: async ({ workflow, mutationCtx, parent }) => {
        const data = await getData(mutationCtx.db, parent.workflow.id)
        await workflow.initialize({ dataId: data._id })
      },
    })
  )
  .task('finalize', finalizeTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('prepare'))
  .connectTask('prepare', (to) => to.task('review'))
  .connectTask('review', (to) => to.task('finalize'))
  .connectTask('finalize', (to) => to.condition('end'))
```

### Loop Pattern

```typescript
const loopWorkflow = Builder.workflow('loop')
  .startCondition('start')
  .task('process', processTask)
  .task('check', checkTask.withSplitType('xor'))
  .condition('continue')
  .endCondition('end')
  .connectCondition('start', (to) => to.task('process'))
  .connectTask('process', (to) => to.task('check'))
  .connectTask('check', (to) =>
    to
      .condition('continue')
      .condition('end')
      .route(async ({ mutationCtx, route, parent }) => {
        const shouldContinue = await checkCondition(mutationCtx.db, parent.workflow.id)
        return shouldContinue
          ? route.toCondition('continue')
          : route.toCondition('end')
      })
  )
  .connectCondition('continue', (to) => to.task('process'))  // Loop back
```

---

## Tick-Task Pattern

Use when coordinating with independent workflows that would exceed atomic execution limits.

### Dummy Task with Policy (Gate Pattern)

```typescript
Builder.dummyTask()
  .withPolicy(async ({ mutationCtx, parent }) => {
    const allDone = await checkExternalWorkflows(mutationCtx.db, parent.workflow.id)
    return allDone ? "complete" : "continue"
  })
```

### Calling tickTask

```typescript
// From external workflow's onCompleted activity
await mutationCtx.scheduler.runAfter(0, api.myWorkflow.internalTick, {
  workflowName: "coordinatingWorkflow",
  workflowId: coordinatingWorkflowId,
  taskName: "gate",
})
```

### When to Use

- **Composite task**: Child lifecycle tied to parent, atomic cancellation
- **Tick-task**: Independent lifecycles, large fanouts, external coordination

---

## Quality Checklist

Before finalizing generated workflow code, verify:

- [ ] Single `startCondition()` and single `endCondition()`
- [ ] All paths can reach the end condition (no dead ends)
- [ ] Split/join types are correctly matched (AND with AND, XOR with XOR, OR with OR)
- [ ] Route functions return correct type (single route for XOR, array for OR)
- [ ] Cancellation regions don't create orphaned tokens
- [ ] Loop has exit condition
- [ ] Domain functions used for data access (not direct db queries)
