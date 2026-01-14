import { BaseTask } from "./baseTask";
import { type Doc, type Id } from "../../_generated/dataModel";
import { type TaskJoinType, type TaskSplitType, type TaskState } from "../types";
import { Workflow } from "./workflow";
import type { DummyTaskActivities, DummyTaskPolicy } from "../builder";
import {
  type AuditCallbackInfo,
  completeSpan,
  createTaskActivitySpan,
  failSpan,
} from "../audit/integration";
import { ExecutionContext } from "./executionContext";
import { type AuditContext } from "../../components/audit/src/shared/context";
import { type SpanAttributes } from "../../components/audit/src/shared/attributeSchemas";
import {
  auditInfoFromSpanResult,
  type AuditSpanResult,
} from "./helpers/auditHelpers";

type TaskActivityExecution = {
  spanResult: AuditSpanResult;
  auditInfo: ReturnType<typeof auditInfoFromSpanResult>;
  complete: (attributes?: SpanAttributes) => void;
  fail: (error: unknown) => void;
};

function createTaskActivityExecution({
  activityName,
  taskName,
  workflowId,
  parentContext,
}: {
  activityName: string;
  taskName: string;
  workflowId: Id<"tasquencerWorkflows">;
  parentContext: AuditContext;
}): TaskActivityExecution {
  const spanResult = createTaskActivitySpan({
    activityName,
    taskName,
    workflowId,
    parentContext,
  });
  const auditInfo = auditInfoFromSpanResult(spanResult);
  const traceId = parentContext.traceId;

  return {
    spanResult,
    auditInfo,
    complete: (attributes?: SpanAttributes) => {
      completeSpan(traceId, spanResult.spanId, attributes);
    },
    fail: (error: unknown) => {
      failSpan(traceId, spanResult.spanId, error as Error);
    },
  };
}

export class DummyTask extends BaseTask {
  constructor(
    name: string,
    versionName: string,
    path: string[],
    parentWorkflow: Workflow,
    readonly activities: DummyTaskActivities,
    readonly policy: DummyTaskPolicy,
    props?: {
      splitType?: TaskSplitType;
      joinType?: TaskJoinType;
    }
  ) {
    super(name, versionName, path, parentWorkflow, props);
  }

  async onFastForward(
    _executionContext: ExecutionContext,
    _workflowId: Id<"tasquencerWorkflows">,
    _task: Doc<"tasquencerTasks">
  ) {
    return "continue" as const;
  }

  async afterEnable(
    executionContext: ExecutionContext,
    workflowId: Id<"tasquencerWorkflows">,
    task: Doc<"tasquencerTasks">
  ) {
    const activity = createTaskActivityExecution({
      activityName: "onEnabled",
      taskName: this.name,
      workflowId,
      parentContext: executionContext.auditContext,
    });
    try {
      await this.activities.onEnabled(
        this.makeTaskActivityContext(
          executionContext,
          task,
          workflowId,
          activity.auditInfo
        )
      );
      activity.complete();
    } catch (error) {
      activity.fail(error);
      throw error;
    }
    await this.ensureStarted(executionContext, workflowId, task.generation);
  }

  async afterStart(
    executionContext: ExecutionContext,
    workflowId: Id<"tasquencerWorkflows">,
    task: Doc<"tasquencerTasks">
  ) {
    const activity = createTaskActivityExecution({
      activityName: "onStarted",
      taskName: this.name,
      workflowId,
      parentContext: executionContext.auditContext,
    });
    try {
      await this.activities.onStarted(
        this.makeTaskActivityContext(
          executionContext,
          task,
          workflowId,
          activity.auditInfo
        )
      );
      activity.complete();
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  }

  async afterComplete(
    executionContext: ExecutionContext,
    workflowId: Id<"tasquencerWorkflows">,
    task: Doc<"tasquencerTasks">
  ) {
    const activity = createTaskActivityExecution({
      activityName: "onCompleted",
      taskName: this.name,
      workflowId,
      parentContext: executionContext.auditContext,
    });
    try {
      await this.activities.onCompleted(
        this.makeTaskActivityContext(
          executionContext,
          task,
          workflowId,
          activity.auditInfo
        )
      );
      activity.complete();
    } catch (error) {
      activity.fail(error);
      throw error;
    }
  }

  async maybeComplete(
    executionContext: ExecutionContext,
    workflowId: Id<"tasquencerWorkflows">,
    task: Doc<"tasquencerTasks">
  ) {
    const policyResult = await this.policy({
      mutationCtx: executionContext.mutationCtx,
      parent: {
        workflow: {
          id: workflowId,
          name: this.parentWorkflow.name,
        },
      },
      task: {
        name: this.name,
        generation: task.generation,
        path: this.path,
      },
      transition: {
        prevState: "started" as TaskState,
        nextState: "completed",
      },
    });

    if (policyResult === "complete") {
      await this.complete(executionContext, workflowId, task);
    } else if (policyResult === "fail") {
      await this.fail(executionContext, workflowId, task);
    }
  }

  async afterFail(
    _executionContext: ExecutionContext,
    _workflowId: Id<"tasquencerWorkflows">,
    _task: Doc<"tasquencerTasks">
  ) {}

  async afterCancel(
    _executionContext: ExecutionContext,
    _workflowId: Id<"tasquencerWorkflows">,
    _task: Doc<"tasquencerTasks">
  ) {}

  async afterDisable(
    _executionContext: ExecutionContext,
    _workflowId: Id<"tasquencerWorkflows">,
    _task: Doc<"tasquencerTasks">
  ) {}

  async getRouterPayload(
    _executionContext: ExecutionContext,
    _task: Doc<"tasquencerTasks">,
    _workflowId: Id<"tasquencerWorkflows">
  ) {
    return {};
  }

  private makeTaskActivityContext(
    executionContext: ExecutionContext,
    task: Doc<"tasquencerTasks">,
    parentWorkflowId: Id<"tasquencerWorkflows">,
    auditInfo: AuditCallbackInfo
  ) {
    return {
      mutationCtx: executionContext.mutationCtx,
      isInternalMutation: executionContext.isInternalMutation,
      executionMode: executionContext.executionMode,

      parent: {
        workflow: {
          id: parentWorkflowId,
          name: this.parentWorkflow.name,
        },
      },
      task: {
        name: this.name,
        generation: task.generation,
        path: this.path,
      },
      audit: auditInfo,
    };
  }
}
