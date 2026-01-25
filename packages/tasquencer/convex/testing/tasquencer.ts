import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
  internalAction,
} from "../_generated/server";

import {
  assertWorkflowExists,
  assertTaskExists,
} from "../tasquencer/exceptions";
import {
  taskStatesValidator,
  workflowExecutionModeValidator,
} from "../tasquencer/schema";

import * as impl from "../tasquencer/util/apiImpl";
import type { AnyVersionManager } from "../tasquencer/versionManager";
import { internal, components } from "../_generated/api";
import invariant from "tiny-invariant";
import type { Id } from "../_generated/dataModel";
import { makeAuditFunctionHandles } from "../tasquencer/audit/integration";

/* This file should be used only for internal testing of the workflow engine. 
It is not part of the public API and shouldn't be used by anything outside
the tasquencer folder */

class InternalTestingVersionManagerRegistry {
  readonly versionManagers: Record<string, AnyVersionManager> = {};
  registerVersionManager(versionManager: AnyVersionManager) {
    this.versionManagers[versionManager.workflowName] = versionManager;
  }
  unregisterVersionManager(versionManager: AnyVersionManager) {
    if (this.versionManagers[versionManager.workflowName] === versionManager) {
      delete this.versionManagers[versionManager.workflowName];
    }
  }
  getVersionManager(name: string) {
    const versionManager = this.versionManagers[name];
    if (!versionManager) {
      throw new Error(`VersionManager ${name} doesn't exist`);
    }
    return versionManager;
  }
}

export const internalVersionManagerRegistry =
  new InternalTestingVersionManagerRegistry();

const getWorkflowNetwork = (
  workflowName: string,
  workflowVersionName: string
) =>
  internalVersionManagerRegistry
    .getVersionManager(workflowName)
    .buildForVersion(workflowVersionName);

export const initializeRootWorkflow = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    payload: v.optional(v.any()),
    parentContext: v.optional(v.any()),
    executionMode: v.optional(workflowExecutionModeValidator),
    migrationFromWorkflowId: v.optional(v.id("tasquencerWorkflows")),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    return await impl.initializeRootWorkflow(
      ctx,
      auditFunctionHandles,
      true,
      {
        workflowNetwork,
        payload: args.payload,
        parentContext: args.parentContext,
        migrationFromWorkflowId: args.migrationFromWorkflowId,
      },
      args.executionMode
    );
  },
  returns: v.id("tasquencerWorkflows"),
});

export const cancelRootWorkflow = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workflowId: v.id("tasquencerWorkflows"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.cancelRootWorkflow(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workflowId: args.workflowId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const initializeWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    target: v.object({
      path: v.array(v.string()),
      parentWorkflowId: v.id("tasquencerWorkflows"),
      parentTaskName: v.string(),
    }),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    return await impl.initializeWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      target: args.target,
      payload: args.payload,
    });
  },
  returns: v.id("tasquencerWorkItems"),
});

export const startWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workItemId: v.id("tasquencerWorkItems"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.startWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workItemId: args.workItemId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const completeWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workItemId: v.id("tasquencerWorkItems"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.completeWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workItemId: args.workItemId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const failWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workItemId: v.id("tasquencerWorkItems"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.failWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workItemId: args.workItemId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const cancelWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workItemId: v.id("tasquencerWorkItems"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.cancelWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workItemId: args.workItemId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const resetWorkItem = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workItemId: v.id("tasquencerWorkItems"),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.resetWorkItem(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workItemId: args.workItemId,
      payload: args.payload,
    });
  },
  returns: v.null(),
});

export const initializeWorkflow = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    target: v.object({
      path: v.array(v.string()),
      parentWorkflowId: v.id("tasquencerWorkflows"),
      parentTaskName: v.string(),
    }),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    return await impl.initializeWorkflow(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      target: args.target,
      payload: args.payload,
    });
  },
  returns: v.id("tasquencerWorkflows"),
});

export const cancelWorkflow = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workflowId: v.id("tasquencerWorkflows"),
    payload: v.optional(v.any()),
    cancellationReason: v.optional(v.literal("migration")),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.cancelWorkflow(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workflowId: args.workflowId,
      payload: args.payload,
      reason: args.cancellationReason ?? undefined,
    });
  },
  returns: v.null(),
});

