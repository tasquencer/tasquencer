import { setup, Builder } from "./setup.test";
import { beforeEach, afterEach, it, vi } from "vitest";
import { internal } from "../../../convex/_generated/api";
import { registerVersionManagersForTesting } from "./helpers/versionManager";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { InvalidStateTransitionError } from "../exceptions";

const WORKFLOW_VERSION_NAME = "v0";

const isTaskCompleted = async (
  mutationCtx: MutationCtx,
  workflowId: Id<"tasquencerWorkflows">,
  taskName: string
) => {
  const task = await mutationCtx.db
    .query("tasquencerTasks")
    .withIndex("by_workflow_id_name_and_generation", (q) =>
      q.eq("workflowId", workflowId).eq("name", taskName)
    )
    .order("desc")
    .first();

  return task?.state === "completed";
};

const signalTaskActivities = {
  onEnabled: async ({ workItem }: { workItem: { initialize: () => Promise<any> } }) => {
    await workItem.initialize();
  },
};

const dummyTickWorkflowDefinition = Builder.workflow("tickDummy")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .dummyTask(
    "gate",
    Builder.dummyTask().withPolicy(async ({ mutationCtx, parent }) => {
      return (await isTaskCompleted(
        mutationCtx,
        parent.workflow.id,
        "signal"
      ))
        ? "complete"
        : "continue";
    })
  )
  .task("signal", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("gate").task("signal"));

const dummyTickFailWorkflowDefinition = Builder.workflow("tickDummyFail")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .dummyTask(
    "gate",
    Builder.dummyTask().withPolicy(async ({ mutationCtx, parent }) => {
      return (await isTaskCompleted(
        mutationCtx,
        parent.workflow.id,
        "signal"
      ))
        ? "fail"
        : "continue";
    })
  )
  .task("signal", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("gate").task("signal"));

const taskTickWorkflowDefinition = Builder.workflow("tickTask")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .task(
    "work",
    Builder.noOpTask
      .withActivities(signalTaskActivities)
      .withPolicy(async ({ mutationCtx, parent }) => {
        return (await isTaskCompleted(
          mutationCtx,
          parent.workflow.id,
          "signal"
        ))
          ? "complete"
          : "continue";
      })
  )
  .task("signal", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("work").task("signal"));

const compositeChildWorkflowDefinition = Builder.workflow("tickCompositeChild")
  .startCondition("start")
  .task("child", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("child"))
  .connectTask("child", (to) => to.condition("end"));

const compositeTickWorkflowDefinition = Builder.workflow("tickComposite")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .compositeTask(
    "composite",
    Builder.compositeTask(compositeChildWorkflowDefinition)
      .withActivities({
        onEnabled: async ({ workflow }) => {
          await workflow.initialize();
        },
      })
      .withPolicy(async ({ mutationCtx, parent }) => {
        return (await isTaskCompleted(
          mutationCtx,
          parent.workflow.id,
          "signal"
        ))
          ? "complete"
          : "continue";
      })
  )
  .task("signal", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("composite").task("signal"));

const dynamicChildWorkflowDefinition = Builder.workflow("tickDynamicChild")
  .startCondition("start")
  .task("child", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("child"))
  .connectTask("child", (to) => to.condition("end"));

const dynamicTickWorkflowDefinition = Builder.workflow("tickDynamic")
  .startCondition("start")
  .dummyTask("split", Builder.dummyTask())
  .dynamicCompositeTask(
    "dynamic",
    Builder.dynamicCompositeTask([dynamicChildWorkflowDefinition])
      .withActivities({
        onEnabled: async ({ workflow }) => {
          await workflow.initialize.tickDynamicChild();
        },
      })
      .withPolicy(async ({ mutationCtx, parent }) => {
        return (await isTaskCompleted(
          mutationCtx,
          parent.workflow.id,
          "signal"
        ))
          ? "complete"
          : "continue";
      })
  )
  .task("signal", Builder.noOpTask.withActivities(signalTaskActivities))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("split"))
  .connectTask("split", (to) => to.task("dynamic").task("signal"));

