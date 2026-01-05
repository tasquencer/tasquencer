import { z } from "zod";
import { type Id } from "../_generated/dataModel";
import { CompositeTaskBuilder } from "./builder/compositeTask";
import { TaskBuilder } from "./builder/task";
import { DummyTaskBuilder } from "./builder/dummyTask";
import { type IsAny, type IsUnknown, type IsNever } from "type-fest";
import { DynamicCompositeTaskBuilder } from "./builder/dynamicCompositeTask";

export type ReplaceProp<T extends object, K extends keyof T, V> = {
  [P in keyof T]: P extends K ? V : T[P];
};

export const workItemStates = [
  "initialized",
  "started",
  "completed",
  "failed",
  "canceled",
] as const;
export type WorkItemState = (typeof workItemStates)[number];

export const validWorkItemStateTransitions: Record<
  "initialized" | "started",
  Set<WorkItemState>
> = {
  initialized: new Set(["started"]),
  started: new Set(["completed", "failed", "canceled"]),
};

export const workflowStates = workItemStates;
export type WorkflowState = (typeof workflowStates)[number];

export const validWorkflowStateTransitions = validWorkItemStateTransitions;

export const taskStates = [
  "disabled",
  "enabled",
  "started",
  "completed",
  "failed",
  "canceled",
] as const;
export type TaskState = (typeof taskStates)[number];

export const activeTaskStates = ["enabled", "started"] as const;
export type ActiveTaskState = (typeof activeTaskStates)[number];

export const taskSplitTypes = ["and", "xor", "or"] as const;
export type TaskSplitType = (typeof taskSplitTypes)[number];

export const taskJoinTypes = ["and", "xor", "or"] as const;
export type TaskJoinType = (typeof taskJoinTypes)[number];

export const validTaskTransitions: Record<TaskState, Set<TaskState>> = {
  disabled: new Set(["enabled"]),
  enabled: new Set(["disabled", "started", "canceled"]),
  started: new Set(["completed", "canceled", "failed"]),
  completed: new Set(["enabled"]),
  canceled: new Set(["enabled"]),
  failed: new Set(["enabled"]),
};

export const finalWorkflowInstanceStates = new Set([
  "completed",
  "canceled",
  "failed",
]);

export const policyResults = ["continue", "fail", "complete"] as const;
export type PolicyResult = (typeof policyResults)[number];

export type StateTransition<TState> = {
  prevState: TState;
  nextState: TState;
};

export type Schedule =
  | {
      type: "at";
      timestamp: number | Date;
    }
  | {
      type: "after";
      delayMs: number;
    };

export type GetAnyTaskSplitType<TTaskBuilder> =
  TTaskBuilder extends TaskBuilder<any, any, infer TSplitType, any>
    ? TSplitType
    : TTaskBuilder extends CompositeTaskBuilder<any, any, infer TSplitType, any>
      ? TSplitType
      : TTaskBuilder extends DummyTaskBuilder<any, infer TSplitType, any>
        ? TSplitType
        : TTaskBuilder extends DynamicCompositeTaskBuilder<
              any,
              any,
              infer TSplitType,
              any
            >
          ? TSplitType
          : never;

export type AnyZodType = z.ZodTypeAny;

export type RegisterScheduled = (
  scheduled: Promise<Id<"_scheduled_functions">>
) => Promise<Id<"_scheduled_functions">>;

export type ShouldBeOptional<TPayload> =
  IsAny<TPayload> extends true
    ? true
    : IsUnknown<TPayload> extends true
      ? true
      : IsNever<TPayload> extends true
        ? true
        : false;

export type WorkflowExecutionMode = "normal" | "fastForward";

export type CancellationReason = "explicit" | "teardown" | "migration";
