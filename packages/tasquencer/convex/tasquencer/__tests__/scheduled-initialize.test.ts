import { setup, Builder } from "./setup.test";
import { it, vi, describe, beforeEach, afterEach } from "vitest";
import schema from "../../schema";

import { withVersionManagerBuilders } from "./helpers/versionManager";
import { internal } from "../../_generated/api";
import { z } from "zod";
import { workflowKey, taskKey, workItemKey } from "../util/scheduler";
import { type Id } from "../../_generated/dataModel";

const scheduledIdLog: Id<"_scheduled_functions">[] = [];

const WORKFLOW_VERSION_NAME = "v0";

const scheduledWorkItemWorkflow = Builder.workflow("scheduled-work-item")
  .startCondition("start")
  .task(
    "delayedTask",
    Builder.noOpTask.withActivities({
      onEnabled: async ({
        mutationCtx,
        registerScheduled,
        workItem,
        parent,
        task,
      }) => {
        await registerScheduled(
          mutationCtx.scheduler.runAfter(
            200,
            internal.testing.tasquencer.initializeWorkItem,
            {
              workflowName: "scheduled-work-item",
              workflowVersionName: WORKFLOW_VERSION_NAME,
              target: {
                path: workItem.path,
                parentWorkflowId: parent.workflow.id,
                parentTaskName: task.name,
              },
              payload: undefined,
            }
          )
        );
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("delayedTask"))
  .connectTask("delayedTask", (to) => to.condition("end"));

const scheduledReplacementWorkflow = Builder.workflow(
  "scheduled-work-item-replaces"
)
  .startCondition("start")
  .task(
    "delayedTask",
    Builder.noOpTask.withActivities({
      onEnabled: async ({
        mutationCtx,
        registerScheduled,
        workItem,
        parent,
        task,
      }) => {
        const firstId = await registerScheduled(
          mutationCtx.scheduler.runAfter(
            50,
            internal.testing.tasquencer.initializeWorkItem,
            {
              workflowName: "scheduled-work-item-replaces",
              workflowVersionName: WORKFLOW_VERSION_NAME,
              target: {
                path: workItem.path,
                parentWorkflowId: parent.workflow.id,
                parentTaskName: task.name,
              },
              payload: undefined,
            }
          )
        );
        scheduledIdLog.push(firstId);

        const secondId = await registerScheduled(
          mutationCtx.scheduler.runAfter(
            200,
            internal.testing.tasquencer.initializeWorkItem,
            {
              workflowName: "scheduled-work-item-replaces",
              workflowVersionName: WORKFLOW_VERSION_NAME,
              target: {
                path: workItem.path,
                parentWorkflowId: parent.workflow.id,
                parentTaskName: task.name,
              },
              payload: undefined,
            }
          )
        );
        scheduledIdLog.push(secondId);
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("delayedTask"))
  .connectTask("delayedTask", (to) => to.condition("end"));

const simpleChildWorkflow = Builder.workflow("scheduled-child-workflow")
  .startCondition("start")
  .task(
    "childTask",
    Builder.noOpTask.withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize({});
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("childTask"))
  .connectTask("childTask", (to) => to.condition("end"));

const scheduledCompositeWorkflow = Builder.workflow(
  "scheduled-composite-workflow"
)
  .startCondition("start")
  .compositeTask(
    "delayedComposite",
    Builder.compositeTask(simpleChildWorkflow).withActivities({
      onEnabled: async ({
        mutationCtx,
        registerScheduled,
        workflow,
        parent,
        task,
      }) => {
        await registerScheduled(
          mutationCtx.scheduler.runAfter(
            200,
            internal.testing.tasquencer.initializeWorkflow,
            {
              workflowName: "scheduled-composite-workflow",
              workflowVersionName: WORKFLOW_VERSION_NAME,
              target: {
                path: workflow.path,
                parentWorkflowId: parent.workflow.id,
                parentTaskName: task.name,
              },
              payload: undefined,
            }
          )
        );
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("delayedComposite"))
  .connectTask("delayedComposite", (to) => to.condition("end"));

const scheduledCompletionTargetWorkflow = Builder.workflow(
  "scheduled-completion-target"
)
  .startCondition("start")
  .task("targetTask", Builder.noOpTask)
  .endCondition("end")
  .connectCondition("start", (to) => to.task("targetTask"))
  .connectTask("targetTask", (to) => to.condition("end"));

const scheduledCompletionWorkflow = Builder.workflow(
  "scheduled-completion-cancel"
)
  .startCondition("start")
  .task(
    "unitTask",
    Builder.task(
      Builder.workItem("unitWork").withActions(
        Builder.workItemActions().initialize(
          z.never(),
          async ({ mutationCtx, registerScheduled, workItem }) => {
            await workItem.initialize();

            await registerScheduled(
              mutationCtx.scheduler.runAfter(
                200,
                internal.testing.tasquencer.initializeRootWorkflow,
                {
                  workflowName: "scheduled-completion-target",
                  workflowVersionName: WORKFLOW_VERSION_NAME,
                }
              )
            );
          }
        )
      )
    )
      .withActivities({
        onEnabled: async ({ workItem }) => {
          await workItem.initialize();
        },
      })
      .withPolicy(async () => "continue")
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("unitTask"))
  .connectTask("unitTask", (to) => to.condition("end"));

function buildCleanupWorkflow(name: string) {
  const SCHEDULE_DELAY = 60 * 1000;
  const workItem = Builder.workItem("unitWork").withActions(
    Builder.workItemActions().initialize(
      z.never(),
      async ({ mutationCtx, workItem, registerScheduled, parent }) => {
        const workItemId = await workItem.initialize();

        await registerScheduled(
          mutationCtx.scheduler.runAfter(
            SCHEDULE_DELAY,
            internal.testing.tasquencer.cancelWorkItem,
            {
              workflowName: parent.workflow.name,
              workflowVersionName: WORKFLOW_VERSION_NAME,
              workItemId,
            }
          )
        );
      }
    )
  );

  const task = Builder.task(workItem).withActivities({
    onEnabled: async ({ mutationCtx, registerScheduled, parent, workItem }) => {
      await registerScheduled(
        mutationCtx.scheduler.runAfter(
          SCHEDULE_DELAY,
          internal.testing.tasquencer.cancelWorkflow,
          {
            workflowName: parent.workflow.name,
            workflowVersionName: WORKFLOW_VERSION_NAME,
            workflowId: parent.workflow.id,
          }
        )
      );

      await workItem.initialize();
    },
  });

  return Builder.workflow(name)
    .withActivities({
      onInitialized: async ({ mutationCtx, registerScheduled, workflow }) => {
        await registerScheduled(
          mutationCtx.scheduler.runAfter(
            SCHEDULE_DELAY,
            internal.testing.tasquencer.cancelWorkflow,
            {
              workflowName: workflow.name,
              workflowVersionName: WORKFLOW_VERSION_NAME,
              workflowId: workflow.id,
            }
          )
        );
      },
    })
    .startCondition("start")
    .task("unitTask", task)
    .endCondition("end")
    .connectCondition("start", (to) => to.task("unitTask"))
    .connectTask("unitTask", (to) => to.condition("end"));
}

function buildCompositeCleanupWorkflow(name: string) {
  const SCHEDULE_DELAY = 60 * 1000;

  const childWorkItem = Builder.workItem("childWork").withActions(
    Builder.workItemActions().initialize(z.never(), async ({ workItem }) => {
      await workItem.initialize();
    })
  );

  const childWorkflow = Builder.workflow(`${name}-child`)
    .startCondition("start")
    .task("childTask", Builder.task(childWorkItem))
    .endCondition("end")
    .connectCondition("start", (to) => to.task("childTask"))
    .connectTask("childTask", (to) => to.condition("end"));

  const compositeTask = Builder.compositeTask(childWorkflow).withActivities({
    onEnabled: async ({ mutationCtx, registerScheduled, parent, workflow }) => {
      await registerScheduled(
        mutationCtx.scheduler.runAfter(
          SCHEDULE_DELAY,
          internal.testing.tasquencer.cancelWorkflow,
          {
            workflowName: parent.workflow.name,
            workflowVersionName: WORKFLOW_VERSION_NAME,
            workflowId: parent.workflow.id,
          }
        )
      );

      await workflow.initialize();
    },
  });

  const parentWorkflow = Builder.workflow(name)
    .startCondition("start")
    .compositeTask("composite", compositeTask)
    .endCondition("end")
    .connectCondition("start", (to) => to.task("composite"))
    .connectTask("composite", (to) => to.condition("end"));

  return { parentWorkflow, childWorkflow };
}

function getScheduledInitializations(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    return await ctx.db.query("tasquencerScheduledInitializations").collect();
  });
}

async function getTaskDoc(
  t: ReturnType<typeof setup>,
  workflowId: any,
  taskName: string
) {
  return await t.run(async (ctx: any) => {
    return await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_name_and_generation", (q: any) =>
        q.eq("workflowId", workflowId).eq("name", taskName)
      )
      .first();
  });
}

async function getScheduledKeys(t: ReturnType<typeof setup>) {
  const scheduled = await getScheduledInitializations(t);
  return scheduled.map((entry) => entry.key);
}

async function getTaskWorkItems(
  t: ReturnType<typeof setup>,
  workflowId: any,
  taskName: string
) {
  return await t.query(internal.testing.tasquencer.getWorkflowTaskWorkItems, {
    workflowId,
    taskName,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  scheduledIdLog.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

it("initializes work items when scheduleInitialize triggers", async ({
  expect,
}) => {
  await withVersionManagerBuilders(
    {
      workflowName: "scheduled-work-item",
      versionName: WORKFLOW_VERSION_NAME,
      builder: scheduledWorkItemWorkflow,
    },
    async () => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "scheduled-work-item",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      let workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "delayedTask",
        }
      );

      expect(workItems).toHaveLength(0);

      const scheduledEntriesBefore = await getScheduledInitializations(t);
      expect(scheduledEntriesBefore).toHaveLength(1);
      const { task } = await t.run(async (ctx: any) => {
        const task = await ctx.db
          .query("tasquencerTasks")
          .withIndex("by_workflow_id_name_and_generation", (q: any) =>
            q.eq("workflowId", workflowId).eq("name", "delayedTask")
          )
          .first();
        return { task };
      });

      expect(task).toBeDefined();
      expect(scheduledEntriesBefore[0].key).toBe(
        `task/${task!._id}/${task!.generation}`
      );
      expect(scheduledEntriesBefore[0].scheduledFunctionId).toBeDefined();

      await vi.advanceTimersByTimeAsync(200);
      await t.finishInProgressScheduledFunctions();

      workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "delayedTask",
        }
      );

      expect(workItems).toHaveLength(1);
      expect(workItems[0].state).toBe("initialized");

      const scheduledEntriesAfter = await getScheduledInitializations(t);
      expect(scheduledEntriesAfter).toHaveLength(1);
      expect(scheduledEntriesAfter[0].key).toBe(
        `task/${task!._id}/${task!.generation}`
      );
      expect(scheduledEntriesAfter[0].scheduledFunctionId).toBe(
        scheduledEntriesBefore[0].scheduledFunctionId
      );
    }
  );
});

it("cancels scheduled initializations when the task is canceled", async ({
  expect,
}) => {
  await withVersionManagerBuilders(
    {
      workflowName: "scheduled-work-item",
      versionName: WORKFLOW_VERSION_NAME,
      builder: scheduledWorkItemWorkflow,
    },
    async () => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "scheduled-work-item",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      await vi.advanceTimersByTimeAsync(50);

      await t.mutation(internal.testing.tasquencer.cancelRootWorkflow, {
        workflowName: "scheduled-work-item",
        workflowId,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      await vi.advanceTimersByTimeAsync(500);
      await t.finishInProgressScheduledFunctions();

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "delayedTask",
        }
      );
      expect(workItems).toHaveLength(0);

      const scheduledEntriesAfter = await getScheduledInitializations(t);
      expect(scheduledEntriesAfter).toHaveLength(0);
    }
  );
});

it("keeps multiple scheduled initializations when registerScheduled runs again", async ({
  expect,
}) => {
  await withVersionManagerBuilders(
    {
      workflowName: "scheduled-work-item-replaces",
      versionName: WORKFLOW_VERSION_NAME,
      builder: scheduledReplacementWorkflow,
    },
    async () => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "scheduled-work-item-replaces",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      expect(scheduledIdLog).toHaveLength(2);

      const task = await getTaskDoc(t, workflowId, "delayedTask");
      expect(task).toBeDefined();

      const scheduledEntries = await getScheduledInitializations(t);
      expect(scheduledEntries).toHaveLength(2);
      scheduledEntries.forEach((entry) => {
        expect(entry.key).toBe(`task/${task!._id}/${task!.generation}`);
      });
      const scheduledIds = scheduledEntries.map(
        (entry) => entry.scheduledFunctionId
      );
      expect(new Set(scheduledIds)).toEqual(new Set(scheduledIdLog));

      await vi.advanceTimersByTimeAsync(75);
      await t.finishInProgressScheduledFunctions();

      let workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "delayedTask",
        }
      );
      expect(workItems).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(200);
      await t.finishInProgressScheduledFunctions();

      workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "delayedTask",
        }
      );
      expect(workItems).toHaveLength(2);
      expect(workItems[0].state).toBe("initialized");

      const scheduledEntriesAfter = await getScheduledInitializations(t);
      expect(scheduledEntriesAfter).toHaveLength(2);
      const scheduledIdsAfter = scheduledEntriesAfter.map(
        (entry) => entry.scheduledFunctionId
      );
      expect(new Set(scheduledIdsAfter)).toEqual(new Set(scheduledIdLog));
    }
  );
});

