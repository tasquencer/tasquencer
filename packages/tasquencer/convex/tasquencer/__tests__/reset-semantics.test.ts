import { setup, Builder } from "./setup.test";
import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { internal } from "../../../convex/_generated/api";

import schema from "../../schema";
import { registerVersionManagersForTesting } from "./helpers/versionManager";
import { z } from "zod";

const WORKFLOW_VERSION_NAME = "v0";

describe("reset-semantics", () => {
  describe("basic reset flow", () => {
    const workflowDefinition = Builder.workflow("resetBasic")
      .startCondition("start")
      .task(
        "t1",
        Builder.noOpTask.withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetBasic",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("resets a started work item back to initialized", async ({ expect }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetBasic",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      // Get work item and verify initialized state
      const workItemsBefore = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsBefore.length).toBe(1);
      expect(workItemsBefore[0].state).toBe("initialized");

      // Start the work item
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetBasic",
        workItemId: workItemsBefore[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Verify started state
      const workItemsStarted = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsStarted[0].state).toBe("started");

      // Reset the work item
      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetBasic",
        workItemId: workItemsBefore[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Verify reset back to initialized
      const workItemsAfterReset = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsAfterReset[0].state).toBe("initialized");
    });

    it("allows work item to be started again after reset", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetBasic",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Start -> Reset -> Start cycle
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetBasic",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetBasic",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Should be able to start again
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetBasic",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      const workItemsAfter = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsAfter[0].state).toBe("started");
    });
  });

  describe("reset with custom payload", () => {
    let capturedPayload: { reason: string } | undefined;

    const workflowDefinition = Builder.workflow("resetPayload")
      .startCondition("start")
      .task(
        "t1",
        Builder.task(
          Builder.workItem("customReset")
            .withActions(
              Builder.workItemActions().reset(
                z.object({ reason: z.string() }),
                async ({ workItem }, payload) => {
                  capturedPayload = payload;
                  await workItem.reset();
                }
              )
            )
            .withActivities({
              onInitialized: async ({ workItem }) => {
                await workItem.start();
              },
            })
        ).withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      capturedPayload = undefined;
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetPayload",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("passes payload correctly to reset action callback", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetPayload",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItems[0].state).toBe("started");

      // Reset with payload
      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetPayload",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
        payload: { reason: "user requested retry" },
      });

      expect(capturedPayload).toEqual({ reason: "user requested retry" });

      const workItemsAfter = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsAfter[0].state).toBe("initialized");
    });
  });

  describe("reset triggers onReset activity", () => {
    let onResetCalled = false;
    let onResetWorkItemId: string | undefined;

    const workflowDefinition = Builder.workflow("resetActivity")
      .startCondition("start")
      .task(
        "t1",
        Builder.task(
          Builder.workItem("activityReset").withActivities({
            onInitialized: async ({ workItem }) => {
              await workItem.start();
            },
            onReset: async ({ workItem }) => {
              onResetCalled = true;
              onResetWorkItemId = workItem.id;
            },
          })
        ).withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      onResetCalled = false;
      onResetWorkItemId = undefined;
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetActivity",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("calls onReset activity with correct context", async ({ expect }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetActivity",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItems[0].state).toBe("started");

      expect(onResetCalled).toBe(false);

      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetActivity",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      expect(onResetCalled).toBe(true);
      expect(onResetWorkItemId).toBe(workItems[0]._id);
    });
  });

  describe("invalid state transitions", () => {
    const workflowDefinition = Builder.workflow("resetInvalid")
      .startCondition("start")
      .task(
        "t1",
        Builder.noOpTask.withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetInvalid",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("throws error when resetting from initialized state", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetInvalid",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItems[0].state).toBe("initialized");

      await expect(
        t.mutation(internal.testing.tasquencer.resetWorkItem, {
          workflowName: "resetInvalid",
          workItemId: workItems[0]._id,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        })
      ).rejects.toThrow();
    });

    it("throws error when resetting from completed state", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetInvalid",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Start and complete the work item
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      const workItemsCompleted = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsCompleted[0].state).toBe("completed");

      await expect(
        t.mutation(internal.testing.tasquencer.resetWorkItem, {
          workflowName: "resetInvalid",
          workItemId: workItems[0]._id,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        })
      ).rejects.toThrow();
    });

    it("throws error when resetting from failed state", async ({ expect }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetInvalid",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Start and fail the work item
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.failWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      const workItemsFailed = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsFailed[0].state).toBe("failed");

      await expect(
        t.mutation(internal.testing.tasquencer.resetWorkItem, {
          workflowName: "resetInvalid",
          workItemId: workItems[0]._id,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        })
      ).rejects.toThrow();
    });

    it("throws error when resetting from canceled state", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetInvalid",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Start and cancel the work item
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.cancelWorkItem, {
        workflowName: "resetInvalid",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      const workItemsCanceled = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(workItemsCanceled[0].state).toBe("canceled");

      await expect(
        t.mutation(internal.testing.tasquencer.resetWorkItem, {
          workflowName: "resetInvalid",
          workItemId: workItems[0]._id,
          workflowVersionName: WORKFLOW_VERSION_NAME,
        })
      ).rejects.toThrow();
    });
  });

  describe("multiple resets", () => {
    const workflowDefinition = Builder.workflow("resetMultiple")
      .startCondition("start")
      .task(
        "t1",
        Builder.noOpTask.withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetMultiple",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("handles multiple reset cycles before completion", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetMultiple",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      const workItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Cycle 1: Start -> Reset
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      let currentState = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(currentState[0].state).toBe("initialized");

      // Cycle 2: Start -> Reset
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      currentState = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(currentState[0].state).toBe("initialized");

      // Cycle 3: Start -> Complete
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: "resetMultiple",
        workItemId: workItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Verify final state
      currentState = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );
      expect(currentState[0].state).toBe("completed");

      // Verify task completed
      const tasks = await t.query(
        internal.testing.tasquencer.getWorkflowTasks,
        {
          workflowId,
        }
      );
      expect(tasks[0].state).toBe("completed");
    });
  });

  describe("reset in workflow context", () => {
    const workflowDefinition = Builder.workflow("resetWorkflow")
      .startCondition("start")
      .task(
        "t1",
        Builder.noOpTask.withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .task(
        "t2",
        Builder.noOpTask.withActivities({
          onEnabled: async ({ workItem }) => {
            await workItem.initialize();
          },
        })
      )
      .endCondition("end")
      .connectCondition("start", (to) => to.task("t1"))
      .connectTask("t1", (to) => to.task("t2"))
      .connectTask("t2", (to) => to.condition("end"));

    let cleanupVersionManagers: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      cleanupVersionManagers = registerVersionManagersForTesting({
        workflowName: "resetWorkflow",
        versionName: WORKFLOW_VERSION_NAME,
        builder: workflowDefinition,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      cleanupVersionManagers();
    });

    it("maintains correct task state during reset cycle", async ({
      expect,
    }) => {
      const t = setup();

      const workflowId = await t.mutation(
        internal.testing.tasquencer.initializeRootWorkflow,
        {
          workflowName: "resetWorkflow",
          workflowVersionName: WORKFLOW_VERSION_NAME,
        }
      );

      // Get t1 work items
      const t1WorkItems = await t.query(
        internal.testing.tasquencer.getWorkflowTaskWorkItems,
        {
          workflowId,
          taskName: "t1",
        }
      );

      // Start t1
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetWorkflow",
        workItemId: t1WorkItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Verify task is started
      let tasks = await t.query(internal.testing.tasquencer.getWorkflowTasks, {
        workflowId,
      });
      const t1 = tasks.find((t) => t.name === "t1");
      expect(t1?.state).toBe("started");

      // Reset t1 work item
      await t.mutation(internal.testing.tasquencer.resetWorkItem, {
        workflowName: "resetWorkflow",
        workItemId: t1WorkItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Task should still be started (has an initialized work item)
      tasks = await t.query(internal.testing.tasquencer.getWorkflowTasks, {
        workflowId,
      });
      const t1AfterReset = tasks.find((t) => t.name === "t1");
      expect(t1AfterReset?.state).toBe("started");

      // Start and complete t1
      await t.mutation(internal.testing.tasquencer.startWorkItem, {
        workflowName: "resetWorkflow",
        workItemId: t1WorkItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });
      await t.mutation(internal.testing.tasquencer.completeWorkItem, {
        workflowName: "resetWorkflow",
        workItemId: t1WorkItems[0]._id,
        workflowVersionName: WORKFLOW_VERSION_NAME,
      });

      // Verify t1 completed and t2 enabled
      tasks = await t.query(internal.testing.tasquencer.getWorkflowTasks, {
        workflowId,
      });
      const t1Completed = tasks.find((t) => t.name === "t1");
      const t2Enabled = tasks.find((t) => t.name === "t2");
      expect(t1Completed?.state).toBe("completed");
      expect(t2Enabled?.state).toBe("enabled");
    });
  });
});
