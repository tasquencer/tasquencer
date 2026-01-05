import { setup, Builder } from "./setup.test";
import { it, vi } from "vitest";
import { internal } from "../../../convex/_generated/api";

import { versionManagerFor } from "../../../convex/tasquencer/versionManager";
import schema from "../../schema";
import {
  withVersionManagerBuilders,
  withVersionManagers,
} from "./helpers/versionManager";
import { z } from "zod";

const WORKFLOW_VERSION_NAME = "v0";

const autoStartSchema = z.object({
  reason: z.literal("auto-started"),
});

const autoCompleteSchema = z.object({
  result: z.union([
    z.literal("auto-completed"),
    z.literal("manually-completed-1"),
    z.literal("manually-completed-2"),
  ]),
});

const autoFailSchema = z.object({
  error: z.literal("auto-failed"),
});

const autoCancelSchema = z.object({
  reason: z.literal("auto-canceled"),
});

const autoStartWorkItem = Builder.workItem("autoStartItem")
  .withActions(
    Builder.workItemActions()
      .start(autoStartSchema, async (ctx, _payload) => {
        await ctx.workItem.start();
      })
      .complete(autoCompleteSchema, async (ctx, _payload) => {
        await ctx.workItem.complete();
      })
  )
  .withActivities({
    onInitialized: async (ctx) => {
      ctx.workItem.start({ reason: "auto-started" });
    },
  });

const autoCompleteWorkItem = Builder.workItem("autoCompleteItem")
  .withActions(
    Builder.workItemActions()
      .start(autoStartSchema, async (ctx, _payload) => {
        await ctx.workItem.start();
      })
      .complete(autoCompleteSchema, async (ctx, _payload) => {
        await ctx.workItem.complete();
      })
  )
  .withActivities({
    onInitialized: async (ctx) => {
      ctx.workItem.start({ reason: "auto-started" });
    },
    onStarted: async (ctx) => {
      ctx.workItem.complete({ result: "auto-completed" });
    },
  });

const autoFailWorkItem = Builder.workItem("autoFailItem")
  .withActions(
    Builder.workItemActions()
      .start(autoStartSchema, async (ctx, _payload) => {
        await ctx.workItem.start();
      })
      .complete(autoCompleteSchema, async (ctx, _payload) => {
        await ctx.workItem.complete();
      })
      .fail(autoFailSchema, async (ctx, _payload) => {
        await ctx.workItem.fail();
      })
  )
  .withActivities({
    onInitialized: async (ctx) => {
      ctx.workItem.start({ reason: "auto-started" });
    },
    onStarted: async (ctx) => {
      ctx.workItem.fail({ error: "auto-failed" });
    },
  });

const autoCancelWorkItem = Builder.workItem("autoCancelItem")
  .withActions(
    Builder.workItemActions()
      .start(autoStartSchema, async (ctx, _payload) => {
        await ctx.workItem.start();
      })
      .complete(autoCompleteSchema, async (ctx, _payload) => {
        await ctx.workItem.complete();
      })
      .cancel(autoCancelSchema, async (ctx, _payload) => {
        await ctx.workItem.cancel();
      })
  )
  .withActivities({
    onInitialized: async (ctx) => {
      ctx.workItem.start({ reason: "auto-started" });
    },
    onStarted: async (ctx) => {
      ctx.workItem.cancel({ reason: "auto-canceled" });
    },
  });

