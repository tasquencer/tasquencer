import { type Get } from "type-fest";
import { type MutationCtx } from "../../_generated/server";
import { Task } from "../elements/task";
import { WorkItem } from "../elements/workItem";
import {
  type RegisterScheduled,
  type ShouldBeOptional,
  type WorkflowExecutionMode,
} from "../types";
import { type AuditCallbackInfo } from "../audit/integration";
import {
  type AnyWorkItemActions,
  type GenericWorkItemActions,
  type GetSchemaForWorkItemAction,
  makeWorkItemActions,
  type WorkItemActions,
} from "./workItem/actions";
import type { WorkItemInfo, WorkItemParentInfo } from "./types";
import type { GenericMutationCtx } from "convex/server";

export type { AnyWorkItemActions } from "./workItem/actions";

const workItemActions = makeWorkItemActions<GenericMutationCtx<any>>();

export type WorkItemActivityContext = {
  mutationCtx: MutationCtx;
  isInternalMutation: boolean;
  executionMode: WorkflowExecutionMode;
  parent: WorkItemParentInfo;
  audit: AuditCallbackInfo;
};

export type WorkItemOnInitializedContext<
  TWorkItemStartActionPayload = unknown,
> = WorkItemActivityContext & {
  registerScheduled: RegisterScheduled;
  workItem: WorkItemInfo & {
    start: ShouldBeOptional<TWorkItemStartActionPayload> extends true
      ? (payload?: TWorkItemStartActionPayload) => void
      : (payload: TWorkItemStartActionPayload) => void;
  };
};

export type WorkItemOnStartedContext<
  TWorkItemCompleteActionPayload = unknown,
  TWorkItemFailActionPayload = unknown,
  TWorkItemCancelActionPayload = unknown,
> = WorkItemActivityContext & {
  registerScheduled: RegisterScheduled;
  workItem: WorkItemInfo & {
    complete: ShouldBeOptional<TWorkItemCompleteActionPayload> extends true
      ? (payload?: TWorkItemCompleteActionPayload) => void
      : (payload: TWorkItemCompleteActionPayload) => void;
    fail: ShouldBeOptional<TWorkItemFailActionPayload> extends true
      ? (payload?: TWorkItemFailActionPayload) => void
      : (payload: TWorkItemFailActionPayload) => void;
    cancel: ShouldBeOptional<TWorkItemCancelActionPayload> extends true
      ? (payload?: TWorkItemCancelActionPayload) => void
      : (payload: TWorkItemCancelActionPayload) => void;
  };
};

export type WorkItemOnCompletedContext = WorkItemActivityContext & {
  workItem: WorkItemInfo;
};

export type WorkItemOnFailedContext = WorkItemActivityContext & {
  workItem: WorkItemInfo;
};

export type WorkItemOnCanceledContext = WorkItemActivityContext & {
  workItem: WorkItemInfo;
};

/**
 * Context provided to the `onReset` activity callback.
 *
 * Called after a work item transitions from `started` to `initialized` via reset.
 * Use this for cleanup of partial work or logging.
 */
export type WorkItemOnResetContext = WorkItemActivityContext & {
  workItem: WorkItemInfo;
};

export type WorkItemActivities<
  TWorkItemActions extends AnyWorkItemActions = AnyWorkItemActions,
> = {
  onInitialized: (
    ctx: WorkItemOnInitializedContext<
      GetSchemaForWorkItemAction<TWorkItemActions, "start">
    >
  ) => Promise<any>;
  onStarted: (
    ctx: WorkItemOnStartedContext<
      GetSchemaForWorkItemAction<TWorkItemActions, "complete">,
      GetSchemaForWorkItemAction<TWorkItemActions, "fail">,
      GetSchemaForWorkItemAction<TWorkItemActions, "cancel">
    >
  ) => Promise<any>;
  onCompleted: (ctx: WorkItemOnCompletedContext) => Promise<any>;
  onFailed: (ctx: WorkItemOnFailedContext) => Promise<any>;
  onCanceled: (ctx: WorkItemOnCanceledContext) => Promise<any>;
  onReset: (ctx: WorkItemOnResetContext) => Promise<any>;
};