let cleanupVersionManagers: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  cleanupVersionManagers = registerVersionManagersForTesting([
    {
      workflowName: "tickDummy",
      versionName: WORKFLOW_VERSION_NAME,
      builder: dummyTickWorkflowDefinition,
    },
    {
      workflowName: "tickDummyFail",
      versionName: WORKFLOW_VERSION_NAME,
      builder: dummyTickFailWorkflowDefinition,
    },
    {
      workflowName: "tickTask",
      versionName: WORKFLOW_VERSION_NAME,
      builder: taskTickWorkflowDefinition,
    },
    {
      workflowName: "tickComposite",
      versionName: WORKFLOW_VERSION_NAME,
      builder: compositeTickWorkflowDefinition,
    },
    {
      workflowName: "tickDynamic",
      versionName: WORKFLOW_VERSION_NAME,
      builder: dynamicTickWorkflowDefinition,
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  cleanupVersionManagers();
});

it("ticks dummy tasks to re-run policy", async ({ expect }) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickDummy",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const tasks = await t.query(internal.testing.tasquencer.getWorkflowTasks, {
    workflowId,
  });
  expect(tasks.find((task) => task.name === "gate")?.state).toBe("started");

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  const tasksAfterSignal = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterSignal.find((task) => task.name === "gate")?.state).toBe(
    "started"
  );

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "gate",
  });

  const tasksAfterTick = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterTick.find((task) => task.name === "gate")?.state).toBe(
    "completed"
  );
});

it("ticks dummy tasks to fail when policy returns fail", async ({ expect }) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickDummyFail",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickDummyFail",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickDummyFail",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickDummyFail",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "gate",
  });

  const tasksAfterTick = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterTick.find((task) => task.name === "gate")?.state).toBe(
    "failed"
  );
});

it("ticks task policies that previously returned continue", async ({ expect }) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickTask",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const workItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "work",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickTask",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: workItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickTask",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: workItems[0]._id,
  });

  const tasksAfterWork = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterWork.find((task) => task.name === "work")?.state).toBe(
    "started"
  );

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickTask",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickTask",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickTask",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "work",
  });

  const tasksAfterTick = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterTick.find((task) => task.name === "work")?.state).toBe(
    "completed"
  );
});

it("ticks composite tasks after child workflow completion", async ({ expect }) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickComposite",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const childWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    {
      workflowId,
      taskName: "composite",
    }
  );
  const childWorkflowId = childWorkflows[0]._id;

  const childWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId: childWorkflowId,
      taskName: "child",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickComposite",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: childWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickComposite",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: childWorkItems[0]._id,
  });

  const tasksAfterChild = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterChild.find((task) => task.name === "composite")?.state).toBe(
    "started"
  );

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickComposite",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickComposite",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickComposite",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "composite",
  });

  const tasksAfterTick = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterTick.find((task) => task.name === "composite")?.state).toBe(
    "completed"
  );
});

it("ticks dynamic composite tasks after child workflow completion", async ({
  expect,
}) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickDynamic",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const childWorkflows = await t.query(
    internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
    {
      workflowId,
      taskName: "dynamic",
    }
  );
  const childWorkflowId = childWorkflows[0]._id;

  const childWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId: childWorkflowId,
      taskName: "child",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickDynamic",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: childWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickDynamic",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: childWorkItems[0]._id,
  });

  const tasksAfterChild = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterChild.find((task) => task.name === "dynamic")?.state).toBe(
    "started"
  );

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickDynamic",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickDynamic",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickDynamic",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "dynamic",
  });

  const tasksAfterTick = await t.query(
    internal.testing.tasquencer.getWorkflowTasks,
    {
      workflowId,
    }
  );
  expect(tasksAfterTick.find((task) => task.name === "dynamic")?.state).toBe(
    "completed"
  );
});

it("rejects ticking tasks that are no longer started", async ({ expect }) => {
  const t = setup();

  const workflowId = await t.mutation(
    internal.testing.tasquencer.initializeRootWorkflow,
    {
      workflowName: "tickDummy",
      workflowVersionName: WORKFLOW_VERSION_NAME,
    }
  );

  const signalWorkItems = await t.query(
    internal.testing.tasquencer.getWorkflowTaskWorkItems,
    {
      workflowId,
      taskName: "signal",
    }
  );

  await t.mutation(internal.testing.tasquencer.startWorkItem, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.completeWorkItem, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workItemId: signalWorkItems[0]._id,
  });

  await t.mutation(internal.testing.tasquencer.tickTask, {
    workflowName: "tickDummy",
    workflowVersionName: WORKFLOW_VERSION_NAME,
    workflowId,
    taskName: "gate",
  });

  await expect(
    t.mutation(internal.testing.tasquencer.tickTask, {
      workflowName: "tickDummy",
      workflowVersionName: WORKFLOW_VERSION_NAME,
      workflowId,
      taskName: "gate",
    })
  ).rejects.toThrow(InvalidStateTransitionError);
});
