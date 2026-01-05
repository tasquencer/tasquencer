import {
  type AnyTaskBuilder,
  type GetTaskBuilderWorkItemBuilder,
} from "./task";
import {
  type ShouldBeOptional,
  type GetAnyTaskSplitType,
  type RegisterScheduled,
  type ReplaceProp,
} from "../types";
import {
  type TaskFlowBuilderForSplitType,
  type OrTaskFlowBuilder,
  TaskFlowBuilder,
  XorTaskFlowBuilder,
  ConditionFlowBuilder,
  XorTaskFlowBuilderInit,
  OrTaskFlowBuilderInit,
  type AnyConditionFlowBuilder,
  type AnyTaskFlowBuilder,
  type GetFlowBuilderImplicitConditionName,
} from "./flow";
import { type MutationCtx } from "../../_generated/server";
import { Workflow } from "../elements/workflow";
import { Condition } from "../elements/condition";
import { type Get } from "type-fest";
import { z } from "zod";
import {
  type GenericWorkflowActions,
  type GetWorkflowActionsDefinition,
  makeWorkflowActions,
  type WorkflowActions,
} from "./workflow/actions";
import {
  type GenericWorkItemActions,
  type GetWorkItemActionsDefinition,
  type WorkItemActions,
} from "./workItem/actions";
import { type AuditCallbackInfo } from "../audit/integration";
import {
  type GetWorkItemBuilderActions,
  type GetWorkItemBuilderName,
} from "./workItem";
import {
  type AnyCompositeTaskBuilder,
  type GetCompositeTaskBuilderWorkflowBuilder,
} from "./compositeTask";
import type { AnyDummyTaskBuilder } from "./dummyTask";
import { CancellationRegionBuilder } from "./cancellationRegion";
import {
  WorkflowMissingStartConditionError,
  WorkflowMissingEndConditionError,
} from "../exceptions";
import type { AnyMigration } from "../versionManager/migration";
import { type TaskInfo, type WorkflowInfo } from "./types";

export type WorkflowParent = {
  task: TaskInfo;
  workflow: WorkflowInfo;
};

import { type WorkflowExecutionMode } from "../types";
import {
  type AnyDynamicCompositeTaskBuilder,
  type GetDynamicCompositeTaskBuilderWorkflowBuilder,
} from "./dynamicCompositeTask";
import type { GenericMutationCtx } from "convex/server";

const workflowActions = makeWorkflowActions<GenericMutationCtx<any>>();

export type WorkflowActivityContext = {
  mutationCtx: MutationCtx;
  isInternalMutation: boolean;
  executionMode: WorkflowExecutionMode;
  parent: WorkflowParent | undefined;
  workflow: WorkflowInfo;
  audit: AuditCallbackInfo;
};

export type WorkflowActivity = (ctx: WorkflowActivityContext) => Promise<any>;

export type WorkflowActivities = {
  onInitialized: (
    ctx: WorkflowActivityContext & { registerScheduled: RegisterScheduled }
  ) => Promise<any>;
  onStarted: (
    ctx: WorkflowActivityContext & { registerScheduled: RegisterScheduled }
  ) => Promise<any>;
  onCompleted: WorkflowActivity;
  onFailed: WorkflowActivity;
  onCanceled: WorkflowActivity;
};

export type WorkflowElements = {
  tasks: Record<
    string,
    AnyTaskBuilder | AnyDummyTaskBuilder | AnyCompositeTaskBuilder
  >;
  conditions: string;
  implicitConditions: string;
  connectedTasks: string;
  connectedConditions: string;
  startCondition: string;
  endCondition: string;
  flows: {
    tasks: Record<
      string,
      | XorTaskFlowBuilder<any, any, any, any, any>
      | OrTaskFlowBuilder<any, any, any, any, any>
      | TaskFlowBuilder<any, any, any>
    >;
    conditions: Record<string, ConditionFlowBuilder<any>>;
  };
};

export type AnyWorkflowBuilder = WorkflowBuilder<any, any, any, any, any, any>;

export type WorkflowActionsRegistry = {
  workflow: {
    name: string;
    actions: WorkflowActions<any>;
  };
  workItem: {
    name: string;
    actions: WorkItemActions<any>;
  };
};

