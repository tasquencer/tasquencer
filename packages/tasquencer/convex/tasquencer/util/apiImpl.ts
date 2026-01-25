import {
  assertTaskExists,
  assertWorkItemExists,
  assertWorkflowExists,
  InvalidStateTransitionError,
  StructuralIntegrityError,
  WorkflowNotFoundError,
  WorkItemNotFoundError,
} from "../exceptions";
import { type Id } from "../../_generated/dataModel";
import { type MutationCtx } from "../../_generated/server";
import { Workflow } from "../elements/workflow";
import { getWorkflowElementByPath, getWorkItemElementByPath } from "./helpers";
import {
  getWorkflowRootWorkflowId,
  getWorkItemRootWorkflowId,
} from "./workflowHelpers";
import {
  type WorkflowExecutionMode,
  type TaskState,
  type CancellationReason,
} from "../types";
import {
  startWorkflowTrace,
  scheduleTraceFlush,
  saveAuditContext,
  loadAuditContext,
  updateTraceState,
  scheduleSnapshotComputation,
} from "../audit/integration";
import { getAuditService } from "../../components/audit/src/client/service";
import { getSpanBuffer } from "../../components/audit/src/client/buffer";
import {
  type SpanData,
  type AuditContext,
} from "../../components/audit/src/shared/context";
import { ExecutionContext } from "../elements/executionContext";
import invariant from "tiny-invariant";
import type { GenericDatabaseReader } from "convex/server";
import type { AuditFunctionHandles } from "../audit/integration";

export async function initializeRootWorkflow(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    payload?: unknown;
    parentContext?: AuditContext | null;
    migrationFromWorkflowId?: Id<"tasquencerWorkflows">;
  },
  executionMode: WorkflowExecutionMode = "normal"
) {
  const auditService = getAuditService();

  const runInitialization = async (executionContext: ExecutionContext) => {
    if (executionMode === "fastForward") {
      invariant(
        args.migrationFromWorkflowId,
        "initializeFastForwarded requires migrationFromWorkflowId"
      );
      return await args.workflowNetwork.initializeFastForwarded(
        executionContext,
        args.migrationFromWorkflowId
      );
    }

    return await args.workflowNetwork.initialize(
      executionContext,
      undefined,
      args.payload
    );
  };

  if (args.parentContext) {
    // MODE 1: Parent context provided - workflow becomes child span in existing trace
    const { spanId, context: childContext } = auditService.startSpan({
      operation: `Workflow.${args.workflowNetwork.name}`,
      operationType: "workflow",
      resourceType: "workflow",
      resourceName: args.workflowNetwork.name,
      attributes: { type: "custom", payload: args.payload },
      context: args.parentContext,
    });

    const executionContext = ExecutionContext.make({
      mutationCtx: ctx,
      auditFunctionHandles,
      isInternalMutation,
      executionMode,
      auditContext: childContext,
      spanId,
    });

    try {
      const workflowId = await runInitialization(executionContext);

      auditService.completeSpan(args.parentContext.traceId, spanId, {
        attributes: { type: "custom", payload: { workflowId } },
      });

      // Save context for cross-mutation access (uses parent's traceId)
      await saveAuditContext(
        ctx,
        auditFunctionHandles,
        workflowId,
        childContext
      );

      // Flush spans using the business/parent traceId so initialization is durable
      await scheduleTraceFlush(ctx, auditFunctionHandles, childContext.traceId);

      return workflowId;
    } catch (error) {
      auditService.failSpan(args.parentContext.traceId, spanId, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  } else {
    // MODE 2: No parent context - create new trace (existing behavior)
    const tempTraceId = `temp_${Date.now()}_${Math.random()}`;

    const context = startWorkflowTrace({
      workflowName: args.workflowNetwork.name,
      workflowId: tempTraceId as any,
      workflowVersionName: args.workflowNetwork.versionName,
      payload: args.payload,
    });

    const executionContext = ExecutionContext.make({
      mutationCtx: ctx,
      auditFunctionHandles,
      isInternalMutation,
      executionMode,
      auditContext: context,
    });

    const workflowId = await runInitialization(executionContext);

    if (context) {
      const buffer = getSpanBuffer();

      const { trace, spans } = auditService.getBufferedTrace(tempTraceId);

      if (trace) {
        buffer.clear(tempTraceId);

        const updatedTrace = {
          ...trace,
          traceId: workflowId,
          attributes:
            trace.attributes?.type === "workflow"
              ? {
                  ...trace.attributes,
                  workflowId: workflowId.toString(),
                }
              : trace.attributes,
          metadata: trace.metadata
            ? {
                ...trace.metadata,
                workflowId,
              }
            : trace.metadata,
        };
        const updatedSpans = spans.map((span: SpanData) => ({
          ...span,
          traceId: workflowId,
        }));

        buffer.setTrace(updatedTrace);
        updatedSpans.forEach((span: SpanData) =>
          buffer.setSpan(workflowId, span)
        );

        const newContext = { ...context, traceId: workflowId };

        await saveAuditContext(
          ctx,
          auditFunctionHandles,
          workflowId,
          newContext
        );

        // Child workflows can be initialized during root initialization (e.g. composite/dynamic composite
        // task `onEnabled` activities). Those contexts get saved with the temporary traceId; update them
        // to point at the real root traceId so subsequent mutations flush into the canonical trace.
        const childWorkflowIds = new Set<string>();
        for (const span of spans) {
          for (const event of span.events ?? []) {
            if (event.name !== "workflowIdAssigned") continue;
            const assigned = (event.data as any)?.workflowId;
            if (typeof assigned === "string" && assigned !== workflowId) {
              childWorkflowIds.add(assigned);
            }
          }
        }
        for (const childWorkflowId of childWorkflowIds) {
          await saveAuditContext(
            ctx,
            auditFunctionHandles,
            childWorkflowId as Id<"tasquencerWorkflows">,
            newContext
          );
        }

        await scheduleTraceFlush(ctx, auditFunctionHandles, workflowId);
      }
    }

    return workflowId;
  }
}

export async function cancelRootWorkflow(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workflowId: Id<"tasquencerWorkflows">;
    payload?: unknown;
  }
) {
  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    args.workflowId
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await args.workflowNetwork.cancel(
    executionContext,
    args.workflowId,
    args.payload
  );

  // Update trace state for root workflow cancellation
  const traceId = parentContext.traceId ?? args.workflowId;
  updateTraceState(traceId, "canceled");

  // Schedule trace flush on cancellation
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);
}

