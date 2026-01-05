import { setup, Builder } from "./setup.test";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import schema from "../../schema";

import type { MutationCtx } from "../../_generated/server";
import { ExecutionContext } from "../elements/executionContext";
import { StructuralIntegrityError } from "../exceptions";
import { CompositeTask } from "../elements/compositeTask";
import { makeAuditFunctionHandles } from "../audit/integration";
import { components } from "../../_generated/api";

const WORKFLOW_VERSION = "v1";

function buildRootWorkflow({
  onInitializeAction = () => {},
  onInitializedActivity = () => {},
  onCancelAction = () => {},
  onCanceledActivity = () => {},
}: {
  onInitializeAction?: (payload: { note: string }) => void;
  onInitializedActivity?: (ctx: unknown) => void;
  onCancelAction?: (payload: { reason?: string }) => void;
  onCanceledActivity?: (ctx: unknown) => void;
} = {}) {
  const baseBuilder = Builder.workflow("fastForwardedWorkflow")
    .startCondition("start")
    .task("taskA", Builder.noOpTask)
    .endCondition("end")
    .connectCondition("start", (to) => to.task("taskA"))
    .connectTask("taskA", (to) => to.condition("end"));

  const workflowActions = Builder.workflowActions()
    .initialize(z.object({ note: z.string() }), async (ctx, payload) => {
      onInitializeAction(payload);
      await ctx.workflow.initialize();
    })
    .cancel(
      z
        .object({
          reason: z.string().optional(),
        })
        .optional(),
      async (ctx, payload) => {
        onCancelAction(payload ?? {});
        await ctx.workflow.cancel();
      }
    );

  return baseBuilder
    .withActivities({
      onInitialized: async (ctx) => {
        onInitializedActivity(ctx);
      },
      onCanceled: async (ctx) => {
        onCanceledActivity(ctx);
      },
    })
    .withActions(workflowActions)
    .build(WORKFLOW_VERSION);
}

function buildNestedWorkflow() {
  const childWorkflowBuilder = Builder.workflow("child")
    .startCondition("start")
    .task("childTask", Builder.noOpTask)
    .endCondition("end")
    .connectCondition("start", (to) => to.task("childTask"))
    .connectTask("childTask", (to) => to.condition("end"));

  const parentWorkflowBuilder = Builder.workflow("parent")
    .startCondition("start")
    .compositeTask(
      "childComposite",
      Builder.compositeTask(childWorkflowBuilder)
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("childComposite"))
    .connectTask("childComposite", (to) => to.condition("end"));

  const parentWorkflow = parentWorkflowBuilder.build(WORKFLOW_VERSION);
  const compositeTask = parentWorkflow.getTask(
    "childComposite"
  ) as CompositeTask;
  return compositeTask.getWorkflow();
}

async function makeExecutionContext(ctx: MutationCtx) {
  const auditFunctionHandles = await makeAuditFunctionHandles(
    components.tasquencerAudit
  );
  return ExecutionContext.make({
    mutationCtx: ctx,
    isInternalMutation: true,
    executionMode: "normal",
    auditContext: {
      traceId: `trace_${Math.random()}`,
      depth: 0,
      path: [],
    },
    auditFunctionHandles,
  });
}

async function initializeBaselineWorkflow(executionContext: ExecutionContext) {
  const baselineWorkflow = buildRootWorkflow();
  return await baselineWorkflow.initialize(executionContext, undefined, {
    note: "baseline",
  });
}

describe("Workflow.initializeFastForwarded", () => {
  it("initializes root workflows without invoking actions or activities", async () => {
    const t = setup();
    const actionSpy = vi.fn();
    const activitySpy = vi.fn();
    const workflow = buildRootWorkflow({
      onInitializeAction: actionSpy,
      onInitializedActivity: activitySpy,
    });

    const result = await t.run(async (ctx) => {
      const executionContext = await makeExecutionContext(ctx);
      const sourceWorkflowId =
        await initializeBaselineWorkflow(executionContext);
      const workflowId = await workflow.initializeFastForwarded(
        executionContext,
        sourceWorkflowId
      );

      const workflowDoc = await ctx.db.get(workflowId);
      const enabledTasks = await ctx.db
        .query("tasquencerTasks")
        .withIndex("by_workflow_id_and_state", (q) =>
          q.eq("workflowId", workflowId).eq("state", "enabled")
        )
        .collect();

      return {
        workflowDoc,
        enabledTaskNames: enabledTasks.map((task) => task.name),
      };
    });

    expect(actionSpy).not.toHaveBeenCalled();
    expect(activitySpy).not.toHaveBeenCalled();
    expect(result.workflowDoc?.state).toBe("initialized");
    expect(new Set(result.enabledTaskNames)).toEqual(new Set(["taskA"]));
  });

  it("throws when invoked for workflows with a parent", async () => {
    const t = setup();
    const childWorkflow = buildNestedWorkflow();

    await expect(
      t.run(async (ctx) => {
        const executionContext = await makeExecutionContext(ctx);
        const sourceWorkflowId =
          await initializeBaselineWorkflow(executionContext);
        await childWorkflow.initializeFastForwarded(
          executionContext,
          sourceWorkflowId
        );
      })
    ).rejects.toThrow(StructuralIntegrityError);
  });

  it("cancels root workflows for migration without invoking cancel action", async () => {
    const t = setup();
    const cancelActionSpy = vi.fn();
    const onCanceledActivitySpy = vi.fn();
    const workflow = buildRootWorkflow({
      onCancelAction: cancelActionSpy,
      onCanceledActivity: onCanceledActivitySpy,
    });

    const result = await t.run(async (ctx) => {
      const executionContext = await makeExecutionContext(ctx);
      const sourceWorkflowId =
        await initializeBaselineWorkflow(executionContext);
      const workflowId = await workflow.initializeFastForwarded(
        executionContext,
        sourceWorkflowId
      );

      await workflow.cancelForMigration(
        executionContext,
        workflowId,
        undefined
      );

      const workflowDoc = await ctx.db.get(workflowId);
      return { workflowDoc };
    });

    expect(cancelActionSpy).not.toHaveBeenCalled();
    expect(onCanceledActivitySpy).toHaveBeenCalledTimes(1);
    expect(result.workflowDoc?.state).toBe("canceled");
  });

  it("throws when cancelForMigration is invoked for workflows with a parent", async () => {
    const t = setup();
    const childWorkflow = buildNestedWorkflow();

    await expect(
      t.run(async (ctx) => {
        const executionContext = await makeExecutionContext(ctx);
        const sourceWorkflowId =
          await initializeBaselineWorkflow(executionContext);
        await childWorkflow.cancelForMigration(
          executionContext,
          sourceWorkflowId,
          undefined
        );
      })
    ).rejects.toThrow(StructuralIntegrityError);
  });
});