export type MergeWorkItemActionsToWorkflowActionsRegistry<
  TWorkflowActionsRegistry extends WorkflowActionsRegistry,
  TWorkItemActions extends { name: string; actions: WorkItemActions<any> },
> = {
  workflow: Get<TWorkflowActionsRegistry, "workflow">;
  workItem:
    | Exclude<
        Get<TWorkflowActionsRegistry, "workItem">,
        { name: Get<TWorkItemActions, "name"> }
      >
    | TWorkItemActions;
};

export type MergeWorkflowActionRegistries<
  TWorkflowActionsRegistryBase extends WorkflowActionsRegistry,
  TWorkflowActionsRegistry extends WorkflowActionsRegistry,
> = {
  workflow:
    | Exclude<
        TWorkflowActionsRegistryBase["workflow"],
        { name: Get<TWorkflowActionsRegistry, ["workflow", "name"]> }
      >
    | Get<TWorkflowActionsRegistry, "workflow">;
  workItem:
    | Exclude<
        TWorkflowActionsRegistryBase["workItem"],
        { name: Get<TWorkflowActionsRegistry, ["workItem", "name"]> }
      >
    | Get<TWorkflowActionsRegistry, "workItem">;
};

export type TaskToChildElement = {
  parentWorkflowName: string;
  taskName: string;
  child:
    | {
        type: "workItem";
        name: string;
      }
    | {
        type: "workflow";
        name: string;
      };
};

const noOpActivities = {
  onInitialized: async () => {},
  onStarted: async () => {},
  onCompleted: async () => {},
  onFailed: async () => {},
  onCanceled: async () => {},
};

export type GetWorkflowBuilderName<T> =
  T extends WorkflowBuilder<any, infer TWorkflowName, any, any, any, any>
    ? TWorkflowName
    : never;

export type GetWorkflowBuilderActionsRegistry<TWorkflowBuilder> =
  TWorkflowBuilder extends WorkflowBuilder<
    any,
    any,
    infer TWorkflowActions,
    any,
    any,
    any
  >
    ? TWorkflowActions
    : never;

export type GetWorkflowBuilderActions<TWorkflowBuilder> =
  TWorkflowBuilder extends WorkflowBuilder<
    any,
    infer TWorkflowName,
    infer TWorkflowActions,
    any,
    any,
    any
  >
    ? Extract<Get<TWorkflowActions, "workflow">, { name: TWorkflowName }>
    : never;

export type GetWorkflowBuilderWorkflowElements<T> =
  T extends WorkflowBuilder<any, any, any, infer TWorkflowElements, any, any>
    ? TWorkflowElements
    : never;

export type GetWorkflowBuilderSubWorkflowTaskNames<T> =
  T extends WorkflowBuilder<
    any,
    any,
    any,
    infer _TWorkflowElements,
    infer TWorkflowSubWorkflowTaskNames,
    any
  >
    ? TWorkflowSubWorkflowTaskNames
    : never;

export type GetWorkflowBuilderTaskToChildElement<T> =
  T extends WorkflowBuilder<any, any, any, any, any, infer TTaskToChildElement>
    ? TTaskToChildElement
    : never;

type MaybeOptionalPayload<T extends { name: string; payload: any }> =
  ShouldBeOptional<T["payload"]> extends true
    ? {
        name: T["name"];
        payload?: T["payload"];
      }
    : T;

export type GetWorkflowBuilderTaskNames<
  TWorkflowBuilder extends AnyWorkflowBuilder,
> = {
  [key in GetWorkflowBuilderName<TWorkflowBuilder>]: keyof Get<
    GetWorkflowBuilderWorkflowElements<TWorkflowBuilder>,
    "tasks"
  >;
} & GetWorkflowBuilderSubWorkflowTaskNames<TWorkflowBuilder>;

export type GetWorkflowActions<
  TWorkflowBuilderActionsRegistry extends WorkflowActionsRegistry,
  TWorkflowActions extends {
    name: string;
    actions: WorkflowActions<any, any>;
  } = Get<TWorkflowBuilderActionsRegistry, "workflow">,
