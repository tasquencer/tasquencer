import { setup, Builder } from "./setup.test";
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

import schema from "../../schema";
import { withVersionManagerBuilders } from "./helpers/versionManager";
import { z } from "zod";

type ElementType = "workflow" | "task" | "compositeTask" | "workItem";

type ActivityEvent = {
  order: number;
  elementType: ElementType;
  elementName: string;
  event: string;
  details?: Record<string, unknown>;
};

const activityLog: ActivityEvent[] = [];
let sequenceCounter = 0;

const WORKFLOW_VERSION_NAME = "vActivitiesOrder";
const ROOT_WORKFLOW_NAME = "activities-order-root";
const CHILD_WORKFLOW_NAME = "activities-order-child";

const ROOT_WORKFLOW_LABEL = "rootWorkflow";
const CHILD_WORKFLOW_LABEL = "childWorkflow";
const PRIMARY_TASK_NAME = "primaryTask";
const PRIMARY_TASK_LABEL = "primaryTask";
const COMPOSITE_TASK_NAME = "reviewComposite";
const COMPOSITE_TASK_LABEL = "compositeTask";
const CHILD_TASK_NAME = "childTask";
const CHILD_TASK_LABEL = "childTask";
const PRIMARY_WORK_ITEM_NAME = "primaryWorkItem";
const PRIMARY_WORK_ITEM_LABEL = "primaryWorkItem";
const CHILD_WORK_ITEM_NAME = "childWorkItem";
const CHILD_WORK_ITEM_LABEL = "childWorkItem";

function resetActivityLog() {
  sequenceCounter = 0;
  activityLog.length = 0;
}

function record(
  elementType: ElementType,
  elementName: string,
  event: string,
  details?: Record<string, unknown>
) {
  activityLog.push({
    order: ++sequenceCounter,
    elementType,
    elementName,
    event,
    details: details ? { ...details } : undefined,
  });
}

function signatureFor(event: ActivityEvent) {
  if (event.event === "onWorkItemStateChanged") {
    const prev = event.details?.prevState;
    const next = event.details?.nextState;
    return `${event.event}[${prev}->${next}]`;
  }

  if (event.event === "onWorkflowStateChanged") {
    const prev = event.details?.prevState;
    const next = event.details?.nextState;
    return `${event.event}[${prev}->${next}]`;
  }

  return event.event;
}

function sequenceFor(elementType: ElementType, elementName: string) {
  return activityLog
    .filter(
      (event) =>
        event.elementType === elementType && event.elementName === elementName
    )
    .map(signatureFor);
}

function getEventIndex(
  elementType: ElementType,
  elementName: string,
  expectedSignature: string
) {
  const index = activityLog.findIndex(
    (event) =>
      event.elementType === elementType &&
      event.elementName === elementName &&
      signatureFor(event) === expectedSignature
  );

  if (index === -1) {
    throw new Error(
      `Missing event ${expectedSignature} for ${elementType}:${elementName}`
    );
  }

  return index;
}

function buildWorkItemWithLogging(name: string, label: string) {
  return Builder.workItem(name)
    .withActions(
      Builder.workItemActions()
        .initialize(z.never(), async ({ workItem }) => {
          await workItem.initialize();
        })
        .start(z.never(), async ({ workItem }) => {
          await workItem.start();
        })
        .complete(z.never(), async ({ workItem }) => {
          await workItem.complete();
        })
        .fail(z.never(), async ({ workItem }) => {
          await workItem.fail();
        })
        .cancel(z.never(), async ({ workItem }) => {
          await workItem.cancel();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        record("workItem", label, "onInitialized", {
          workItemId: ctx.workItem.id,
        });
      },
      onStarted: async (ctx) => {
        record("workItem", label, "onStarted", {
          workItemId: ctx.workItem.id,
        });
      },
      onCompleted: async (ctx) => {
        record("workItem", label, "onCompleted", {
          workItemId: ctx.workItem.id,
        });
      },
      onFailed: async (ctx) => {
        record("workItem", label, "onFailed", {
          workItemId: ctx.workItem.id,
        });
      },
      onCanceled: async (ctx) => {
        record("workItem", label, "onCanceled", {
          workItemId: ctx.workItem.id,
        });
      },
    });
}

