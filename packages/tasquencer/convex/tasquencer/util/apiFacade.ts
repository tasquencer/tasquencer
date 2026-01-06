import { internalMutation, mutation } from "../../_generated/server";

import * as impl from "./apiImpl";
import {
  type GetSchemaForWorkflowAction,
  type AnyWorkflowBuilder,
  type GetWorkflowBuilderActions,
  type GetWorkflowBuilderActionsRegistry,
  type GetWorkflowBuilderTaskNames,
  type GetWorkflowActions,
  type GetWorkItemActions,
} from "../builder";
import {
  type GenericDatabaseReader,
  type RegisteredMutation,
} from "convex/server";
import { type Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import { type Simplify, type Get } from "type-fest";
import { type TaskState } from "../types";
import { extractWorkflowStructure } from "./extractWorkflowStructure";
import {
  getWorkflowState,
  getWorkItemState,
  safeGetWorkflowState,
  safeGetWorkItemState,
} from "./apiImpl";
import type { AnyMigration } from "../versionManager/migration";
import { makeAuditFunctionHandles } from "../audit/integration";
import type { ComponentApi } from "../../components/audit/src/component/_generated/component";
import { z } from "zod";
import { zodToConvex } from "convex-helpers/server/zod4";
import { CompositeTaskBuilder } from "../builder/compositeTask";
import { DynamicCompositeTaskBuilder } from "../builder/dynamicCompositeTask";
import { DummyTaskBuilder } from "../builder/dummyTask";

type GetWorkflowTaskStatesReturnType<
  TWorkflowNamesToTaskNames extends Record<string, string>,
  TWorkflowName extends string,
> = {
  [TKey in Get<TWorkflowNamesToTaskNames, TWorkflowName> & string]: TaskState;
};

type WorkflowActionSchemas = {
  initialize: { schema: z.ZodTypeAny };
  cancel: { schema: z.ZodTypeAny };
};

type WorkItemActionSchemas = {
  initialize: { schema: z.ZodTypeAny };
  start: { schema: z.ZodTypeAny };
  complete: { schema: z.ZodTypeAny };
  fail: { schema: z.ZodTypeAny };
  cancel: { schema: z.ZodTypeAny };
  reset: { schema: z.ZodTypeAny };
};

const isOptionalPayloadSchema = (schema: z.ZodTypeAny) =>
  schema instanceof z.ZodNever ? true : schema.safeParse(undefined).success;

const toPayloadSchema = (schema: z.ZodTypeAny) =>
  isOptionalPayloadSchema(schema) ? schema.optional() : schema;

const toPayloadValidator = (schema: z.ZodTypeAny) => {
  if (schema instanceof z.ZodNever) {
    return v.optional(v.object({}));
  }
  return zodToConvex(toPayloadSchema(schema));
};

const toActionArgsValidator = (
  entries: Array<{ name: string; schema: z.ZodTypeAny }>,
  fallback: ReturnType<typeof v.object>
) => {
  if (entries.length === 0) {
    return fallback;
  }

  const validators = entries.map((entry) => {
    if (entry.schema instanceof z.ZodNever) {
      return v.object({
        name: v.literal(entry.name),
        payload: v.optional(v.object({})),
      });
    }
    return zodToConvex(
      z.object({
        name: z.literal(entry.name),
        payload: toPayloadSchema(entry.schema),
      })
    );
  });

  return validators.length === 1 ? validators[0] : v.union(...validators);
};

const collectActionSchemas = (workflowBuilder: AnyWorkflowBuilder) => {
  const workflowActions = new Map<string, WorkflowActionSchemas>();
  const workItemActions = new Map<string, WorkItemActionSchemas>();

  const visitWorkflow = (builder: AnyWorkflowBuilder) => {
    const workflowActionInstance = (builder as any).actions as
      | { actions: WorkflowActionSchemas }
      | undefined;
    if (workflowActionInstance?.actions) {
      workflowActions.set(builder.name, workflowActionInstance.actions);
    }

    const tasks = (builder as any).elements?.tasks ?? {};
    for (const taskBuilder of Object.values(tasks) as any[]) {
      if (taskBuilder instanceof CompositeTaskBuilder) {
        visitWorkflow(taskBuilder.workflowBuilder as AnyWorkflowBuilder);
        continue;
      }
      if (taskBuilder instanceof DynamicCompositeTaskBuilder) {
        for (const childWorkflowBuilder of taskBuilder.workflowBuilders as AnyWorkflowBuilder[]) {
          visitWorkflow(childWorkflowBuilder);
        }
        continue;
      }
      if (taskBuilder instanceof DummyTaskBuilder) {
        continue;
      }

      const workItemBuilder = taskBuilder.getWorkItemBuilder();
      const workItemActionInstance = (workItemBuilder as any).actions as
        | { actions: WorkItemActionSchemas }
        | undefined;
      if (workItemActionInstance?.actions) {
        workItemActions.set(
          workItemBuilder.name,
          workItemActionInstance.actions
        );
      }
    }
  };

  visitWorkflow(workflowBuilder);

  return {
    workflowActions: [...workflowActions.entries()].map(([name, actions]) => ({
      name,
      actions,
    })),
    workItemActions: [...workItemActions.entries()].map(([name, actions]) => ({
      name,
      actions,
    })),
  };
};

export function apiFor<
  TVersionName extends string,
  TWorkflowBuilder extends AnyWorkflowBuilder,
>(
  versionName: TVersionName,
  workflowBuilder: TWorkflowBuilder,
  auditComponent: ComponentApi,
  props: {
    isVersionDeprecated: boolean;
    migration?: undefined | AnyMigration;
  }
) {
  const workflowNetwork = workflowBuilder.build(versionName, props);
  const { workflowActions, workItemActions } =
    collectActionSchemas(workflowBuilder);

  const rootWorkflowActions = (workflowBuilder as any).actions?.actions as
    | WorkflowActionSchemas
    | undefined;

  const workflowInitializeArgsValidator = toActionArgsValidator(
    workflowActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.initialize.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workflowCancelArgsValidator = toActionArgsValidator(
    workflowActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.cancel.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemInitializeArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.initialize.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemStartArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.start.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemCompleteArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.complete.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemFailArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.fail.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemCancelArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.cancel.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const workItemResetArgsValidator = toActionArgsValidator(
    workItemActions.map((entry) => ({
      name: entry.name,
      schema: entry.actions.reset.schema,
    })),
    v.object({
      name: v.string(),
      payload: v.optional(v.any()),
    })
  );

  const rootInitializePayloadValidator = rootWorkflowActions
    ? toPayloadValidator(rootWorkflowActions.initialize.schema)
    : v.optional(v.any());

  const rootCancelPayloadValidator = rootWorkflowActions
    ? toPayloadValidator(rootWorkflowActions.cancel.schema)
    : v.optional(v.any());

  type WorkflowNetworkActionsRegistry =
    GetWorkflowBuilderActionsRegistry<TWorkflowBuilder>;
  type RootWorkflowBuilderActions = Get<
    GetWorkflowBuilderActions<TWorkflowBuilder>,
    "actions"
  >;
  type WorkflowActions = GetWorkflowActions<WorkflowNetworkActionsRegistry>;
  type WorkItemActions = GetWorkItemActions<WorkflowNetworkActionsRegistry>;

  const initializeRootWorkflow = mutation({
    args: {
      payload: rootInitializePayloadValidator,
      parentContext: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeRootWorkflow(
        ctx,
        auditFunctionHandles,
        false,
        {
          workflowNetwork,
          payload: args.payload,
          parentContext: args.parentContext,
        }
      );
    },
  }) as RegisteredMutation<
    "public",
    {
      payload: GetSchemaForWorkflowAction<
        RootWorkflowBuilderActions,
        "initialize"
      >;
      parentContext?: any;
    },
    Promise<Id<"tasquencerWorkflows">>
  >;

  const internalInitializeRootWorkflow = internalMutation({
    args: {
      payload: rootInitializePayloadValidator,
      parentContext: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeRootWorkflow(
        ctx,
        auditFunctionHandles,
        true,
        {
          workflowNetwork,
          payload: args.payload,
          parentContext: args.parentContext,
        }
      );
    },
  }) as RegisteredMutation<
    "internal",
    {
      payload: GetSchemaForWorkflowAction<
        RootWorkflowBuilderActions,
        "initialize"
      >;
      parentContext?: any;
    },
    Promise<Id<"tasquencerWorkflows">>
  >;

  const cancelRootWorkflow = mutation({
    args: {
      workflowId: v.id("tasquencerWorkflows"),
      payload: rootCancelPayloadValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelRootWorkflow(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workflowId: args.workflowId,
        payload: args.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workflowId: Id<"tasquencerWorkflows">;
      payload: GetSchemaForWorkflowAction<RootWorkflowBuilderActions, "cancel">;
    },
    Promise<null>
  >;

  const internalCancelRootWorkflow = internalMutation({
    args: {
      workflowId: v.id("tasquencerWorkflows"),
      payload: rootCancelPayloadValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelRootWorkflow(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workflowId: args.workflowId,
        payload: args.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workflowId: Id<"tasquencerWorkflows">;
      payload: GetSchemaForWorkflowAction<RootWorkflowBuilderActions, "cancel">;
    },
    Promise<null>
  >;

  const initializeWorkflow = mutation({
    args: {
      target: v.object({
        path: v.array(v.string()),
        parentWorkflowId: v.id("tasquencerWorkflows"),
        parentTaskName: v.string(),
      }),
      args: workflowInitializeArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeWorkflow(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        target: args.target,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      target: {
        path: string[];
        parentWorkflowId: Id<"tasquencerWorkflows">;
        parentTaskName: string;
      };
      args: Get<WorkflowActions, "initialize">;
    },
    Promise<Id<"tasquencerWorkflows">>
  >;

  const internalInitializeWorkflow = internalMutation({
    args: {
      target: v.object({
        path: v.array(v.string()),
        parentWorkflowId: v.id("tasquencerWorkflows"),
        parentTaskName: v.string(),
      }),
      args: workflowInitializeArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeWorkflow(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        target: args.target,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      target: {
        path: string[];
        parentWorkflowId: Id<"tasquencerWorkflows">;
        parentTaskName: string;
      };
      args: Get<WorkflowActions, "initialize">;
    },
    Promise<Id<"tasquencerWorkflows">>
  >;

  const cancelWorkflow = mutation({
    args: {
      workflowId: v.id("tasquencerWorkflows"),
      args: workflowCancelArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelWorkflow(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workflowId: args.workflowId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workflowId: Id<"tasquencerWorkflows">;
      args: Get<WorkflowActions, "cancel">;
    },
    Promise<null>
  >;

  const internalCancelWorkflow = internalMutation({
    args: {
      workflowId: v.id("tasquencerWorkflows"),
      args: workflowCancelArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelWorkflow(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workflowId: args.workflowId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workflowId: Id<"tasquencerWorkflows">;
      args: Get<WorkflowActions, "cancel">;
    },
    Promise<null>
  >;

  const initializeWorkItem = mutation({
    args: {
      target: v.object({
        path: v.array(v.string()),
        parentWorkflowId: v.id("tasquencerWorkflows"),
        parentTaskName: v.string(),
      }),
      args: workItemInitializeArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        target: args.target,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      target: {
        path: string[];
        parentWorkflowId: Id<"tasquencerWorkflows">;
        parentTaskName: string;
      };
      args: Get<WorkItemActions, "initialize">;
    },
    Promise<Id<"tasquencerWorkItems">>
  >;

  const internalInitializeWorkItem = internalMutation({
    args: {
      target: v.object({
        path: v.array(v.string()),
        parentWorkflowId: v.id("tasquencerWorkflows"),
        parentTaskName: v.string(),
      }),
      args: workItemInitializeArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.initializeWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        target: args.target,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      target: {
        path: string[];
        parentWorkflowId: Id<"tasquencerWorkflows">;
        parentTaskName: string;
      };
      args: Get<WorkItemActions, "initialize">;
    },
    Promise<Id<"tasquencerWorkItems">>
  >;

  const startWorkItem = mutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemStartArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.startWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "start">;
    },
    Promise<null>
  >;

  const internalStartWorkItem = internalMutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemStartArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.startWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "start">;
    },
    Promise<null>
  >;

  const completeWorkItem = mutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemCompleteArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.completeWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "complete">;
    },
    Promise<null>
  >;

  const internalCompleteWorkItem = internalMutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemCompleteArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.completeWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "complete">;
    },
    Promise<null>
  >;

  const resetWorkItem = mutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemResetArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.resetWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "reset">;
    },
    Promise<null>
  >;

  const internalResetWorkItem = internalMutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemResetArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.resetWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "reset">;
    },
    Promise<null>
  >;

  const failWorkItem = mutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemFailArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.failWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "fail">;
    },
    Promise<null>
  >;

  const internalFailWorkItem = internalMutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemFailArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.failWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "fail">;
    },
    Promise<null>
  >;

  const cancelWorkItem = mutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemCancelArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelWorkItem(ctx, auditFunctionHandles, false, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "public",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "cancel">;
    },
    Promise<null>
  >;

  const internalCancelWorkItem = internalMutation({
    args: {
      workItemId: v.id("tasquencerWorkItems"),
      args: workItemCancelArgsValidator,
    },
    handler: async (ctx, args) => {
      const auditFunctionHandles =
        await makeAuditFunctionHandles(auditComponent);
      return await impl.cancelWorkItem(ctx, auditFunctionHandles, true, {
        workflowNetwork,
        workItemId: args.workItemId,
        payload: args.args!.payload,
      });
    },
  }) as RegisteredMutation<
    "internal",
    {
      workItemId: Id<"tasquencerWorkItems">;
      args: Get<WorkItemActions, "cancel">;
    },
    Promise<null>
  >;

  const getWorkflowTaskStates = async <TWorkflowName extends string>(
    db: GenericDatabaseReader<any>,
    args: {
      workflowName: TWorkflowName;
      workflowId: Id<"tasquencerWorkflows">;
    }
  ) => {
    const result = await impl.getWorkflowTaskStates(db, {
      workflowId: args.workflowId,
    });

    return result as Simplify<
      GetWorkflowTaskStatesReturnType<
        GetWorkflowBuilderTaskNames<TWorkflowBuilder>,
        TWorkflowName
      >
    >;
  };

  const getWorkflowStructure = function () {
    return extractWorkflowStructure(workflowBuilder);
  };

  return {
    initializeRootWorkflow,
    cancelRootWorkflow,
    initializeWorkflow,
    cancelWorkflow,
    initializeWorkItem,
    startWorkItem,
    completeWorkItem,
    resetWorkItem,
    failWorkItem,
    cancelWorkItem,
    internalInitializeRootWorkflow,
    internalCancelRootWorkflow,
    internalInitializeWorkflow,
    internalCancelWorkflow,
    internalInitializeWorkItem,
    internalStartWorkItem,
    internalCompleteWorkItem,
    internalResetWorkItem,
    internalFailWorkItem,
    internalCancelWorkItem,
    helpers: {
      getWorkflowTaskStates,
      getWorkflowStructure,
      getWorkflowState,
      getWorkItemState,
      safeGetWorkflowState,
      safeGetWorkItemState,
    },
  };
}