> = {
  [TActionName in keyof GenericWorkflowActions<
    any,
    any
  >]: TWorkflowActions extends any
    ? MaybeOptionalPayload<{
        name: Get<TWorkflowActions, "name">;
        payload: Get<
          GetWorkflowActionsDefinition<Get<TWorkflowActions, ["actions"]>>,
          [TActionName, "schema"]
        > extends z.ZodTypeAny
          ? z.output<
              Get<
                GetWorkflowActionsDefinition<Get<TWorkflowActions, ["actions"]>>,
                [TActionName, "schema"]
              >
            >
          : unknown;
      }>
    : never;
};

export type GetWorkItemActions<
  TWorkflowBuilderActionsRegistry extends WorkflowActionsRegistry,
  TWorkItemActions extends {
    name: string;
    actions: WorkItemActions<any, any>;
  } = Get<TWorkflowBuilderActionsRegistry, "workItem">,
> = {
  [TActionName in keyof GenericWorkItemActions<
    any,
    any
  >]: TWorkItemActions extends any
    ? MaybeOptionalPayload<{
        name: Get<TWorkItemActions, "name">;
        payload: Get<
          GetWorkItemActionsDefinition<Get<TWorkItemActions, ["actions"]>>,
          [TActionName, "schema"]
        > extends z.ZodTypeAny
          ? z.output<
              Get<
                GetWorkItemActionsDefinition<Get<TWorkItemActions, ["actions"]>>,
                [TActionName, "schema"]
              >
            >
          : unknown;
      }>
    : never;
};

type DynamicCompositeTaskWorkflowBuilderUnionToTaskToChildElement<
  TDynamicCompositeTaskBuilder extends AnyDynamicCompositeTaskBuilder,
  TWorkflowName extends string,
  TDynamicCompositeTaskName extends string,
  TWorkflowBuilder =
    GetDynamicCompositeTaskBuilderWorkflowBuilder<TDynamicCompositeTaskBuilder>,
> = TWorkflowBuilder extends TWorkflowBuilder
  ? {
      parentWorkflowName: TWorkflowName;
      taskName: TDynamicCompositeTaskName;
      child: {
        type: "workflow";
        name: GetWorkflowBuilderName<TWorkflowBuilder>;
      };
    }
  : never;

/**
 * Fluent builder for defining Tasquencer workflows.
 *
 * The builder captures task/condition topology, associated actions and activities,
 * and cancellation regions in a type-safe structure that is later compiled into the
 * runtime {@link Workflow}. Most mutations return a new instance with refined type
 * information so downstream calls have accurate task/condition names.
 *
 * @typeParam TWorkflowName - Unique workflow identifier.
 * @typeParam TWorkflowActionsRegistry - Registry of registered workflow/work item actions.
 * @typeParam TWorkflowElements - Accumulated workflow structure metadata.
 * @typeParam TWorkflowSubWorkflowTaskNames - Mapping of composite task names to their child workflows.
 */
export class WorkflowBuilder<
  TMutationCtx extends GenericMutationCtx<any>,
  TWorkflowName extends string,
  TWorkflowActionsRegistry extends WorkflowActionsRegistry = {
    workflow: never;
    workItem: never;
  },
  TWorkflowElements extends WorkflowElements = {
    tasks: Record<never, never>;
    conditions: never;
    implicitConditions: never;
    connectedTasks: never;
    connectedConditions: never;
    startCondition: never;
    endCondition: never;
    flows: { tasks: Record<never, never>; conditions: Record<never, never> };
  },
  TWorkflowSubWorkflowTaskNames extends Record<string, string> = Record<
    never,
    never
  >,
  TTaskToChildElement extends TaskToChildElement = never,