export type WorkItemDefinitionInit<TWorkItemName extends string> = {
  name: TWorkItemName;
};

export type WorkItemDefinition<
  TWorkItemDefinition extends WorkItemDefinitionInit<string>,
> = {
  name: Get<TWorkItemDefinition, "name">;
};

export type GetWorkItemDefinitionName<TWorkItemDefinition> =
  TWorkItemDefinition extends WorkItemDefinitionInit<infer TWorkItemName>
    ? TWorkItemName
    : never;

export type AnyWorkItemBuilder = WorkItemBuilder<any, any, any>;

export type GetWorkItemBuilderName<TWorkItemBuilder> =
  TWorkItemBuilder extends WorkItemBuilder<any, infer TWorkItemName, any>
    ? TWorkItemName
    : never;

export type GetWorkItemBuilderActions<TWorkItemBuilder> =
  TWorkItemBuilder extends WorkItemBuilder<any, any, infer TWorkItemActions>
    ? TWorkItemActions
    : never;

/**
 * Fluent builder for defining work items.
 *
 * Work items encapsulate the boundary between Tasquencer and application code.
 * Builders collect lifecycle activities and Work Item actions which are compiled into
 * the runtime {@link WorkItem} element.
 *
 * @typeParam TWorkItemName - Work item identifier.
 * @typeParam TWorkItemActions - Registered work item actions.
 */
export class WorkItemBuilder<
  TMutationCtx extends GenericMutationCtx<any>,
  TWorkItemName extends string,
  TWorkItemActions extends AnyWorkItemActions,
> {
  /**
   * Create a work item builder with default no-op activities and actions.
   *
   * @param name - Work item identifier unique within the task.
   */
  static make<
    TMutationCtx extends GenericMutationCtx<any>,
    TWorkItemName extends string,
  >(name: TWorkItemName) {
    return new WorkItemBuilder<
      TMutationCtx,
      TWorkItemName,
      WorkItemActions<any, GenericWorkItemActions<any, any>>
    >(
      name,
      {
        onInitialized: async () => {},
        onStarted: async () => {},
        onCompleted: async () => {},
        onFailed: async () => {},
        onCanceled: async () => {},
        onReset: async () => {},
      },
      workItemActions(),
      undefined
    );
  }
  private constructor(
    readonly name: TWorkItemName,
    private readonly activities: WorkItemActivities,
    private readonly actions: TWorkItemActions,
    readonly description: string | undefined
  ) {}

  /**
   * Override the work item's exposed actions.
   *
   * @param actions - Action definitions with schemas and callbacks.
   */
  withActions<
    TActions extends WorkItemActions<any, GenericWorkItemActions<any, any>>,
  >(actions: TActions) {
    return new WorkItemBuilder<TMutationCtx, TWorkItemName, TActions>(
      this.name,
      this.activities,
      actions,
      this.description
    );
  }

  /**
   * Override lifecycle activities.
   *
   * @param activities - Partial activity set to merge with existing callbacks.
   */
  withActivities(activities: Partial<WorkItemActivities<TWorkItemActions>>) {
    return new WorkItemBuilder<TMutationCtx, TWorkItemName, TWorkItemActions>(
      this.name,
      {
        ...this.activities,
        ...activities,
      },
      this.actions,
      this.description
    );
  }

  /**
   * Attach documentation describing the work item.
   */
  withDescription(description: string) {
    return new WorkItemBuilder<TMutationCtx, TWorkItemName, TWorkItemActions>(
      this.name,
      this.activities,
      this.actions,
      description
    );
  }

  /**
   * Compile the builder into a runtime {@link WorkItem}.
   *
   * @param task - Parent task receiving the work item.
   */
  build(versionName: string, task: Task) {
    const { name, activities, actions } = this;
    return new WorkItem(
      name,
      versionName,
      [...task.path, name],
      activities,
      actions.actions,
      task
    );
  }
}

export function makeWorkItemBuilder<
  TMutationCtx extends GenericMutationCtx<any>,
>() {
  return function <TWorkItemName extends string>(name: TWorkItemName) {
    return WorkItemBuilder.make<TMutationCtx, TWorkItemName>(name);
  };
}