const workflowWithAutoStartDefinition = Builder.workflow("autoStartWorkflow")
  .startCondition("start")
  .task(
    "t1",
    Builder.task(autoStartWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("t1"))
  .connectTask("t1", (to) => to.condition("end"));

const autoStartVersionManager = versionManagerFor("autoStartWorkflow")
  .registerVersion(WORKFLOW_VERSION_NAME, workflowWithAutoStartDefinition)
  .build();

const workflowWithAutoCompleteDefinition = Builder.workflow(
  "autoCompleteWorkflow"
)
  .startCondition("start")
  .task(
    "t1",
    Builder.task(autoCompleteWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("t1"))
  .connectTask("t1", (to) => to.condition("end"));

const autoCompleteVersionManager = versionManagerFor("autoCompleteWorkflow")
  .registerVersion(WORKFLOW_VERSION_NAME, workflowWithAutoCompleteDefinition)
  .build();

const workflowWithAutoFailDefinition = Builder.workflow("autoFailWorkflow")
  .startCondition("start")
  .task(
    "t1",
    Builder.task(autoFailWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("t1"))
  .connectTask("t1", (to) => to.condition("end"));

const autoFailVersionManager = versionManagerFor("autoFailWorkflow")
  .registerVersion(WORKFLOW_VERSION_NAME, workflowWithAutoFailDefinition)
  .build();

const workflowWithAutoCancelDefinition = Builder.workflow("autoCancelWorkflow")
  .startCondition("start")
  .task(
    "t1",
    Builder.task(autoCancelWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("t1"))
  .connectTask("t1", (to) => to.condition("end"));

const autoCancelVersionManager = versionManagerFor("autoCancelWorkflow")
  .registerVersion(WORKFLOW_VERSION_NAME, workflowWithAutoCancelDefinition)
  .build();

it("auto-starts work item after initialization", async ({ expect }) => {
  vi.useFakeTimers();
  try {
    await withVersionManagers(autoStartVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "autoStartWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(1);
      expect(workItems[0].state).toBe("started");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("auto-completes work item after start", async ({ expect }) => {
  vi.useFakeTimers();
  try {
    await withVersionManagers(autoCompleteVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "autoCompleteWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(1);
      expect(workItems[0].state).toBe("completed");

      const tasks = await t.query(
        internal.testing.tasquencer.getWorkflowTasksByState,
        {
          workflowId: id,
          state: "completed",
        }
      );

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("t1");

      const workflow = await t.query(
        internal.testing.tasquencer.getWorkflowById,
        {
          workflowId: id,
        }
      );

      expect(workflow.state).toBe("completed");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("auto-fails work item after start", async ({ expect }) => {
  vi.useFakeTimers();
  try {
    await withVersionManagers(autoFailVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "autoFailWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(1);
      expect(workItems[0].state).toBe("failed");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("auto-cancels work item after start", async ({ expect }) => {
  vi.useFakeTimers();
  try {
    await withVersionManagers(autoCancelVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "autoCancelWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(1);
      expect(workItems[0].state).toBe("canceled");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("auto-starts multiple work items without race conditions", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const multiAutoStartWorkItem = Builder.workItem("multiAutoStartItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
    });

  const workflowWithMultiAutoStartDefinition = Builder.workflow(
    "multiAutoStartWorkflow"
  )
    .startCondition("start")
    .task(
      "t1",
      Builder.task(multiAutoStartWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
          await workItem.initialize();
          await workItem.initialize();
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  const multiAutoStartVersionManager = versionManagerFor(
    "multiAutoStartWorkflow"
  )
    .registerVersion(
      WORKFLOW_VERSION_NAME,
      workflowWithMultiAutoStartDefinition
    )
    .build();

  try {
    await withVersionManagers(multiAutoStartVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "multiAutoStartWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(3);
      expect(workItems.every((wi) => wi.state === "started")).toBe(true);
    });
  } finally {
    vi.useRealTimers();
  }
});

it("auto-completes multiple work items without race conditions", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const multiAutoCompleteWorkItem = Builder.workItem("multiAutoCompleteItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
      onStarted: async (ctx) => {
        ctx.workItem.complete({ result: "auto-completed" });
      },
    });

  const workflowWithMultiAutoCompleteDefinition = Builder.workflow(
    "multiAutoCompleteWorkflow"
  )
    .startCondition("start")
    .task(
      "t1",
      Builder.task(multiAutoCompleteWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
          await workItem.initialize();
          await workItem.initialize();
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  const multiAutoCompleteVersionManager = versionManagerFor(
    "multiAutoCompleteWorkflow"
  )
    .registerVersion(
      WORKFLOW_VERSION_NAME,
      workflowWithMultiAutoCompleteDefinition
    )
    .build();

  try {
    await withVersionManagers(multiAutoCompleteVersionManager, async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "multiAutoCompleteWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(3);
      expect(workItems.every((wi) => wi.state === "completed")).toBe(true);

      const tasks = await t.query(
        internal.testing.tasquencer.getWorkflowTasksByState,
        {
          workflowId: id,
          state: "completed",
        }
      );

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("t1");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("queues chained auto triggers sequentially for the same work item", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const startDelayMs = 5;
  const observedCompleteStates: string[] = [];

  const sequentialWorkItem = Builder.workItem("sequentialAutoItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await new Promise((resolve) => setTimeout(resolve, startDelayMs));
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          const current = await ctx.mutationCtx.db.get(ctx.workItem.id);
          observedCompleteStates.push(current?.state ?? "missing");
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
      onStarted: async (ctx) => {
        ctx.workItem.complete({ result: "auto-completed" });
      },
    });

  const sequentialWorkflowBuilder = Builder.workflow("sequentialAutoWorkflow")
    .startCondition("start")
    .task(
      "t1",
      Builder.task(sequentialWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  await withVersionManagerBuilders(
    {
      workflowName: "sequentialAutoWorkflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: sequentialWorkflowBuilder,
    },
    async () => {
      const t = setup();

      const initializePromise = t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "sequentialAutoWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      await vi.advanceTimersByTimeAsync(startDelayMs);

      const id = await initializePromise;
      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(1);
      expect(workItems[0].state).toBe("completed");
      expect(observedCompleteStates).toStrictEqual(["started"]);

      await vi.advanceTimersByTimeAsync(0);
      await t.finishInProgressScheduledFunctions();
    }
  );
  vi.useRealTimers();
});

it("handles mixed auto and manual transitions", async ({ expect }) => {
  vi.useFakeTimers();

  const mixedWorkItem = Builder.workItem("mixedItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
    });

  const workflowWithMixedBuilder = Builder.workflow("mixedWorkflow")
    .startCondition("start")
    .task(
      "t1",
      Builder.task(mixedWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
          await workItem.initialize();
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  await withVersionManagerBuilders(
    {
      workflowName: "mixedWorkflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: workflowWithMixedBuilder,
    },
    async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "mixedWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItemsAfterInit = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItemsAfterInit.length).toBe(2);
      expect(workItemsAfterInit.every((wi) => wi.state === "started")).toBe(
        true
      );

      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: "mixedWorkflow",
        workItemId: workItemsAfterInit[0]._id,
        payload: { result: "manually-completed-1" },
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: "mixedWorkflow",
        workItemId: workItemsAfterInit[1]._id,
        payload: { result: "manually-completed-2" },
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      const workItemsAfterComplete = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItemsAfterComplete.length).toBe(2);
      expect(
        workItemsAfterComplete.every((wi) => wi.state === "completed")
      ).toBe(true);

      const tasks = await t.query(
        internal.testing.tasquencer.getWorkflowTasksByState,
        {
          workflowId: id,
          state: "completed",
        }
      );

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("t1");
    }
  );
  vi.useRealTimers();
});

it("auto-triggers work items initialized in task onStarted", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const onStartedWorkItem = Builder.workItem("onStartedItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
      onStarted: async (ctx) => {
        ctx.workItem.complete({ result: "auto-completed" });
      },
    });

  const workflowWithOnStartedBuilder = Builder.workflow("onStartedWorkflow")
    .startCondition("start")
    .task(
      "t1",
      Builder.task(onStartedWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
        },
        onStarted: async ({ workItem }) => {
          await workItem.initialize();
          await workItem.initialize();
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  await withVersionManagerBuilders(
    {
      workflowName: "onStartedWorkflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: workflowWithOnStartedBuilder,
    },
    async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "onStartedWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(3);
      expect(workItems.every((wi) => wi.state === "completed")).toBe(true);
    }
  );
  vi.useRealTimers();
});

it("auto-triggers work items initialized in onWorkItemStateChanged", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const stateChangedWorkItem = Builder.workItem("stateChangedItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .complete(autoCompleteSchema, async (ctx, _payload) => {
          await ctx.workItem.complete();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
      onStarted: async (ctx) => {
        ctx.workItem.complete({ result: "auto-completed" });
      },
    });

  const workflowWithStateChangedBuilder = Builder.workflow(
    "stateChangedWorkflow"
  )
    .startCondition("start")
    .task(
      "t1",
      Builder.task(stateChangedWorkItem).withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
        },
        onWorkItemStateChanged: async ({ workItem }) => {
          const currentWorkItems = await workItem.getAllWorkItemIds();
          if (currentWorkItems.length === 1) {
            await workItem.initialize();
            await workItem.initialize();
          }
        },
      })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  await withVersionManagerBuilders(
    {
      workflowName: "stateChangedWorkflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: workflowWithStateChangedBuilder,
    },
    async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "stateChangedWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(3);
      expect(workItems.every((wi) => wi.state === "completed")).toBe(true);
    }
  );
  vi.useRealTimers();
});

it("auto-fails work items initialized in onWorkItemStateChanged without race conditions", async ({
  expect,
}) => {
  vi.useFakeTimers();

  const stateChangedFailWorkItem = Builder.workItem("stateChangedFailItem")
    .withActions(
      Builder.workItemActions()
        .start(autoStartSchema, async (ctx, _payload) => {
          await ctx.workItem.start();
        })
        .fail(autoFailSchema, async (ctx, _payload) => {
          await ctx.workItem.fail();
        })
    )
    .withActivities({
      onInitialized: async (ctx) => {
        ctx.workItem.start({ reason: "auto-started" });
      },
      onStarted: async (ctx) => {
        ctx.workItem.fail({ error: "auto-failed" });
      },
    });

  const workflowWithStateChangedFailBuilder = Builder.workflow(
    "stateChangedFailWorkflow"
  )
    .startCondition("start")
    .task(
      "t1",
      Builder.task(stateChangedFailWorkItem)
        .withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
          onWorkItemStateChanged: async ({ workItem }) => {
            const currentWorkItems = await workItem.getAllWorkItemIds();
            if (currentWorkItems.length === 1) {
              await workItem.initialize();
              await workItem.initialize();
            }
          },
        })
        .withPolicy(async ({ task, transition }) => {
          if (
            transition.nextState === "failed" ||
            transition.nextState === "canceled" ||
            transition.nextState === "completed"
          ) {
            const stats = await task.getStats();
            const finalized =
              stats.completed + stats.failed + stats.canceled === stats.total;
            return finalized ? "complete" : "continue";
          }
          return "continue";
        })
    )
    .endCondition("end")
    .connectCondition("start", (to) => to.task("t1"))
    .connectTask("t1", (to) => to.condition("end"));

  await withVersionManagerBuilders(
    {
      workflowName: "stateChangedFailWorkflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: workflowWithStateChangedFailBuilder,
    },
    async () => {
      const t = setup();

      const id = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "stateChangedFailWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(id).toBeDefined();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId: id,
          taskName: "t1",
        }
      );

      expect(workItems.length).toBe(3);
      expect(workItems.every((wi) => wi.state === "failed")).toBe(true);

      const tasks = await t.query(
        internal.testing.tasquencer.getWorkflowTasksByState,
        {
          workflowId: id,
          state: "completed",
        }
      );

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("t1");
    }
  );
  vi.useRealTimers();
});