function buildTaskWithLogging(
  workItemName: string,
  workItemLabel: string,
  taskLabel: string
) {
  const workItemBuilder = buildWorkItemWithLogging(workItemName, workItemLabel);

  return Builder.task(workItemBuilder).withActivities({
    onDisabled: async (ctx) => {
      record("task", taskLabel, "onDisabled", {
        generation: ctx.task.generation,
      });
    },
    onEnabled: async (ctx) => {
      record("task", taskLabel, "onEnabled", {
        generation: ctx.task.generation,
      });
      await ctx.workItem.initialize();
    },
    onStarted: async (ctx) => {
      record("task", taskLabel, "onStarted", {
        generation: ctx.task.generation,
      });
    },
    onCompleted: async (ctx) => {
      record("task", taskLabel, "onCompleted", {
        generation: ctx.task.generation,
      });
    },
    onFailed: async (ctx) => {
      record("task", taskLabel, "onFailed", {
        generation: ctx.task.generation,
      });
    },
    onCanceled: async (ctx) => {
      record("task", taskLabel, "onCanceled", {
        generation: ctx.task.generation,
      });
    },
    onWorkItemStateChanged: async (ctx) => {
      record("task", taskLabel, "onWorkItemStateChanged", {
        prevState: ctx.workItem.prevState,
        nextState: ctx.workItem.nextState,
        workItemId: ctx.workItem.id,
      });
    },
  });
}

function buildChildWorkflowBuilder() {
  const childTaskBuilder = buildTaskWithLogging(
    CHILD_WORK_ITEM_NAME,
    CHILD_WORK_ITEM_LABEL,
    CHILD_TASK_LABEL
  );

  return Builder.workflow(CHILD_WORKFLOW_NAME)
    .withActivities({
      onInitialized: async (ctx) => {
        record("workflow", CHILD_WORKFLOW_LABEL, "onInitialized", {
          workflowId: ctx.workflow.id,
        });
      },
      onStarted: async (ctx) => {
        record("workflow", CHILD_WORKFLOW_LABEL, "onStarted", {
          workflowId: ctx.workflow.id,
        });
      },
      onCompleted: async (ctx) => {
        record("workflow", CHILD_WORKFLOW_LABEL, "onCompleted", {
          workflowId: ctx.workflow.id,
        });
      },
      onFailed: async (ctx) => {
        record("workflow", CHILD_WORKFLOW_LABEL, "onFailed", {
          workflowId: ctx.workflow.id,
        });
      },
      onCanceled: async (ctx) => {
        record("workflow", CHILD_WORKFLOW_LABEL, "onCanceled", {
          workflowId: ctx.workflow.id,
        });
      },
    })
    .startCondition("start")
    .task(CHILD_TASK_NAME, childTaskBuilder)
    .endCondition("end")
    .connectCondition("start", (to) => to.task(CHILD_TASK_NAME))
    .connectTask(CHILD_TASK_NAME, (to) => to.condition("end"));
}

function buildCompositeTask(
  childWorkflowBuilder: ReturnType<typeof buildChildWorkflowBuilder>
) {
  return Builder.compositeTask(childWorkflowBuilder).withActivities({
    onEnabled: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onEnabled", {
        generation: ctx.task.generation,
      });
      await ctx.workflow.initialize();
    },
    onStarted: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onStarted", {
        generation: ctx.task.generation,
      });
    },
    onCompleted: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onCompleted", {
        generation: ctx.task.generation,
      });
    },
    onFailed: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onFailed", {
        generation: ctx.task.generation,
      });
    },
    onCanceled: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onCanceled", {
        generation: ctx.task.generation,
      });
    },
    onWorkflowStateChanged: async (ctx) => {
      record("compositeTask", COMPOSITE_TASK_LABEL, "onWorkflowStateChanged", {
        prevState: ctx.workflow.prevState,
        nextState: ctx.workflow.nextState,
        workflowId: ctx.workflow.id,
      });
    },
  });
}