it("initializes composite workflows when scheduled", async ({ expect }) => {
  await withVersionManagerBuilders(
    {
      workflowName: "scheduled-composite-workflow",
      versionName: WORKFLOW_VERSION_NAME,
      builder: scheduledCompositeWorkflow,
    },
    async () => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "scheduled-composite-workflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      let childWorkflows = await t.query(
        internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
        {
          workflowId,
          taskName: "delayedComposite",
        }
      );

      expect(childWorkflows).toHaveLength(0);

      const scheduledEntriesBefore = await getScheduledInitializations(t);
      expect(scheduledEntriesBefore).toHaveLength(1);
      const { task } = await t.run(async (ctx: any) => {
        const task = await ctx.db
          .query("tasquencerTasks")
          .withIndex("by_workflow_id_name_and_generation", (q: any) =>
            q.eq("workflowId", workflowId).eq("name", "delayedComposite")
          )
          .first();
        return { task };
      });

      expect(task).toBeDefined();
      expect(scheduledEntriesBefore[0].key).toBe(
        `task/${task!._id}/${task!.generation}`
      );
      expect(scheduledEntriesBefore[0].scheduledFunctionId).toBeDefined();

      await vi.advanceTimersByTimeAsync(200);
      await t.finishInProgressScheduledFunctions();

      childWorkflows = await t.query(
        internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
        {
          workflowId,
          taskName: "delayedComposite",
        }
      );

      expect(childWorkflows).toHaveLength(1);
      expect(childWorkflows[0].state).toBe("initialized");

      const scheduledEntriesAfter = await getScheduledInitializations(t);
      expect(scheduledEntriesAfter).toHaveLength(1);
      expect(scheduledEntriesAfter[0].key).toBe(
        `task/${task!._id}/${task!.generation}`
      );
      expect(scheduledEntriesAfter[0].scheduledFunctionId).toBe(
        scheduledEntriesBefore[0].scheduledFunctionId
      );
    }
  );
});