export async function initializeWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    target: {
      path: string[];
      parentWorkflowId: Id<"tasquencerWorkflows">;
      parentTaskName: string;
    };
    payload?: unknown;
  }
) {
  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    args.target.parentWorkflowId
  );
  const traceId = parentContext.traceId ?? args.target.parentWorkflowId;

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    args.target.path
  );

  const parentTask = await ctx.db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q
        .eq("workflowId", args.target.parentWorkflowId)
        .eq("name", args.target.parentTaskName)
    )
    .order("desc")
    .first();

  assertTaskExists(
    parentTask,
    args.target.parentTaskName,
    args.target.parentWorkflowId
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  const workItemId = await workItemElement.initialize(
    executionContext,
    {
      workflowId: args.target.parentWorkflowId,
      taskName: args.target.parentTaskName,
      taskGeneration: parentTask.generation,
    },
    args.payload
  );

  // Incremental flush for real-time inspection (always flush root workflow trace)
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);

  return workItemId;
}

export async function startWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workItemId: Id<"tasquencerWorkItems">;
    payload?: unknown;
  }
) {
  const workItem = await ctx.db.get(args.workItemId);

  assertWorkItemExists(workItem, args.workItemId);

  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workItem.parent.workflowId
  );

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    workItem.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await workItemElement.start(executionContext, workItem, args.payload);

  // Get root workflow ID from realizedPath (first element is always the root)
  const rootWorkflowId = getWorkItemRootWorkflowId(workItem);

  // Incremental flush for real-time inspection (always flush root workflow trace)
  const traceId = parentContext.traceId ?? rootWorkflowId;
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);
}

export async function completeWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workItemId: Id<"tasquencerWorkItems">;
    payload?: unknown;
  }
) {
  const workItem = await ctx.db.get(args.workItemId);
  assertWorkItemExists(workItem, args.workItemId);

  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workItem.parent.workflowId
  );

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    workItem.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await workItemElement.complete(executionContext, workItem, args.payload);

  // Get root workflow ID from realizedPath (first element is always the root)
  const rootWorkflowId = getWorkItemRootWorkflowId(workItem);

  // Check if root workflow completed and update trace state
  const rootWorkflow = await ctx.db.get(rootWorkflowId);
  if (rootWorkflow?.state === "completed") {
    updateTraceState(parentContext.traceId ?? rootWorkflowId, "completed");
  }

  // Incremental flush for real-time inspection (always flush root workflow trace)
  const traceId = parentContext.traceId ?? rootWorkflowId;
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);

  if (rootWorkflow?.state === "completed" && !rootWorkflow.parent) {
    await scheduleSnapshotComputation(
      ctx,
      auditFunctionHandles,
      traceId,
      Date.now()
    );
  }
}