function buildRootWorkflowBuilder(
  childWorkflowBuilder: ReturnType<typeof buildChildWorkflowBuilder>
) {
  const primaryTaskBuilder = buildTaskWithLogging(
    PRIMARY_WORK_ITEM_NAME,
    PRIMARY_WORK_ITEM_LABEL,
    PRIMARY_TASK_LABEL
  );
  const compositeTaskBuilder = buildCompositeTask(childWorkflowBuilder);

  return Builder.workflow(ROOT_WORKFLOW_NAME)
    .withActivities({
      onInitialized: async (ctx) => {
        record("workflow", ROOT_WORKFLOW_LABEL, "onInitialized", {
          workflowId: ctx.workflow.id,
        });
      },
      onStarted: async (ctx) => {
        record("workflow", ROOT_WORKFLOW_LABEL, "onStarted", {
          workflowId: ctx.workflow.id,
        });
      },
      onCompleted: async (ctx) => {
        record("workflow", ROOT_WORKFLOW_LABEL, "onCompleted", {
          workflowId: ctx.workflow.id,
        });
      },
      onFailed: async (ctx) => {
        record("workflow", ROOT_WORKFLOW_LABEL, "onFailed", {
          workflowId: ctx.workflow.id,
        });
      },
      onCanceled: async (ctx) => {
        record("workflow", ROOT_WORKFLOW_LABEL, "onCanceled", {
          workflowId: ctx.workflow.id,
        });
      },
    })
    .startCondition("start")
    .task(PRIMARY_TASK_NAME, primaryTaskBuilder)
    .compositeTask(COMPOSITE_TASK_NAME, compositeTaskBuilder)
    .endCondition("end")
    .connectCondition("start", (to) => to.task(PRIMARY_TASK_NAME))
    .connectTask(PRIMARY_TASK_NAME, (to) => to.task(COMPOSITE_TASK_NAME))
    .connectTask(COMPOSITE_TASK_NAME, (to) => to.condition("end"));
}

function createBuilderConfigs() {
  const childWorkflowBuilder = buildChildWorkflowBuilder();
  const rootWorkflowBuilder = buildRootWorkflowBuilder(childWorkflowBuilder);

  return [
    {
      workflowName: ROOT_WORKFLOW_NAME,
      versionName: WORKFLOW_VERSION_NAME,
      builder: rootWorkflowBuilder,
    },
    {
      workflowName: CHILD_WORKFLOW_NAME,
      versionName: WORKFLOW_VERSION_NAME,
      builder: childWorkflowBuilder,
    },
  ];
}

async function initializeRootWorkflow(
  t: ReturnType<typeof setup>
): Promise<Id<"tasquencerWorkflows">> {
  return (await t.mutation(internal.testing.tasquencer.initializeRootWorkflow, {
    workflowName: ROOT_WORKFLOW_NAME,
    workflowVersionName: WORKFLOW_VERSION_NAME,
  })) as Id<"tasquencerWorkflows">;
}

async function getSingleTaskWorkItem(
  t: ReturnType<typeof setup>,
  workflowId: Id<"tasquencerWorkflows">,
  taskName: string
) {
  const workItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName,
    }
  );

  if (workItems.length !== 1) {
    throw new Error(
      `Expected a single work item for ${taskName}, found ${workItems.length}`
    );
  }

  return workItems[0];
}

async function getSingleCompositeChildWorkflow(
  t: ReturnType<typeof setup>,
  workflowId: Id<"tasquencerWorkflows">
) {
  const workflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    {
      workflowId,
      taskName: COMPOSITE_TASK_NAME,
    }
  );

  if (workflows.length !== 1) {
    throw new Error(
      `Expected a single child workflow, found ${workflows.length}`
    );
  }

  return workflows[0];
}