export const tickTask = internalMutation({
  args: {
    workflowName: v.string(),
    workflowVersionName: v.string(),
    workflowId: v.id("tasquencerWorkflows"),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const auditFunctionHandles = await makeAuditFunctionHandles(
      components.tasquencerAudit
    );
    const workflowNetwork = getWorkflowNetwork(
      args.workflowName,
      args.workflowVersionName
    );
    await impl.tickTask(ctx, auditFunctionHandles, true, {
      workflowNetwork,
      workflowName: args.workflowName,
      workflowId: args.workflowId,
      taskName: args.taskName,
    });
  },
  returns: v.null(),
});

export const getWorkflowById = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
  },
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.workflowId);
    assertWorkflowExists(workflow, args.workflowId);
    return workflow;
  },
});

export const getWorkflowTasks = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_and_state", (q) =>
        q.eq("workflowId", args.workflowId)
      )
      .collect();
  },
});

export const getWorkflowTasksByState = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
    state: taskStatesValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_and_state", (q) =>
        q.eq("workflowId", args.workflowId).eq("state", args.state)
      )
      .collect();
  },
});

export const getWorkflowConditions = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasquencerConditions")
      .withIndex("by_workflow_id_and_name", (q) =>
        q.eq("workflowId", args.workflowId)
      )
      .collect();
  },
});

export const getWorkflowTaskWorkItems = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_name_and_generation", (q) =>
        q.eq("workflowId", args.workflowId).eq("name", args.taskName)
      )
      .order("desc")
      .first();

    assertTaskExists(task, args.taskName, args.workflowId);

    return await ctx.db
      .query("tasquencerWorkItems")
      .withIndex(
        "by_parent_workflow_id_task_name_task_generation_and_state",
        (q) =>
          q
            .eq("parent.workflowId", args.workflowId)
            .eq("parent.taskName", args.taskName)
            .eq("parent.taskGeneration", task.generation)
      )
      .collect();
  },
});

export const getWorkflowCompositeTaskWorkflows = internalQuery({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_name_and_generation", (q) =>
        q.eq("workflowId", args.workflowId).eq("name", args.taskName)
      )
      .order("desc")
      .first();

    assertTaskExists(task, args.taskName, args.workflowId);

    return await ctx.db
      .query("tasquencerWorkflows")
      .withIndex(
        "by_parent_workflow_id_task_name_task_generation_state_and_name",
        (q) =>
          q
            .eq("parent.workflowId", args.workflowId)
            .eq("parent.taskName", args.taskName)
            .eq("parent.taskGeneration", task.generation)
      )
      .collect();
  },
});

export const migrate = internalAction({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
    nextVersionName: v.string(),
  },
  handler: async (ctx, args) => {
    const workflow = await ctx.runQuery(
      internal.testing.tasquencer.getWorkflowById,
      {
        workflowId: args.workflowId,
      }
    );

    invariant(!workflow.parent, "Workflow is not a root workflow");

    const versionManager = internalVersionManagerRegistry.getVersionManager(
      workflow.name
    );

    invariant(versionManager, `VersionManager ${workflow.name} doesn't exist`);

    const versionNamesAfter = versionManager.versionNamesAfter(
      workflow.versionName
    );

    const nextVersionIndex = versionNamesAfter.findIndex(
      (v) => v === args.nextVersionName
    );

    invariant(
      nextVersionIndex !== -1,
      `Version ${args.nextVersionName} not found`
    );

    const versionsToMigrate = versionNamesAfter.slice(0, nextVersionIndex + 1);

    if (versionsToMigrate.length === 0) {
      return null;
    }

    let prevWorkflow: {
      workflowId: Id<"tasquencerWorkflows">;
      workflowName: string;
      workflowVersionName: string;
    } = {
      workflowId: args.workflowId,
      workflowName: workflow.name,
      workflowVersionName: workflow.versionName,
    };

    while (versionsToMigrate.length > 0) {
      const sourceWorkflowId = prevWorkflow.workflowId;
      await ctx.runMutation(internal.testing.tasquencer.cancelWorkflow, {
        ...prevWorkflow,
        cancellationReason: "migration",
      });

      const versionName = versionsToMigrate.shift();
      invariant(versionName, "Version name is required");

      const newWorkflowId = await ctx.runMutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: workflow.name,
          workflowVersionName: versionName,
          parentContext: null,
          executionMode: "fastForward",
          migrationFromWorkflowId: sourceWorkflowId,
        }
      );

      prevWorkflow = {
        workflowId: newWorkflowId,
        workflowName: workflow.name,
        workflowVersionName: versionName,
      };
    }
  },
});
