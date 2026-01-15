# Advanced Workflows

> **Prerequisites**: [Workflow Basics](./WORKFLOWS_BASIC.md), [Core Concepts](./CORE_CONCEPTS.md)  
> **Related**: [Exception Handling](./EXCEPTIONS.md) | [Compensation](./COMPENSATION.md)

This guide covers advanced workflow patterns including control flow, splits/joins, and complex orchestration.

## Table of Contents

- [Control Flow Patterns](#control-flow-patterns)
- [Advanced Patterns](#advanced-patterns)
- [Tick-Task Pattern](#tick-task-pattern-coordination-without-ownership)

---

## Control Flow Patterns

> **Important**: In most cases, you should connect tasks directly to tasks (e.g., `.connectTask('A', (to) => to.task('B'))`), which automatically creates implicit conditions. Explicit conditions (using `.condition('name')`) are rarely needed except for `startCondition()`, `endCondition()`, and advanced patterns like deferred choice. See [When to Use Explicit Conditions](#when-to-use-explicit-conditions) for details.

### AND Split/Join (Parallel)

**Use when**: All branches must execute

```typescript
Builder.workflow('parallel')
  .startCondition('start')
  .task('A', taskA.withSplitType('and')) // Fires both B and C
  .task('B', taskB)
  .task('C', taskC)
  .task('D', taskD.withJoinType('and')) // Waits for both B and C
  .endCondition('end')
  .connectCondition('start', (to) => to.task('A'))
  .connectTask('A', (to) => to.task('B').task('C'))
  .connectTask('B', (to) => to.task('D'))
  .connectTask('C', (to) => to.task('D'))
  .connectTask('D', (to) => to.condition('end'))
```

```
Flow:
  start → A → B → D → end
            ↘ C ↗
```

### XOR Split/Join (Exclusive Choice)

**Use when**: Exactly one branch executes

```typescript
import { type AvailableRoutes } from '../tasquencer/builder/flow'

Builder.workflow('choice')
  .startCondition('start')
  .task('decide', decideTask.withSplitType('xor'))
  .condition('approved')
  .condition('rejected')
  .task('processApproval', approvalTask)
  .task('processRejection', rejectionTask)
  .task('finish', finishTask.withJoinType('xor'))
  .endCondition('end')
  .connectCondition('start', (to) => to.task('decide'))
  .connectTask('decide', (to) =>
    to
      .condition('approved')
      .condition('rejected')
      .route(async ({ mutationCtx, route, parent }) => {
        // Route functions have access to mutationCtx, route, and parent
        const decision = await DecisionDomain.getByWorkflowId(
          mutationCtx,
          parent.workflow.id,
        )
        // XOR: return single route
        return decision.approved
          ? route.toCondition('approved')
          : route.toCondition('rejected')
      }),
  )
  .connectCondition('approved', (to) => to.task('processApproval'))
  .connectCondition('rejected', (to) => to.task('processRejection'))
  .connectTask('processApproval', (to) => to.task('finish'))
  .connectTask('processRejection', (to) => to.task('finish'))
  .connectTask('finish', (to) => to.condition('end'))
```

```
Flow:
         ┌→ approved → processApproval ┐
  start → decide                       → finish → end
         └→ rejected → processRejection┘
```

### OR Split/Join (Dynamic Parallel)

**Use when**: 1+ branches execute (decided at runtime)

**Critical distinction from XOR-join:**
- **XOR-join**: Fires when **ANY single** input arrives (first-wins, races to completion)
- **OR-join**: **Synchronized merge join** that waits for **ALL** dynamically-selected branches to complete

Think of OR-join as a "Dynamic AND-join": You select which branches to fire at runtime (OR-split), but then you wait for **all of them** to complete (AND-join synchronization behavior).

```typescript
import { type AvailableRoutes } from '../tasquencer/builder/flow'

Builder.workflow('bookTravel')
  .startCondition('start')
  .task('register', registerTask.withSplitType('or'))
  .task('bookFlight', flightTask)
  .task('bookHotel', hotelTask)
  .task('bookCar', carTask)
  .task('pay', payTask.withJoinType('or')) // Synchronized merge: waits for ALL fired tasks
  .endCondition('end')
  .connectCondition('start', (to) => to.task('register'))
  .connectTask('register', (to) =>
    to
      .task('bookFlight')
      .task('bookHotel')
      .task('bookCar')
      .route(async ({ mutationCtx, route, parent }) => {
        // Use domain function to get booking preferences
        const booking = await BookingDomain.getByWorkflowId(
          mutationCtx,
          parent.workflow.id,
        )
        const routes: AvailableRoutes<typeof route>[] = []
        if (booking.needsFlight) routes.push(route.toTask('bookFlight'))
        if (booking.needsHotel) routes.push(route.toTask('bookHotel'))
        if (booking.needsCar) routes.push(route.toTask('bookCar'))
        return routes
      }),
  )
  .connectTask('bookFlight', (to) => to.task('pay'))
  .connectTask('bookHotel', (to) => to.task('pay'))
  .connectTask('bookCar', (to) => to.task('pay'))
  .connectTask('pay', (to) => to.condition('end'))
```

**OR-Join Synchronization Semantics**: Uses sophisticated analysis to determine when ALL selected branches are complete

| Scenario | OR-Join Behavior | XOR-Join Behavior |
|----------|------------------|-------------------|
| Only flight booked | Waits for flight, then fires | Fires after flight |
| Flight + hotel booked | **Waits for BOTH** flight and hotel | Fires after first to complete |
| Flight + hotel + car booked | **Waits for ALL THREE** | Fires after first to complete |

**Key Points:**
- OR-join **never fires prematurely** - it waits for all branches that were dynamically selected
- Uses `E2WFOJNet` algorithm from YAWL research (Extended Workflow Object Petri Net)
- This is a YAWL extension - pure Petri nets don't have OR-join semantics
- The "OR" refers to the split (dynamic selection), not the join (which is synchronized)

---

## Advanced Patterns

### Cancellation Regions

**Use when**: Completing a task should cancel other tasks or remove tokens from conditions

```typescript
// Basic: Cancel competing tasks
Builder.workflow('withCancellation')
  .startCondition('start')
  .task('A', taskA.withSplitType('and'))
  .task('B', taskB) // Long-running
  .task('C', taskC) // Can finish first
  .endCondition('end')
  .connectCondition('start', (to) => to.task('A'))
  .connectTask('A', (to) => to.task('B').task('C'))
  .connectTask('B', (to) => to.condition('end'))
  .connectTask('C', (to) => to.condition('end'))
  // When C completes, cancel B
  .withCancellationRegion('C', (cr) => cr.task('B'))
```

**Key behaviors:**

1. **Triggered on task completion**: Cancellation happens when the trigger task **completes**, not when it starts
   > **Note on semantics:** This "on complete" behavior is consistent with foundational workflow patterns research (e.g., by van der Aalst), ensuring that a task successfully finishes its primary work before triggering compensatory or cleanup actions on competing paths.
2. **Can target tasks and conditions**: Cancel tasks, remove tokens from conditions, or both
3. **Affects dependent tasks**: Canceling conditions disables tasks waiting on those conditions
4. **Interacts with OR-joins**: Removing tokens affects OR-join analysis

```typescript
// Advanced: Cancel tasks AND conditions
Builder.workflow('withComplexCancellation')
  .startCondition('start')
  .task('A', taskA.withSplitType('and'))
  .task('B', taskB)
  .task('C', taskC)
  .task('D', taskD.withSplitType('and'))
  .task('E', taskE.withJoinType('or'))
  .condition('c1')
  .condition('c2')
  .condition('c3')
  .endCondition('end')
  .connectCondition('start', (to) => to.task('A'))
  .connectTask('A', (to) => to.condition('c1'))
  .connectCondition('c1', (to) => to.task('B'))
  .connectTask('B', (to) => to.condition('c2'))
  .connectCondition('c2', (to) => to.task('C').task('E'))
  .connectTask('C', (to) => to.condition('c3'))
  .connectCondition('c3', (to) => to.task('D').task('E'))
  .connectTask('D', (to) => to.condition('c1').condition('c2'))
  .connectTask('E', (to) => to.condition('end'))
  // When C completes, cancel B and remove tokens from c1 and c2
  .withCancellationRegion('C', (cr) =>
    cr.task('B').condition('c1').condition('c2'),
  )
```

**How it works:**

When task C **completes**:

1. Task B is canceled (all work items, cascading to children if composite)
2. Tokens are removed from conditions c1 and c2 (marking set to 0)
3. Tasks waiting on c1/c2 are disabled (including task E in this example)
4. OR-join analysis is updated to reflect removed tokens

**Use cases:**

- **Timeout patterns**: Cancel slow path when fast path completes
- **Winner-takes-all**: First successful task cancels alternatives
- **Loop breaking**: Cancel loop-back conditions to exit loops
- **Error handling**: Cancel rollback tasks after success
- **Resource cleanup**: Cancel tasks holding resources

```typescript
// Example: Break a loop by canceling the loop-back condition
Builder.workflow('loopWithCancellation')
  .startCondition('start')
  .task('process', processTask)
  .task('check', checkTask.withSplitType('xor'))
  .task('breakLoop', breakTask)
  .condition('continue')
  .endCondition('end')
  .connectCondition('start', (to) => to.task('process'))
  .connectTask('process', (to) => to.task('check'))
  .connectTask('check', (to) =>
    to
      .condition('continue')
      .task('breakLoop')
      .route(async ({ mutationCtx, route, parent }) => {
        const shouldContinue = await LoopDomain.checkCondition(
          mutationCtx,
          parent.workflow.id,
        )
        return shouldContinue
          ? route.toCondition('continue')
          : route.toTask('breakLoop')
      }),
  )
  .connectCondition('continue', (to) => to.task('process')) // Loop back
  .connectTask('breakLoop', (to) => to.condition('end'))
  // Cancel the loop-back condition when breakLoop completes
  .withCancellationRegion('breakLoop', (cr) => cr.condition('continue'))
```

**Cancellation propagation:**

Cancellation **only propagates downwards** - it never bubbles up to parent entities:

**When a work item is canceled:**

- The work item transitions to `canceled` state
- The parent task's **policy is called** to decide what to do
- The task can:
  - `'continue'`: Keep running (wait for other work items)
  - `'complete'`: Complete the task (default if all work items finalized)
  - `'fail'`: Fail the task
- **The task does NOT automatically transition to canceled**

**When a workflow is canceled:**

- All active (enabled/started) tasks are canceled
- Task cancellation cascades to all work items/subworkflows
- **Policies are NOT called** during workflow cancellation
- This ensures clean shutdown without policy interference

**Cancellation cascade order:**

1. `Workflow.cancel()` → cancels all active tasks
2. `Task.cancel()` → cancels all work items (without calling policy)
3. `WorkItem.cancel()` → transitions to canceled
4. When canceled via API (not workflow cancellation), policy is called

```typescript
// Default policy handles cancellation gracefully
const myTask = Builder.task(myWorkItem).withPolicy(
  async ({ task: { getStats }, transition }) => {
    const { nextState } = transition
    const stats = await getStats()

    if (nextState === 'canceled') {
      // When a work item is canceled, check if all work items are finalized
      const allFinalized =
        stats.completed + stats.failed + stats.canceled === stats.total
      return allFinalized ? 'complete' : 'continue'
    }

    // ... handle other states
  },
)

// Use onWorkItemStateChanged for cleanup when individual work items are canceled
const myTask = Builder.task(myWorkItem).withActivities({
  onWorkItemStateChanged: async ({ mutationCtx, workItem }) => {
    if (workItem.nextState === 'canceled') {
      // Cleanup: update domain tables, release resources, etc.
      await MyDomain.updateRecord(mutationCtx, workItem.id, {
        status: 'canceled',
        canceledAt: Date.now(),
      })
    }
  },
})
```

> **Note:** The mechanics of policy execution during cancellation are nuanced. For a detailed explanation of top-down (`workflow.cancel()`) versus bottom-up (`workItem.cancel()`) cancellation, see the [Top-Down Command vs. Bottom-Up Signal](./CORE_CONCEPTS.md#top-down-command-vs-bottom-up-signal) section in the Core Concepts guide.

**When a condition is canceled:**

- Tokens are removed (marking set to 0)
- Tasks waiting on that condition are disabled
- OR-join tasks re-evaluate whether they can fire

**Important timing:**

- Cancellation happens when the trigger task **completes** (enters 'completed' state)
- This is **after** the task finishes its work
- Ensures the task completes successfully before canceling competing paths

**Key principle: Cancellation never bubbles up**

- Canceling a work item doesn't automatically cancel its parent task
- Canceling a workflow doesn't automatically cancel its parent composite task
- Parent entities use **policies** to decide how to react to child cancellation
- This allows flexible error handling and graceful degradation

### Composite Tasks (Nested Workflows)

**Use when**: You need workflow hierarchy

```typescript
// Sub-workflow
const reviewWorkflow = Builder.workflow('review')
  .startCondition('start')
  .task('initialReview', initialReviewTask)
  .task('finalReview', finalReviewTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('initialReview'))
  .connectTask('initialReview', (to) => to.task('finalReview'))
  .connectTask('finalReview', (to) => to.condition('end'))

// Parent workflow
const mainWorkflow = Builder.workflow('main')
  .startCondition('start')
  .task('prepare', prepareTask)
  .compositeTask(
    'review',
    Builder.compositeTask(reviewWorkflow).withActivities({
      onEnabled: async ({ workflow }) => {
        await workflow.initialize({
          /* context */
        })
      },
    }),
  )
  .task('finalize', finalizeTask)
  .endCondition('end')
  .connectCondition('start', (to) => to.task('prepare'))
  .connectTask('prepare', (to) => to.task('review'))
  .connectTask('review', (to) => to.task('finalize'))
  .connectTask('finalize', (to) => to.condition('end'))
```

**Key behaviors:**

- Sub-workflow state changes propagate to parent task
- Canceling parent cancels all children
- No nesting depth limit (but respect Convex mutation limits)

**Isolation & communication:**

- Nested workflows **don't know** they are nested (by design)
- No built-in parent ↔ child communication mechanism
- Parent can initialize child workflows and receive state change notifications (`onWorkflowStateChanged`)
- For cross-hierarchy data access, use domain tables:

```typescript
// Parent stores both workflow IDs in domain table
await ProcessDomain.createJob(mutationCtx, {
  parentWorkflowId: parent.workflow.id,
  childWorkflowId: await childWorkflow.initialize(),
  sharedContext: {
    /* data both need */
  },
})

// Either parent or child can query domain table to get shared context
const job = await ProcessDomain.getJobByParentWorkflowId(
  mutationCtx,
  workflowId,
)
```

**Why this isolation?**

- Keeps hierarchy simple and understandable
- Prevents tight coupling between workflow levels
- Forces explicit data contracts via domain tables

**Best practices for composite task initialization:**

```typescript
// ✅ Good: Always use domain functions to get context
const diagnosticsCompositeTask = Builder.compositeTask(
  diagnosticsWorkflow,
).withActivities({
  onEnabled: async ({ workflow, mutationCtx, parent }) => {
    // Use domain function to get aggregate root
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id,
    )
    assertPatientExists(patient, parent.workflow.id)

    // Initialize sub-workflow with context
    await workflow.initialize({ patientId: patient._id })
  },
})

// ❌ Bad: Query database directly
const badCompositeTask = Builder.compositeTask(diagnosticsWorkflow).withActivities({
  onEnabled: async ({ workflow, mutationCtx, parent }) => {
    // ❌ Don't query directly!
    const patient = await mutationCtx.db
      .query('patients')
      .withIndex('by_workflow_id', (q) =>
        q.eq('workflowId', parent.workflow.id),
      )
      .unique()

    await workflow.initialize({ patientId: patient._id })
  },
})
```

**Pattern: Initialize multiple sub-workflows dynamically**

```typescript
const sectionsCompositeTask = Builder.compositeTask(sectionReviewWorkflow)
  .withActivities({
    onEnabled: async ({ workflow, mutationCtx, parent }) => {
      // Get aggregate root
      const document = await getDocumentByWorkflowId(
        mutationCtx.db,
        parent.workflow.id,
      )

      // Get sections from domain
      const sections = await getSectionsByDocumentId(
        mutationCtx.db,
        document._id,
      )

      // Initialize one sub-workflow per section
      for (const section of sections) {
        await workflow.initialize({
          documentId: document._id,
          sectionId: section._id,
        })
      }
    },
  })
```

**Pattern: React to sub-workflow state changes**

```typescript
const sectionsCompositeTask = Builder.compositeTask(sectionReviewWorkflow)
  .withActivities({
    onEnabled: async ({ workflow, mutationCtx, parent }) => {
      // Initialize sub-workflows...
    },

    onWorkflowStateChanged: async ({ workflow, task, mutationCtx }) => {
      // Called when ANY sub-workflow changes state
      if (workflow.nextState === 'completed') {
        // Use domain function to update progress
        await DocumentDomain.incrementCompletedSections(
          mutationCtx,
          workflow.id,
        )
      }

      if (workflow.nextState === 'failed') {
        // Handle failure
        await DocumentDomain.markSectionFailed(mutationCtx, workflow.id)
      }
    },
  })
```

**Using split and join types with composite tasks:**

Composite tasks support the same split/join types as regular tasks:

```typescript
// XOR split: Only one sub-workflow fires
const diagnosticsCompositeTask = Builder.compositeTask(diagnosticsWorkflow)
  .withSplitType('xor')
  .withActivities({
    onEnabled: async ({ workflow, mutationCtx, parent }) => {
      const patient = await getPatientByWorkflowId(
        mutationCtx.db,
        parent.workflow.id,
      )
      // Initialize single sub-workflow
      await workflow.initialize({ patientId: patient._id })
    },
  })

// OR join: Waits only for sub-workflows that were fired
const gatherResultsTask = Builder.dummyTask().withJoinType('or')
```

### Dummy Tasks

**Use when**: You need a task that has no work items but performs side effects or coordinates state.

Dummy tasks are tasks without work items. They automatically complete when enabled (unless they have activities that perform work). They're useful for:
- Synchronization points (joins)
- State transitions
- Domain updates at specific workflow points
- Routing logic

**Basic dummy task:**

```typescript
// Simple dummy task - completes immediately when enabled
const syncPointTask = Builder.dummyTask()
```

**Dummy task with activities:**

```typescript
// Dummy task that updates domain state when enabled
const dischargeTask = Builder.dummyTask().withActivities({
  onEnabled: async ({ mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id,
    )
    assertPatientExists(patient, parent.workflow.id)

    // Update domain state
    await markPatientReadyForDischarge(
      mutationCtx.db,
      patient._id,
      parent.workflow.id,
    )
  },

  onCompleted: async ({ mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id,
    )
    assertPatientExists(patient, parent.workflow.id)

    // Final state transition
    await markPatientDischarged(mutationCtx.db, patient._id, parent.workflow.id)
  },
})
```

**Why dummy tasks?**

1. **Synchronization**: Use with OR-join to create synchronized merge joins that wait for ALL dynamically-selected tasks
2. **State transitions**: Update domain state at specific workflow points without requiring work items
3. **Routing**: Make routing decisions based on domain state after a join point

**Real-world example from ER workflow:**

> **Note:** This example shows a simplified excerpt from the ER workflow, focusing on the consultation routing pattern. The full workflow includes additional tasks like triage, diagnostics, and surgery. See `examples/er/` for the complete implementation.

```typescript
// Gather consultations from specialists
const erWorkflow = Builder.workflow('erPatientJourney')
  .task('reviewDiagnostics', reviewDiagnosticsTask.withSplitType('or'))
  .task('consultCardiologist', cardiologyConsultTask)
  .task('consultNeurologist', neurologyConsultTask)
  // OR-join: Synchronized merge - waits for ALL specialist tasks that were dynamically fired
  .dummyTask(
    'gatherConsultations',
    Builder.dummyTask().withJoinType('or').withSplitType('xor'),
  )
  .task('administerMedication', medicationTask)
  .dummyTask('discharge', dischargeTask.withJoinType('or'))
  .connectTask('reviewDiagnostics', (to) =>
    to
      .task('consultCardiologist')
      .task('consultNeurologist')
      .task('gatherConsultations')
      .route(async ({ mutationCtx, route, parent }) => {
        // OR split: Dynamically select which specialists are needed
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id,
        )
        assertPatientExists(patient, parent.workflow.id)

        const review = await getLatestDiagnosticReviewForPatient(
          mutationCtx.db,
          patient._id,
          { workflowId: parent.workflow.id },
        )
        assertDiagnosticReviewExists(review, patient._id)

        const decisions = determineRequiredConsultations(
          review.consultationsNeeded,
        )

        const routes = []
        if (decisions.needsCardiologist) {
          routes.push(route.toTask('consultCardiologist'))
        }
        if (decisions.needsNeurologist) {
          routes.push(route.toTask('consultNeurologist'))
        }
        // Always route to gather point
        routes.push(route.toTask('gatherConsultations'))

        return routes
      }),
  )
  .connectTask('consultCardiologist', (to) => to.task('gatherConsultations'))
  .connectTask('consultNeurologist', (to) => to.task('gatherConsultations'))
  .connectTask('gatherConsultations', (to) =>
    to
      .task('administerMedication')
      .task('discharge')
      .route(async ({ mutationCtx, route, parent }) => {
        // XOR split after OR-join: Route based on consultation results
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id,
        )
        assertPatientExists(patient, parent.workflow.id)

        const review = await getLatestDiagnosticReviewForPatient(
          mutationCtx.db,
          patient._id,
          { workflowId: parent.workflow.id },
        )
        assertDiagnosticReviewExists(review, patient._id)

        let needsMedication = review.prescribeMedication ?? false

        if (!needsMedication) {
          const consultations = await listSpecialistConsultationsForPatient(
            mutationCtx.db,
            patient._id,
            { workflowId: parent.workflow.id },
          )
          needsMedication = consultations.some(
            (c) => c.state.status === 'completed' && c.state.prescribeMedication,
          )
        }

        return needsMedication
          ? route.toTask('administerMedication')
          : route.toTask('discharge')
      }),
  )
```

**How the pattern works:**

1. **OR-split**: `reviewDiagnostics` dynamically selects 0-2 specialist tasks + always routes to gather point
2. **OR-join (synchronized merge)**: `gatherConsultations` waits for ALL specialist tasks that were fired to complete
3. **XOR-split**: Route to medication or discharge based on consultation results
4. **Dummy task activities**: Update domain state at key transition points

**Important**: The OR-join waits for ALL dynamically-selected branches (both cardiologist AND neurologist if both were fired), not just the first to complete. This is synchronized merge behavior.

**Key points:**

- Dummy tasks have no work items, so no `initialize()` or `start()` actions
- They can have activities (`onEnabled`, `onCompleted`, `onFailed`, etc.)
- Useful for state coordination without requiring human interaction
- Common pattern: OR-split → specialist tasks → dummy task with OR-join → XOR-split

### Loops

**Use when**: Tasks need to repeat

```typescript
Builder.workflow('loop')
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
        const shouldContinue = await LoopDomain.checkCondition(
          mutationCtx,
          parent.workflow.id,
        )
        // XOR: return single route
        return shouldContinue
          ? route.toCondition('continue')
          : route.toCondition('end')
      }),
  )
  .connectCondition('continue', (to) => to.task('process')) // Loop back!
```

**Note on Loop Performance**:

Loops in Tasquencer are **not a performance concern** because:

- Each iteration only updates workflow state (conditions, task states)
- Work items are initialized but **cannot be started** within the loop
- Starting work items requires the scheduler, which breaks the transaction
- Therefore, each loop iteration is extremely fast (just state transitions)

```typescript
// This is safe - each iteration is lightweight
.withActivities({
  onEnabled: async ({ workItem, mutationCtx, registerScheduled }) => {
    const workItemId = await workItem.initialize() // Fast

    // Start happens outside the mutation
    await registerScheduled(
      mutationCtx.scheduler.runAfter(0, internal.myWorkflow.startWork, {
        workItemId,
      }),
    )
  }
})
```

**The real constraint**: You still need an exit condition to prevent logical infinite loops, but you won't hit mutation timeout limits

### Tick-Task Pattern (Coordination Without Ownership)

**Use when**: You need to coordinate with independent workflows without owning them, especially when atomic execution limits would be exceeded.

#### The Problem: Atomic Execution Limits

Tasquencer runs in a single Convex mutation (atomic execution). This works well for most workflows, but creates challenges with large fanouts:

- **Initialization**: Creating many work items/subworkflows in one activity can hit mutation limits (solvable with staggered initialization)
- **Cancellation**: Canceling a composite task must propagate to all children atomically - there's no workaround within the ownership model

The exact threshold depends on the complexity of child workflows, not a fixed number.

#### The Solution: Coordination Without Ownership

Instead of **owning** child workflows (composite task pattern), you **coordinate** with independent workflows:

1. A task's activity *schedules* creation of independent workflows (doesn't own them)
2. Those workflows run independently with their own lifecycle
3. When they complete, they notify the coordinating task via `tickTask`
4. The coordinating task's policy re-evaluates and decides when to complete

This breaks the atomic constraint by distributing coordination across multiple scheduled mutations.

#### Key Concepts

- **Tick**: Re-evaluates a task's policy on demand, without any work item state change triggering it
- **Policy**: An async function returning `"continue"` | `"complete"` | `"fail"`
- **Works with**: dummy tasks, regular tasks, composite tasks, dynamic composite tasks

#### API

**Define a policy on a dummy task:**

```typescript
Builder.dummyTask().withPolicy(async ({ mutationCtx, parent, task, transition }) => {
  // Check external state (e.g., query a domain table tracking independent workflows)
  const stats = await getCoordinatedWorkflowStats(mutationCtx.db, parent.workflow.id)

  if (stats.allCompleted) {
    return "complete"
  }
  if (stats.anyFailed) {
    return "fail"
  }
  return "continue"
})
```

**Policy context:**

| Property | Description |
|----------|-------------|
| `mutationCtx` | Convex mutation context for database access |
| `parent.workflow.id` | ID of the workflow containing this task |
| `parent.workflow.name` | Name of the parent workflow |
| `task.name` | Name of this task |
| `task.generation` | Task generation (increments on reset) |
| `task.path` | Full path to this task in workflow hierarchy |
| `transition.prevState` | Previous task state (always `"started"` for tick) |
| `transition.nextState` | Target state (always `"completed"` for tick) |

**Call tickTask from an external workflow or scheduled function:**

```typescript
// From the API facade generated by apiFor()
await ctx.runMutation(api.myWorkflow.internalTick, {
  workflowName: "coordinatingWorkflow",
  workflowId: coordinatingWorkflowId,
  taskName: "gate",
})
```

#### Complete Example: Gate Pattern

This example shows a coordinating workflow with a "gate" task that waits for a parallel "signal" task to complete before proceeding:

```typescript
// Helper to check if a task is completed
const isTaskCompleted = async (
  db: DatabaseReader,
  workflowId: Id<"tasquencerWorkflows">,
  taskName: string
) => {
  const task = await db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q.eq("workflowId", workflowId).eq("name", taskName)
    )
    .order("desc")
    .first()
  return task?.state === "completed"
}

// Workflow definition
const coordinatedWorkflow = Builder.workflow("coordinated")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .dummyTask(
    "gate",
    Builder.dummyTask().withPolicy(async ({ mutationCtx, parent }) => {
      // Gate waits until signal task completes
      const signalDone = await isTaskCompleted(
        mutationCtx.db,
        parent.workflow.id,
        "signal"
      )
      return signalDone ? "complete" : "continue"
    })
  )
  .task(
    "signal",
    Builder.task(signalWorkItem).withActivities({
      onCompleted: async ({ mutationCtx, parent, registerScheduled }) => {
        // When signal completes, tick the gate to re-evaluate its policy
        await registerScheduled(
          mutationCtx.scheduler.runAfter(0, api.coordinated.internalTick, {
            workflowName: "coordinated",
            workflowId: parent.workflow.id,
            taskName: "gate",
          })
        )
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("gate").task("signal"))
  .connectTask("gate", (to) => to.condition("end"))
  .connectTask("signal", (to) => to.condition("end"))
```

**How it works:**

1. `split` fires both `gate` and `signal` in parallel
2. `gate` starts, its policy returns `"continue"` (signal not done yet), so it stays in `started` state
3. `signal` task proceeds through its work item lifecycle
4. When `signal` completes, its `onCompleted` activity schedules a tick on `gate`
5. `tickTask` is called on `gate`, policy re-evaluates, now returns `"complete"`
6. `gate` transitions to `completed`, workflow proceeds to end

#### Large Fanout Example: Coordinating Independent Workflows

For scenarios where you need to coordinate many independent workflows:

```typescript
const fanoutCoordinator = Builder.workflow("fanoutCoordinator")
  .startCondition("start")
  .dummyTask(
    "coordinator",
    Builder.dummyTask()
      .withActivities({
        onEnabled: async ({ mutationCtx, parent, registerScheduled }) => {
          // Get items to process from domain
          const items = await getItemsToProcess(mutationCtx.db, parent.workflow.id)

          // Schedule independent workflow creation (NOT in this mutation)
          for (const item of items) {
            await registerScheduled(
              mutationCtx.scheduler.runAfter(0, internal.workers.createItemWorkflow, {
                itemId: item._id,
                coordinatorWorkflowId: parent.workflow.id,
              })
            )
          }

          // Track expected count in domain
          await setExpectedWorkflowCount(mutationCtx.db, parent.workflow.id, items.length)
        },
      })
      .withPolicy(async ({ mutationCtx, parent }) => {
        // Check completion status from domain table
        const stats = await getCoordinationStats(mutationCtx.db, parent.workflow.id)

        if (stats.completed >= stats.expected) {
          return "complete"
        }
        if (stats.failed > 0) {
          return "fail"  // Or implement partial failure tolerance
        }
        return "continue"
      })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("coordinator"))
  .connectTask("coordinator", (to) => to.condition("end"))

// Independent worker workflow
const itemWorkflow = Builder.workflow("itemWorker")
  .startCondition("start")
  .task("process", processTask)
  .endCondition("end")
  .connectCondition("start", (to) => to.task("process"))
  .connectTask("process", (to) => to.condition("end"))
  .withActivities({
    onCompleted: async ({ mutationCtx, workflow }) => {
      // Get coordinator ID from domain
      const coordination = await getCoordinationByItemWorkflow(mutationCtx.db, workflow.id)

      // Update domain tracking
      await incrementCompletedCount(mutationCtx.db, coordination.coordinatorWorkflowId)

      // Tick the coordinator to re-evaluate
      await mutationCtx.scheduler.runAfter(0, api.fanoutCoordinator.internalTick, {
        workflowName: "fanoutCoordinator",
        workflowId: coordination.coordinatorWorkflowId,
        taskName: "coordinator",
      })
    },
  })
```

**Key points:**

- Coordinator doesn't own the item workflows - they're independent
- Communication happens through domain tables and scheduled `tickTask` calls
- Each item workflow completion triggers a tick, but only the last one causes the coordinator to complete
- Canceling the coordinator does NOT cascade to item workflows (they're independent)

#### When to Use

| Consideration | Composite Task (Ownership) | Tick-Task (Coordination) |
|---------------|---------------------------|-------------------------|
| **Child lifecycle** | Tied to parent | Independent |
| **Cancellation** | Cascades atomically | Manual cleanup required |
| **Failure handling** | Policy on parent decides | Must implement via domain |
| **Mutation limits** | Constrained by total children | Unconstrained |
| **Complexity** | Lower (built-in semantics) | Higher (explicit coordination) |

**Guidelines:**

- **Start with composite tasks** - simpler, built-in cancellation/failure semantics
- **Switch to tick-task** when you hit mutation limits or need independent lifecycle
- **Hybrid approach**: Use composite tasks for small groups, tick-task for coordination between groups

---