describe("scheduled cleanup", () => {
  it("cancels work item scheduled jobs after completion", async ({
    expect,
  }) => {
    await withVersionManagerBuilders(
      [
        {
          workflowName: "scheduled-completion-cancel",
          versionName: WORKFLOW_VERSION_NAME,
          builder: scheduledCompletionWorkflow,
        },
        {
          workflowName: "scheduled-completion-target",
          versionName: WORKFLOW_VERSION_NAME,
          builder: scheduledCompletionTargetWorkflow,
        },
      ],
      async () => {
        const t = setup();

        const workflowId = await t.mutation(
          internal.testing.tasquencer.initializeRootWorkflow,
          {
            workflowName: "scheduled-completion-cancel",
            workflowVersionName: WORKFLOW_VERSION_NAME,
          }
        );

        const workItems = await getTaskWorkItems(t, workflowId, "unitTask");
        expect(workItems).toHaveLength(1);
        const workItemId = workItems[0]._id;

        await t.mutation(internal.testing.tasquencer.startWorkItem, {
          workflowName: "scheduled-completion-cancel",
          workItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        await t.mutation(internal.testing.tasquencer.completeWorkItem, {
          workflowName: "scheduled-completion-cancel",
          workItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        await vi.advanceTimersByTimeAsync(250);
        await t.finishInProgressScheduledFunctions();

        const targetWorkflows = await t.run(async (ctx) => {
          return await ctx.db
            .query("tasquencerWorkflows")
            .filter((q) => q.eq(q.field("name"), "scheduled-completion-target"))
            .collect();
        });

        expect(targetWorkflows).toHaveLength(0);
      }
    );
  });

  it("clears workflow, task, and work item scheduled entries when workflow completes", async ({
    expect,
  }) => {
    const workflowName = `scheduled-cleanup-complete-${Math.random()}`;
    const workflowBuilder = buildCleanupWorkflow(workflowName);
    await withVersionManagerBuilders(
      {
        workflowName,
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowBuilder,
      },
      async () => {
        const t = setup();

        const workflowId = await t.mutation(
          internal.testing.tasquencer.initializeRootWorkflow,
          {
            workflowName,
            workflowVersionName: WORKFLOW_VERSION_NAME,
          }
        );

        const taskDoc = await getTaskDoc(t, workflowId, "unitTask");
        expect(taskDoc).toBeDefined();

        const workItems = await getTaskWorkItems(t, workflowId, "unitTask");
        expect(workItems).toHaveLength(1);
        const workItemId = workItems[0]._id;

        let keys = await getScheduledKeys(t);
        expect(keys).toEqual(
          expect.arrayContaining([
            workflowKey(workflowId),
            taskKey(taskDoc!._id, taskDoc!.generation),
            workItemKey(workItemId),
          ])
        );

        await t.mutation(internal.testing.tasquencer.startWorkItem, {
          workflowName,
          workItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        await t.mutation(internal.testing.tasquencer.completeWorkItem, {
          workflowName,
          workItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        keys = await getScheduledKeys(t);
        expect(keys).not.toContain(workflowKey(workflowId));
        expect(keys).not.toContain(taskKey(taskDoc!._id, taskDoc!.generation));
        expect(keys).not.toContain(workItemKey(workItemId));
        expect(keys).toHaveLength(0);
      }
    );
  });

  it("clears scheduled entries when workflow is canceled", async ({
    expect,
  }) => {
    const workflowName = `scheduled-cleanup-cancel-${Math.random()}`;
    const workflowBuilder = buildCleanupWorkflow(workflowName);
    await withVersionManagerBuilders(
      {
        workflowName,
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowBuilder,
      },
      async () => {
        const t = setup();

        const workflowId = await t.mutation(
          internal.testing.tasquencer.initializeRootWorkflow,
          {
            workflowName,
            workflowVersionName: WORKFLOW_VERSION_NAME,
          }
        );

        const keysBefore = await getScheduledKeys(t);
        expect(keysBefore).toContain(workflowKey(workflowId));

        await t.mutation(internal.testing.tasquencer.cancelRootWorkflow, {
          workflowName,
          workflowId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        const keysAfter = await getScheduledKeys(t);
        expect(keysAfter).toHaveLength(0);
      }
    );
  });

  it("clears scheduled entries when workflow fails", async ({ expect }) => {
    const workflowName = `scheduled-cleanup-fail-${Math.random()}`;
    const workflowBuilder = buildCleanupWorkflow(workflowName);
    await withVersionManagerBuilders(
      {
        workflowName,
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowBuilder,
      },
      async () => {
        const t = setup();

        const workflowId = await t.mutation(
          internal.testing.tasquencer.initializeRootWorkflow,
          {
            workflowName,
            workflowVersionName: WORKFLOW_VERSION_NAME,
          }
        );

        const taskDoc = await getTaskDoc(t, workflowId, "unitTask");
        expect(taskDoc).toBeDefined();

        const workItems = await getTaskWorkItems(t, workflowId, "unitTask");
        expect(workItems).toHaveLength(1);
        const workItemId = workItems[0]._id;

        await t.mutation(internal.testing.tasquencer.startWorkItem, {
          workflowName,
          workItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        await t.mutation(internal.testing.tasquencer.failWorkItem, {
          workflowName,
          workItemId,
          payload: { reason: "test failure" },
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        const keysAfter = await getScheduledKeys(t);
        expect(keysAfter).toHaveLength(0);
      }
    );
  });

  it("clears composite task scheduled entries when child workflow completes", async ({
    expect,
  }) => {
    const workflowName = `scheduled-cleanup-composite-${Math.random()}`;
    const { parentWorkflow, childWorkflow } =
      buildCompositeCleanupWorkflow(workflowName);
    await withVersionManagerBuilders(
      [
        {
          workflowName,
          versionName: WORKFLOW_VERSION_NAME,
          builder: parentWorkflow,
        },
        {
          workflowName: `${workflowName}-child`,
          versionName: WORKFLOW_VERSION_NAME,
          builder: childWorkflow,
        },
      ],
      async () => {
        const t = setup();

        const workflowId = await t.mutation(
          internal.testing.tasquencer.initializeRootWorkflow,
          {
            workflowName,
            workflowVersionName: WORKFLOW_VERSION_NAME,
          }
        );

        const parentTask = await getTaskDoc(t, workflowId, "composite");
        expect(parentTask).toBeDefined();

        const keysBefore = await getScheduledKeys(t);
        expect(keysBefore).toContain(
          taskKey(parentTask!._id, parentTask!.generation)
        );

        const childWorkflows = await t.query(
          internal.testing.tasquencer.getWorkflowCompositeTaskWorkflows,
          {
            workflowId,
            taskName: "composite",
          }
        );

        expect(childWorkflows).toHaveLength(1);
        const childWorkflowId = childWorkflows[0]._id;

        const childTaskDoc = await getTaskDoc(t, childWorkflowId, "childTask");

        let childWorkItems = await getTaskWorkItems(
          t,
          childWorkflowId,
          "childTask"
        );
        if (childWorkItems.length === 0 && childTaskDoc) {
          const childWorkflowName = `${workflowName}-child`;
          const workflowPathStart = childTaskDoc.path.findIndex(
            (segment: string) => segment === childWorkflowName
          );
          const childRelativePath =
            workflowPathStart === -1
              ? childTaskDoc.path
              : childTaskDoc.path.slice(workflowPathStart);

          await t.mutation(internal.testing.tasquencer.initializeWorkItem, {
            workflowName: childWorkflowName,
            workflowVersionName: WORKFLOW_VERSION_NAME,
            target: {
              path: [...childRelativePath, "tasquencer/no-op-work-item"],
              parentWorkflowId: childWorkflowId,
              parentTaskName: "childTask",
            },
            payload: {},
          });

          childWorkItems = await getTaskWorkItems(
            t,
            childWorkflowId,
            "childTask"
          );
        }

        expect(childWorkItems).toHaveLength(1);
        const childWorkItemId = childWorkItems[0]._id;

        await t.mutation(internal.testing.tasquencer.startWorkItem, {
          workflowName: childWorkflows[0].name,
          workItemId: childWorkItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        await t.mutation(internal.testing.tasquencer.completeWorkItem, {
          workflowName: childWorkflows[0].name,
          workItemId: childWorkItemId,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        });

        const keysAfter = await getScheduledKeys(t);
        expect(keysAfter).not.toContain(workflowKey(childWorkflowId));
        expect(keysAfter).not.toContain(
          taskKey(childTaskDoc!._id, childTaskDoc!.generation)
        );
        expect(keysAfter).toHaveLength(0);
      }
    );
  });
});