describe("activities order", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActivityLog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs success scenario in deterministic activity order", async ({
    expect,
  }) => {
    const builderConfigs = createBuilderConfigs();

    await withVersionManagerBuilders(builderConfigs, async () => {
      const t = setup();

      const rootWorkflowId = await initializeRootWorkflow(t);
      const primaryWorkItem = await getSingleTaskWorkItem(
        t,
        rootWorkflowId,
        PRIMARY_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });

      const childWorkflow = await getSingleCompositeChildWorkflow(
        t,
        rootWorkflowId
      );
      const childWorkItem = await getSingleTaskWorkItem(
        t,
        childWorkflow._id,
        CHILD_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: childWorkItem._id,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: childWorkItem._id,
      });

      const rootWorkflow = await t.query(
        internal.testing.tasquencer.getWorkflowById,
        {
          workflowId: rootWorkflowId,
        }
      );
      expect(rootWorkflow.state).toBe("completed");

      expect(sequenceFor("workflow", ROOT_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(sequenceFor("task", PRIMARY_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->completed]",
        "onCompleted",
      ]);

      expect(sequenceFor("workItem", PRIMARY_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(sequenceFor("compositeTask", COMPOSITE_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkflowStateChanged[initialized->started]",
        "onWorkflowStateChanged[started->completed]",
        "onCompleted",
      ]);

      expect(sequenceFor("workflow", CHILD_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(sequenceFor("task", CHILD_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->completed]",
        "onCompleted",
      ]);

      expect(sequenceFor("workItem", CHILD_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(
        getEventIndex("task", PRIMARY_TASK_LABEL, "onEnabled")
      ).toBeLessThan(
        getEventIndex("workflow", ROOT_WORKFLOW_LABEL, "onInitialized")
      );
      expect(
        getEventIndex("workflow", ROOT_WORKFLOW_LABEL, "onStarted")
      ).toBeLessThan(getEventIndex("task", PRIMARY_TASK_LABEL, "onStarted"));
      expect(
        getEventIndex("task", PRIMARY_TASK_LABEL, "onCompleted")
      ).toBeLessThan(
        getEventIndex("compositeTask", COMPOSITE_TASK_LABEL, "onEnabled")
      );
      expect(
        getEventIndex(
          "compositeTask",
          COMPOSITE_TASK_LABEL,
          "onWorkflowStateChanged[started->completed]"
        )
      ).toBeLessThan(
        getEventIndex("compositeTask", COMPOSITE_TASK_LABEL, "onCompleted")
      );
      expect(
        getEventIndex("compositeTask", COMPOSITE_TASK_LABEL, "onCompleted")
      ).toBeLessThan(
        getEventIndex("workflow", ROOT_WORKFLOW_LABEL, "onCompleted")
      );
    });
  });

  it("propagates child work item failure through activities in order", async ({
    expect,
  }) => {
    const builderConfigs = createBuilderConfigs();

    await withVersionManagerBuilders(builderConfigs, async () => {
      const t = setup();

      const rootWorkflowId = await initializeRootWorkflow(t);
      const primaryWorkItem = await getSingleTaskWorkItem(
        t,
        rootWorkflowId,
        PRIMARY_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });

      const childWorkflow = await getSingleCompositeChildWorkflow(
        t,
        rootWorkflowId
      );
      const childWorkItem = await getSingleTaskWorkItem(
        t,
        childWorkflow._id,
        CHILD_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: childWorkItem._id,
      });
      await t.mutation(internal.testing.tasquencer.failWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: childWorkItem._id,
      });

      const rootWorkflow = await t.query(
        internal.testing.tasquencer.getWorkflowById,
        {
          workflowId: rootWorkflowId,
        }
      );
      expect(rootWorkflow.state).toBe("failed");

      expect(sequenceFor("workflow", ROOT_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onFailed",
      ]);

      expect(sequenceFor("task", PRIMARY_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->completed]",
        "onCompleted",
      ]);

      expect(sequenceFor("workItem", PRIMARY_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(sequenceFor("compositeTask", COMPOSITE_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkflowStateChanged[initialized->started]",
        "onWorkflowStateChanged[started->failed]",
        "onFailed",
      ]);

      expect(sequenceFor("workflow", CHILD_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onFailed",
      ]);

      expect(sequenceFor("task", CHILD_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->failed]",
        "onFailed",
      ]);

      expect(sequenceFor("workItem", CHILD_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onFailed",
      ]);

      expect(
        getEventIndex("workItem", CHILD_WORK_ITEM_LABEL, "onFailed")
      ).toBeLessThan(
        getEventIndex("workflow", ROOT_WORKFLOW_LABEL, "onFailed")
      );
    });
  });

  it("propagates root workflow cancellation through activities in order", async ({
    expect,
  }) => {
    const builderConfigs = createBuilderConfigs();

    await withVersionManagerBuilders(builderConfigs, async () => {
      const t = setup();

      const rootWorkflowId = await initializeRootWorkflow(t);
      const primaryWorkItem = await getSingleTaskWorkItem(
        t,
        rootWorkflowId,
        PRIMARY_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: primaryWorkItem._id,
      });

      const childWorkflow = await getSingleCompositeChildWorkflow(
        t,
        rootWorkflowId
      );
      const childWorkItem = await getSingleTaskWorkItem(
        t,
        childWorkflow._id,
        CHILD_TASK_NAME
      );

      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workItemId: childWorkItem._id,
      });

      await t.mutation(internal.testing.tasquencer.cancelRootWorkflow, {
        workflowName: ROOT_WORKFLOW_NAME,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        workflowId: rootWorkflowId,
      });

      const rootWorkflow = await t.query(
        internal.testing.tasquencer.getWorkflowById,
        {
          workflowId: rootWorkflowId,
        }
      );
      expect(rootWorkflow.state).toBe("canceled");

      expect(sequenceFor("workflow", ROOT_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCanceled",
      ]);

      expect(sequenceFor("task", PRIMARY_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->completed]",
        "onCompleted",
      ]);

      expect(sequenceFor("workItem", PRIMARY_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCompleted",
      ]);

      expect(sequenceFor("compositeTask", COMPOSITE_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkflowStateChanged[initialized->started]",
        "onWorkflowStateChanged[started->canceled]",
        "onCanceled",
      ]);

      expect(sequenceFor("workflow", CHILD_WORKFLOW_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCanceled",
      ]);

      expect(sequenceFor("task", CHILD_TASK_LABEL)).toEqual([
        "onEnabled",
        "onStarted",
        "onWorkItemStateChanged[initialized->started]",
        "onWorkItemStateChanged[started->canceled]",
        "onCanceled",
      ]);

      expect(sequenceFor("workItem", CHILD_WORK_ITEM_LABEL)).toEqual([
        "onInitialized",
        "onStarted",
        "onCanceled",
      ]);

      expect(
        getEventIndex("workItem", CHILD_WORK_ITEM_LABEL, "onCanceled")
      ).toBeLessThan(
        getEventIndex("workflow", CHILD_WORKFLOW_LABEL, "onCanceled")
      );
      expect(
        getEventIndex("workflow", CHILD_WORKFLOW_LABEL, "onCanceled")
      ).toBeLessThan(
        getEventIndex("compositeTask", COMPOSITE_TASK_LABEL, "onCanceled")
      );
      expect(
        getEventIndex("compositeTask", COMPOSITE_TASK_LABEL, "onCanceled")
      ).toBeLessThan(
        getEventIndex("workflow", ROOT_WORKFLOW_LABEL, "onCanceled")
      );
    });
  });
});