export async function failWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workItemId: Id<"tasquencerWorkItems">;
    payload?: unknown;
  }
) {
  const workItem = await ctx.db.get(args.workItemId);
  assertWorkItemExists(workItem, args.workItemId);

  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workItem.parent.workflowId
  );

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    workItem.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await workItemElement.fail(executionContext, workItem, args.payload);

  // Get root workflow ID from realizedPath (first element is always the root)
  const rootWorkflowId = getWorkItemRootWorkflowId(workItem);

  // Check if root workflow failed and update trace state
  const rootWorkflow = await ctx.db.get(rootWorkflowId);
  if (rootWorkflow?.state === "failed") {
    updateTraceState(parentContext.traceId ?? rootWorkflowId, "failed");
  }

  // Incremental flush for real-time inspection (always flush root workflow trace)
  const traceId = parentContext.traceId ?? rootWorkflowId;
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);

  if (rootWorkflow?.state === "failed" && !rootWorkflow.parent) {
    await scheduleSnapshotComputation(
      ctx,
      auditFunctionHandles,
      rootWorkflowId,
      Date.now()
    );
  }
}

export async function cancelWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workItemId: Id<"tasquencerWorkItems">;
    payload?: unknown;
  }
) {
  const workItem = await ctx.db.get(args.workItemId);
  assertWorkItemExists(workItem, args.workItemId);

  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workItem.parent.workflowId
  );

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    workItem.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await workItemElement.cancel(executionContext, workItem, args.payload);

  // Get root workflow ID from realizedPath (first element is always the root)
  const rootWorkflowId = getWorkItemRootWorkflowId(workItem);

  // Check if root workflow canceled and update trace state
  const rootWorkflow = await ctx.db.get(rootWorkflowId);
  if (rootWorkflow?.state === "canceled") {
    updateTraceState(parentContext.traceId ?? rootWorkflowId, "canceled");
  }

  // Incremental flush for real-time inspection (always flush root workflow trace)
  const traceId = parentContext.traceId ?? rootWorkflowId;
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);

  if (rootWorkflow?.state === "canceled" && !rootWorkflow.parent) {
    await scheduleSnapshotComputation(
      ctx,
      auditFunctionHandles,
      traceId,
      Date.now()
    );
  }
}

export async function resetWorkItem(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workItemId: Id<"tasquencerWorkItems">;
    payload?: unknown;
  }
) {
  const workItem = await ctx.db.get(args.workItemId);

  assertWorkItemExists(workItem, args.workItemId);

  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workItem.parent.workflowId
  );

  const workItemElement = getWorkItemElementByPath(
    args.workflowNetwork,
    workItem.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  await workItemElement.reset(executionContext, workItem, args.payload);

  // Get root workflow ID from realizedPath (first element is always the root)
  const rootWorkflowId = getWorkItemRootWorkflowId(workItem);

  // Incremental flush for real-time inspection (always flush root workflow trace)
  const traceId = parentContext.traceId ?? rootWorkflowId;
  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);
}

export async function initializeWorkflow(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    target: {
      path: string[];
      parentWorkflowId: Id<"tasquencerWorkflows">;
      parentTaskName: string;
    };
    payload?: unknown;
  }
) {
  // Load audit context for this workflow
  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    args.target.parentWorkflowId
  );

  const workflowElement = getWorkflowElementByPath(
    args.workflowNetwork,
    args.target.path
  );
  const parentTask = await ctx.db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q
        .eq("workflowId", args.target.parentWorkflowId)
        .eq("name", args.target.parentTaskName)
    )
    .order("desc")
    .first();

  assertTaskExists(
    parentTask,
    args.target.parentTaskName,
    args.target.parentWorkflowId
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  const workflowId = await workflowElement.initialize(
    executionContext,
    {
      workflowId: args.target.parentWorkflowId,
      taskName: args.target.parentTaskName,
      taskGeneration: parentTask.generation,
    },
    args.payload
  );

  // Incremental flush for real-time inspection (use traceId from context, which is the root workflow ID)
  const traceId = parentContext?.traceId ?? args.target.parentWorkflowId;
  await scheduleTraceFlush(
    ctx,
    auditFunctionHandles,
    traceId as Id<"tasquencerWorkflows">
  );

  return workflowId;
}