> {
  /**
   * Create a new workflow builder seeded with the provided name.
   *
   * @param name - Logical workflow identifier used during registration.
   */
  static make<
    TMutationCtx extends GenericMutationCtx<any>,
    TWorkflowName extends string,
  >(name: TWorkflowName) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      {
        workflow: {
          name: TWorkflowName;
          actions: WorkflowActions<any>;
        };
        workItem: never;
      }
    >(
      name,
      {
        ...noOpActivities,
      },
      workflowActions(),
      {
        tasks: {},
        conditions: [],
        startCondition: undefined,
        endCondition: undefined,
        connectedTasks: [],
        connectedConditions: [],
        flows: { tasks: {}, conditions: {} },
      },
      {},
      undefined
    );
  }

  private constructor(
    readonly name: TWorkflowName,
    private readonly activities: WorkflowActivities,
    private readonly actions: WorkflowActions<
      any,
      GenericWorkflowActions<any, any>
    >,
    readonly elements: {
      tasks: Record<
        string,
        | AnyTaskBuilder
        | AnyCompositeTaskBuilder
        | AnyDummyTaskBuilder
        | AnyDynamicCompositeTaskBuilder
      >;
      conditions: string[];
      startCondition: undefined | string;
      endCondition: undefined | string;
      connectedTasks: string[];
      connectedConditions: string[];
      flows: {
        tasks: Record<string, AnyTaskFlowBuilder>;
        conditions: Record<string, AnyConditionFlowBuilder>;
      };
    },
    private readonly cancellationRegions: Record<
      string,
      {
        tasks: Set<string>;
        conditions: Set<string>;
      }
    >,
    readonly description: string | undefined
  ) {}

  /**
   * Attach documentation explaining the workflow.
   */
  withDescription(description: string) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      TWorkflowElements,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      this.elements,
      this.cancellationRegions,
      description
    );
  }
  /**
   * Add a concrete task to the workflow definition.
   *
   * Registers the task builder, merges its work item actions into the workflow registry,
   * and returns an updated builder with the new task name reflected in the type system.
   *
   * @param name - Task identifier unique within the workflow.
   * @param taskBuilder - Builder describing the task's behaviour and activities.
   */
  task<TTaskName extends string, TTaskBuilder extends AnyTaskBuilder>(
    name: TTaskName,
    taskBuilder: TTaskBuilder
  ) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      MergeWorkItemActionsToWorkflowActionsRegistry<
        TWorkflowActionsRegistry,
        {
          name: GetWorkItemBuilderName<
            GetTaskBuilderWorkItemBuilder<TTaskBuilder>
          >;
          actions: GetWorkItemBuilderActions<
            GetTaskBuilderWorkItemBuilder<TTaskBuilder>
          >;
        }
      >,
      ReplaceProp<
        TWorkflowElements,
        "tasks",
        Get<TWorkflowElements, "tasks"> & {
          [key in TTaskName]: TTaskBuilder;
        }
      >,
      TWorkflowSubWorkflowTaskNames,
      | TTaskToChildElement
      | {
          parentWorkflowName: TWorkflowName;
          taskName: TTaskName;
          child: {
            type: "workItem";
            name: GetWorkItemBuilderName<
              GetTaskBuilderWorkItemBuilder<TTaskBuilder>
            >;
          };
        }
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        tasks: {
          ...this.elements.tasks,
          [name]: taskBuilder,
        },
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Add a composite task (sub-workflow) to the workflow definition.
   *
   * The child workflow's actions are merged into the parent's registry so callers can
   * initialize or cancel nested workflows through the generated API.
   *
   * @param name - Task identifier unique within the workflow.
   * @param compositeTaskBuilder - Builder wrapping the child workflow.
   */
  compositeTask<
    TCompositeTaskName extends string,
    TCompositeTaskBuilder extends AnyCompositeTaskBuilder,
  >(name: TCompositeTaskName, compositeTaskBuilder: TCompositeTaskBuilder) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      MergeWorkflowActionRegistries<
        TWorkflowActionsRegistry,
        GetWorkflowBuilderActionsRegistry<
          GetCompositeTaskBuilderWorkflowBuilder<TCompositeTaskBuilder>
        >
      >,
      ReplaceProp<
        TWorkflowElements,
        "tasks",
        Get<TWorkflowElements, "tasks"> & {
          [key in TCompositeTaskName]: TCompositeTaskBuilder;
        }
      >,
      TWorkflowSubWorkflowTaskNames &
        GetWorkflowBuilderTaskNames<
          GetCompositeTaskBuilderWorkflowBuilder<TCompositeTaskBuilder>
        >,
      | TTaskToChildElement
      | {
          parentWorkflowName: TWorkflowName;
          taskName: TCompositeTaskName;
          child: {
            type: "workflow";
            name: GetWorkflowBuilderName<
              GetCompositeTaskBuilderWorkflowBuilder<TCompositeTaskBuilder>
            >;
          };
        }
      | GetWorkflowBuilderTaskToChildElement<
          GetCompositeTaskBuilderWorkflowBuilder<TCompositeTaskBuilder>
        >
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        tasks: {
          ...this.elements.tasks,
          [name]: compositeTaskBuilder,
        },
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Add a dynamic composite task (sub-workflow) to the workflow definition.
   *
   * The child workflow's actions are merged into the parent's registry so callers can
   * initialize or cancel nested workflows through the generated API.
   *
   * Dynamic composite tasks allow late binding of the child workflow type.
   *
   * @param name - Task identifier unique within the workflow.
   * @param dynamicCompositeTaskBuilder - Builder wrapping the child workflow.
   */
  dynamicCompositeTask<
    TDynamicCompositeTaskName extends string,
    TDynamicCompositeTaskBuilder extends AnyDynamicCompositeTaskBuilder,
  >(
    name: TDynamicCompositeTaskName,
    compositeTaskBuilder: TDynamicCompositeTaskBuilder
  ) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      MergeWorkflowActionRegistries<
        TWorkflowActionsRegistry,
        GetWorkflowBuilderActionsRegistry<
          GetDynamicCompositeTaskBuilderWorkflowBuilder<TDynamicCompositeTaskBuilder>
        >
      >,
      ReplaceProp<
        TWorkflowElements,
        "tasks",
        Get<TWorkflowElements, "tasks"> & {
          [key in TDynamicCompositeTaskName]: TDynamicCompositeTaskBuilder;
        }
      >,
      TWorkflowSubWorkflowTaskNames &
        GetWorkflowBuilderTaskNames<
          GetDynamicCompositeTaskBuilderWorkflowBuilder<TDynamicCompositeTaskBuilder>
        >,
      | TTaskToChildElement
      | DynamicCompositeTaskWorkflowBuilderUnionToTaskToChildElement<
          TDynamicCompositeTaskBuilder,
          TWorkflowName,
          TDynamicCompositeTaskName
        >
      | GetWorkflowBuilderTaskToChildElement<
          GetDynamicCompositeTaskBuilderWorkflowBuilder<TDynamicCompositeTaskBuilder>
        >
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        tasks: {
          ...this.elements.tasks,
          [name]: compositeTaskBuilder,
        },
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Add a dummy task to the workflow definition.
   *
   * Dummy tasks participate in routing without requiring work items or activities.
   *
   * @param name - Task identifier unique within the workflow.
   * @param dummyTaskBuilder - Builder describing the dummy task configuration.
   */
  dummyTask<
    TDummyTaskName extends string,
    TDummyTaskBuilder extends AnyDummyTaskBuilder,
  >(name: TDummyTaskName, dummyTaskBuilder: TDummyTaskBuilder) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        TWorkflowElements,
        "tasks",
        Get<TWorkflowElements, "tasks"> & {
          [key in TDummyTaskName]: TDummyTaskBuilder;
        }
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        tasks: {
          ...this.elements.tasks,
          [name]: dummyTaskBuilder,
        },
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Declare a condition (place) available within the workflow net.
   *
   * Conditions can be referenced when connecting tasks for explicit routing.
   *
   * @param name - Condition identifier unique within the workflow.
   */
  condition<TConditionName extends string>(name: TConditionName) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        TWorkflowElements,
        "conditions",
        Get<TWorkflowElements, "conditions"> | TConditionName
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        conditions: [...this.elements.conditions, name],
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Declare the workflow's start condition. Implicitly registers the condition if needed.
   *
   * @param name - Condition name that receives the initial token.
   */
  startCondition<TStartConditionName extends string>(
    name: TStartConditionName
  ) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        ReplaceProp<TWorkflowElements, "startCondition", TStartConditionName>,
        "conditions",
        Get<TWorkflowElements, "conditions"> | TStartConditionName
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        conditions: [...this.elements.conditions, name],
        startCondition: name,
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Declare the workflow's end condition. Implicitly registers the condition if needed.
   *
   * @param name - Condition name that signals completion when marked.
   */
  endCondition<TEndConditionName extends string>(name: TEndConditionName) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        ReplaceProp<TWorkflowElements, "endCondition", TEndConditionName>,
        "conditions",
        Get<TWorkflowElements, "conditions"> | TEndConditionName
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        conditions: [...this.elements.conditions, name],
        endCondition: name,
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Connect an outgoing flow from a task to conditions or successor tasks.
   *
   * The supplied flow builder enforces split semantics (AND/XOR/OR) and captures optional routers.
   *
   * @param taskName - Source task to connect from.
   * @param flowBuilder - Callback that configures the flow target(s).
   */
  connectTask<
    TTaskName extends Exclude<
      keyof TWorkflowElements["tasks"],
      TWorkflowElements["connectedTasks"]
    >,
    TFlowBuilder extends TaskFlowBuilderForSplitType<
      TMutationCtx,
      TTaskName & string,
      TWorkflowElements["tasks"][TTaskName & string],
      GetAnyTaskSplitType<
        Get<TWorkflowElements, ["tasks", TTaskName & string]>
      >,
      Exclude<keyof Get<TWorkflowElements, "tasks">, TTaskName>,
      Get<TWorkflowElements, "conditions">
    >,
  >(taskName: TTaskName & string, flowBuilder: TFlowBuilder) {
    const splitType = this.elements.tasks[taskName]?.splitType ?? "and";
    const taskFlowBuilder =
      splitType === "xor"
        ? new XorTaskFlowBuilderInit(taskName)
        : splitType === "or"
          ? new OrTaskFlowBuilderInit(taskName)
          : new TaskFlowBuilder(taskName);

    type ImplicitConditionName = GetFlowBuilderImplicitConditionName<
      ReturnType<TFlowBuilder>
    >;

    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        ReplaceProp<
          TWorkflowElements,
          "connectedTasks",
          Get<TWorkflowElements, "connectedTasks"> | (TTaskName & string)
        >,
        "implicitConditions",
        | Get<TWorkflowElements, "implicitConditions">
        | (ImplicitConditionName & string)
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        connectedTasks: [...this.elements.connectedTasks, taskName],
        flows: {
          ...this.elements.flows,
          tasks: {
            ...this.elements.flows.tasks,
            [taskName]: flowBuilder(taskFlowBuilder as any),
          },
        },
      },
      this.cancellationRegions,
      this.description
    );
  }
  /**
   * Connect an outgoing flow from a condition to enabled tasks.
   *
   * @param conditionName - Condition to connect from.
   * @param flowBuilder - Callback that selects successor tasks.
   */
  connectCondition<
    TConditionName extends Exclude<
      Get<TWorkflowElements, "conditions">,
      Get<TWorkflowElements, "connectedConditions">
    >,
  >(
    conditionName: TConditionName & string,
    flowBuilder: (
      builder: ConditionFlowBuilder<keyof Get<TWorkflowElements, "tasks">>
    ) => ConditionFlowBuilder<keyof Get<TWorkflowElements, "tasks">>
  ) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      ReplaceProp<
        TWorkflowElements,
        "connectedConditions",
        | Get<TWorkflowElements, "connectedConditions">
        | (TConditionName & string)
      >,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      {
        ...this.elements,
        connectedConditions: [
          ...this.elements.connectedConditions,
          conditionName,
        ],
        flows: {
          ...this.elements.flows,
          conditions: {
            ...this.elements.flows.conditions,
            [conditionName]: flowBuilder(
              new ConditionFlowBuilder(conditionName)
            ),
          },
        },
      },
      this.cancellationRegions,
      this.description
    );
  }

  /**
   * Attach workflow-level activity callbacks.
   *
   * Unspecified handlers fall back to no-ops, so callers can supply only the hooks they need.
   *
   * @param activities - Partial set of lifecycle callbacks.
   */
  withActivities(activities: Partial<WorkflowActivities>) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      TWorkflowElements,
      TWorkflowSubWorkflowTaskNames
    >(
      this.name,
      { ...noOpActivities, ...activities },
      this.actions,
      this.elements,
      this.cancellationRegions,
      this.description
    );
  }

  /**
   * Register workflow actions (initialize/cancel) exposed to the generated API.
   *
   * @param actions - Action definitions with type-safe schemas and callbacks.
   */
  withActions<
    TActions extends WorkflowActions<any, GenericWorkflowActions<any, any>>,
  >(actions: TActions) {
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      {
        workflow:
          | Exclude<
              Get<TWorkflowActionsRegistry, "workflow">,
              { name: TWorkflowName }
            >
          | { name: TWorkflowName; actions: TActions };
        workItem: Get<TWorkflowActionsRegistry, "workItem">;
      },
      TWorkflowElements,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      actions,
      this.elements,
      this.cancellationRegions,
      this.description
    );
  }

  /**
   * Define a cancellation region for the provided task.
   *
   * Tasks and conditions added to the region are automatically canceled when the task completes.
   *
   * @param taskName - Task that owns the cancellation region.
   * @param cancellationRegion - Callback for configuring region membership.
   */
  withCancellationRegion<TTaskName extends keyof TWorkflowElements["tasks"]>(
    taskName: TTaskName & string,
    cancellationRegion: (
      cancellationRegion: CancellationRegionBuilder<
        Exclude<keyof TWorkflowElements["tasks"], TTaskName> & string,
        | TWorkflowElements["conditions"]
        | TWorkflowElements["implicitConditions"]
      >
    ) => void
  ) {
    const cancellationRegionAccumulator = {
      tasks: new Set<string>(),
      conditions: new Set<string>(),
    };
    cancellationRegion(
      CancellationRegionBuilder.make(cancellationRegionAccumulator)
    );
    return new WorkflowBuilder<
      TMutationCtx,
      TWorkflowName,
      TWorkflowActionsRegistry,
      TWorkflowElements,
      TWorkflowSubWorkflowTaskNames,
      TTaskToChildElement
    >(
      this.name,
      this.activities,
      this.actions,
      this.elements,
      {
        ...this.cancellationRegions,
        [taskName]: cancellationRegionAccumulator,
      },
      this.description
    );
  }

  /**
   * Compile the declarative builder into an executable {@link Workflow} graph.
   *
   * @param parentPath - Path prefix used when composing nested workflows.
   */
  build(
    versionName: string,
    props: {
      isVersionDeprecated: boolean;
      migration?: undefined | AnyMigration;
    } = {
      isVersionDeprecated: false,
    },
    parentPath: string[] = []
  ) {
    const { name, activities, actions } = this;
    const workflowPath = [...parentPath, name];
    const workflow = new Workflow(
      name,
      versionName,
      props.isVersionDeprecated,
      props.migration,
      workflowPath,
      activities,
      actions.actions
    );

    for (const [taskName, taskBuilder] of Object.entries(this.elements.tasks)) {
      const task = taskBuilder.build(versionName, props, workflow, taskName);
      workflow.addTask(task);
    }

    for (const conditionName of this.elements.conditions) {
      const condition = new Condition(
        conditionName,
        versionName,
        [...workflowPath, conditionName],
        workflow,
        false
      );
      workflow.addCondition(condition);
    }

    if (
      this.elements.startCondition &&
      workflow.conditions[this.elements.startCondition]
    ) {
      workflow.setStartCondition(
        workflow.conditions[this.elements.startCondition]
      );
    } else {
      throw new WorkflowMissingStartConditionError(this.name);
    }

    if (
      this.elements.endCondition &&
      workflow.conditions[this.elements.endCondition]
    ) {
      workflow.setEndCondition(workflow.conditions[this.elements.endCondition]);
    } else {
      throw new WorkflowMissingEndConditionError(this.name);
    }

    for (const [_, taskFlowBuilder] of Object.entries(
      this.elements.flows.tasks
    )) {
      taskFlowBuilder.build(workflow);
    }

    for (const [_, conditionFlowBuilder] of Object.entries(
      this.elements.flows.conditions
    )) {
      conditionFlowBuilder.build(workflow);
    }

    for (const [taskName, cancellationRegion] of Object.entries(
      this.cancellationRegions
    )) {
      const task = workflow.tasks[taskName];
      for (const taskName of cancellationRegion.tasks) {
        task.addTaskToCancellationRegion(workflow.tasks[taskName]);
      }
      for (const conditionName of cancellationRegion.conditions) {
        task.addConditionToCancellationRegion(
          workflow.conditions[conditionName]
        );
      }
    }

    return workflow;
  }
}

export function makeWorkflowBuilder<
  TMutationCtx extends GenericMutationCtx<any>,
>() {
  return function <TWorkflowName extends string>(name: TWorkflowName) {
    return WorkflowBuilder.make<TMutationCtx, TWorkflowName>(name);
  };
}
