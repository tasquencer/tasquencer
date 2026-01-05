import { z } from "zod";
import { type Id } from "../../../_generated/dataModel";
import {
  type RegisterScheduled,
  type WorkflowExecutionMode,
} from "../../types";
import { type Get } from "type-fest";
import { type AuditCallbackInfo } from "../../audit/integration";
import { assertIsInternalMutation } from "../../exceptions/helpers";
import { type WorkflowParent } from "../workflow";
import { type WorkflowInfo } from "../types";
import type { GenericMutationCtx } from "convex/server";

export type WorkflowActionContext<
  TMutationCtx extends GenericMutationCtx<any>,
  TWorkflowPayload,
> = {
  mutationCtx: TMutationCtx;
  isInternalMutation: boolean;
  executionMode: WorkflowExecutionMode;
  parent: WorkflowParent | undefined;
  workflow: TWorkflowPayload;
  audit: AuditCallbackInfo;
};

export type WorkflowInitializeActionContext<
  TMutationCtx extends GenericMutationCtx<any>,
> = WorkflowActionContext<
  TMutationCtx,
  {
    name: string;
    initialize: () => Promise<Id<"tasquencerWorkflows">>;
  }
> & {
  registerScheduled: RegisterScheduled;
};
export type WorkflowInitializeAction<
  TMutationCtx extends GenericMutationCtx<any>,
  TSchema extends z.ZodTypeAny,
> = {
  schema: TSchema;
  callback: (
    ctx: WorkflowInitializeActionContext<TMutationCtx>,
    payload: z.output<TSchema>
  ) => Promise<void>;
};

export type WorkflowCancelActionContext<
  TMutationCtx extends GenericMutationCtx<any>,
> = WorkflowActionContext<
  TMutationCtx,
  WorkflowInfo & {
    cancel: () => Promise<void>;
  }
>;

export type WorkflowCancelAction<
  TMutationCtx extends GenericMutationCtx<any>,
  TSchema extends z.ZodTypeAny,
> = {
  schema: TSchema;
  callback: (
    ctx: WorkflowCancelActionContext<TMutationCtx>,
    payload: z.output<TSchema>
  ) => Promise<void>;
};

export type GenericWorkflowActions<
  TMutationCtx extends GenericMutationCtx<any>,
  TSchema extends z.ZodTypeAny,
> = {
  initialize: WorkflowInitializeAction<TMutationCtx, TSchema>;
  cancel: WorkflowCancelAction<TMutationCtx, TSchema>;
};

export type GetWorkflowActionsDefinition<T> =
  T extends WorkflowActions<any, infer TWorkflowActions>
    ? TWorkflowActions
    : never;

export type AnyWorkflowActions = WorkflowActions<any>;

export type GetTypeForWorkflowAction<
  TWorkflowActions,
  TActionName extends keyof GenericWorkflowActions<any, any>,
> =
  TWorkflowActions extends WorkflowActions<
    any,
    infer TWorkflowActionsDefinition
  >
    ? Get<TWorkflowActionsDefinition, [TActionName, "schema"]> extends
        z.ZodTypeAny
      ? z.output<Get<TWorkflowActionsDefinition, [TActionName, "schema"]>>
      : unknown
    : never;

export class WorkflowActions<
  TMutationCtx extends GenericMutationCtx<any>,
  TWorkflowActionsDefinition = Record<never, never>,
> {
  static make<TMutationCtx extends GenericMutationCtx<any>>() {
    return new WorkflowActions<TMutationCtx>({
      initialize: {
        schema: z.any().optional(),
        callback: async (ctx) => {
          assertIsInternalMutation(ctx.isInternalMutation);
          await ctx.workflow.initialize();
        },
      },

      cancel: {
        schema: z.any().optional(),
        callback: async (ctx) => {
          assertIsInternalMutation(ctx.isInternalMutation);
          await ctx.workflow.cancel();
        },
      },
    });
  }
  constructor(readonly actions: GenericWorkflowActions<any, any>) {}
  initialize<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    callback: (
      ctx: WorkflowInitializeActionContext<TMutationCtx>,
      payload: z.output<TSchema>
    ) => Promise<void>
  ) {
    const definition: WorkflowInitializeAction<TMutationCtx, TSchema> = {
      schema,
      callback,
    };

    return new WorkflowActions<
      TMutationCtx,
      TWorkflowActionsDefinition & {
        initialize: WorkflowInitializeAction<TMutationCtx, TSchema>;
      }
    >({
      ...this.actions,
      initialize: definition,
    });
  }

  cancel<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    callback: (
      ctx: WorkflowCancelActionContext<TMutationCtx>,
      payload: z.output<TSchema>
    ) => Promise<void>
  ) {
    const definition: WorkflowCancelAction<TMutationCtx, TSchema> = {
      schema,
      callback,
    };

    return new WorkflowActions<
      TMutationCtx,
      TWorkflowActionsDefinition & {
        cancel: WorkflowCancelAction<TMutationCtx, TSchema>;
      }
    >({
      ...this.actions,
      cancel: definition,
    });
  }
}

export function makeWorkflowActions<
  TMutationCtx extends GenericMutationCtx<any>,
>() {
  return function () {
    return WorkflowActions.make<TMutationCtx>();
  };
}