export async function cancelWorkflow(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workflowId: Id<"tasquencerWorkflows">;
    payload?: unknown;
    reason?: CancellationReason;
  }
) {
  const workflow = await ctx.db.get(args.workflowId);

  assertWorkflowExists(workflow, args.workflowId);

  // Prefer the child workflow's stored context so cancel spans nest under it.
  let parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    workflow.parent?.workflowId || args.workflowId
  );
  const storedContext = await ctx.runQuery(
    auditFunctionHandles.getAuditContext,
    {
      workflowId: args.workflowId.toString(),
    }
  );

  if (storedContext) {
    const stored = storedContext.context as AuditContext;
    parentContext = parentContext
      ? {
          ...parentContext,
          parentSpanId: stored.parentSpanId,
          depth: stored.depth,
          path: stored.path,
        }
      : stored;
  }

  const workflowElement = getWorkflowElementByPath(
    args.workflowNetwork,
    workflow.path
  );

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  if (args.reason === "migration") {
    await workflowElement.cancelForMigration(
      executionContext,
      args.workflowId,
      args.payload
    );
  } else {
    await workflowElement.cancel(
      executionContext,
      args.workflowId,
      args.payload
    );
  }

  const traceId = (parentContext?.traceId ??
    (workflow.parent
      ? workflow.parent.workflowId
      : args.workflowId)) as Id<"tasquencerWorkflows">;

  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);
}

export async function tickTask(
  ctx: MutationCtx,
  auditFunctionHandles: AuditFunctionHandles,
  isInternalMutation: boolean,
  args: {
    workflowNetwork: Workflow;
    workflowName: string;
    workflowId: Id<"tasquencerWorkflows">;
    taskName: string;
  }
) {
  const workflow = await ctx.db.get(args.workflowId);
  assertWorkflowExists(workflow, args.workflowId);

  const parentContext = await loadAuditContext(
    ctx,
    auditFunctionHandles,
    args.workflowId
  );

  const workflowElement = getWorkflowElementByPath(
    args.workflowNetwork,
    workflow.path
  );

  if (workflowElement.name !== args.workflowName) {
    throw new StructuralIntegrityError(
      "Workflow name mismatch for tick",
      {
        workflowId: args.workflowId,
        expectedName: workflowElement.name,
        receivedName: args.workflowName,
      }
    );
  }

  const taskElement = workflowElement.getTask(args.taskName);

  const executionContext = ExecutionContext.make({
    mutationCtx: ctx,
    auditFunctionHandles,
    isInternalMutation,
    executionMode: "normal",
    auditContext: parentContext,
  });

  const task = await taskElement.getTaskByName(executionContext, args.workflowId);

  if (task.state !== "started") {
    throw new InvalidStateTransitionError(
      "Task",
      String(task._id),
      task.state,
      ["started"]
    );
  }

  await taskElement.maybeComplete(executionContext, args.workflowId, task);

  const rootWorkflowId = getWorkflowRootWorkflowId(workflow);
  const traceId = parentContext?.traceId ?? rootWorkflowId;

  const rootWorkflow = await ctx.db.get(rootWorkflowId);
  if (rootWorkflow?.state === "completed") {
    updateTraceState(traceId, "completed");
  }
  if (rootWorkflow?.state === "failed") {
    updateTraceState(traceId, "failed");
  }
  if (rootWorkflow?.state === "canceled") {
    updateTraceState(traceId, "canceled");
  }

  await scheduleTraceFlush(ctx, auditFunctionHandles, traceId);

  if (
    rootWorkflow &&
    !rootWorkflow.parent &&
    (rootWorkflow.state === "completed" ||
      rootWorkflow.state === "failed" ||
      rootWorkflow.state === "canceled")
  ) {
    await scheduleSnapshotComputation(
      ctx,
      auditFunctionHandles,
      traceId,
      Date.now()
    );
  }
}

export async function getWorkflowTaskStates(
  db: GenericDatabaseReader<any>,
  args: {
    workflowId: Id<"tasquencerWorkflows">;
  }
) {
  const workflowTasks = await db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_and_state", (q) =>
      q.eq("workflowId", args.workflowId)
    )
    .collect();

  return workflowTasks.reduce(
    (acc, t) => {
      acc[t.name] = t.state;
      return acc;
    },
    {} as Record<string, TaskState>
  );
}

export async function safeGetWorkflowState(
  db: GenericDatabaseReader<any>,
  workflowId: Id<"tasquencerWorkflows">
) {
  const workflow = await db.get(workflowId);
  return workflow?.state;
}

export async function getWorkflowState(
  db: GenericDatabaseReader<any>,
  workflowId: Id<"tasquencerWorkflows">
) {
  const workflowState = await safeGetWorkflowState(db, workflowId);
  if (!workflowState) {
    throw new WorkflowNotFoundError(workflowId);
  }
  return workflowState;
}

export async function safeGetWorkItemState(
  db: GenericDatabaseReader<any>,
  workItemId: Id<"tasquencerWorkItems">
) {
  const workItem = await db.get(workItemId);
  return workItem?.state;
}

export async function getWorkItemState(
  db: GenericDatabaseReader<any>,
  workItemId: Id<"tasquencerWorkItems">
) {
  const workItemState = await safeGetWorkItemState(db, workItemId);
  if (!workItemState) {
    throw new WorkItemNotFoundError(workItemId);
  }
  return workItemState;
}
