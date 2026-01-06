import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../../../_generated/api";
import { setup } from "../../../tasquencer/__tests__/setup.test";
import { waitForFlush } from "../../../tasquencer/__tests__/audit/helpers.test";

const WORKFLOW_NAME = "validatorWorkflow";
const WORKFLOW_VERSION = "v1";

describe("validator workflow api validators", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("rejects invalid root payloads", async () => {
    const t = setup();

    await expect(
      t.mutation(api.workflows.validator.api.initializeRootWorkflow, {
        // @ts-expect-error Invalid payload shape for runtime validation test.
        payload: {},
      })
    ).rejects.toThrow();
    await waitForFlush(t);
  });

  it("rejects invalid work item args", async () => {
    const t = setup();

    const workflowId = await t.mutation(
      api.workflows.validator.api.initializeRootWorkflow,
      {
        payload: { runId: "run-1" },
      }
    );
    await waitForFlush(t);

    const workItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "validate",
      }
    );

    expect(workItems.length).toBe(1);

    const workItemId = workItems[0]._id;

    await expect(
      t.mutation(api.workflows.validator.api.startWorkItem, {
        workItemId,
        args: {
          // @ts-expect-error Invalid work item name for runtime validation test.
          name: "wrongWorkItem",
          payload: { token: "not-a-uuid" },
        },
      })
    ).rejects.toThrow();
    await waitForFlush(t);

    await expect(
      t.mutation(api.workflows.validator.api.startWorkItem, {
        workItemId,
        args: { name: "validatorWorkItem", payload: { token: "not-a-uuid" } },
      })
    ).rejects.toThrow();
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId,
      args: {
        name: "validatorWorkItem",
        payload: { token: "2cc52a2a-3a0b-4d02-8f3a-70dc84a0d7a0" },
      },
    });
    await waitForFlush(t);

    await expect(
      t.mutation(api.workflows.validator.api.completeWorkItem, {
        workItemId,
        // @ts-expect-error Invalid payload shape for runtime validation test.
        args: { name: "validatorWorkItem", payload: { outcome: "nope" } },
      })
    ).rejects.toThrow();
    await waitForFlush(t);
  });

  it("validates pathological schemas across unions and nested structures", async () => {
    const t = setup();

    const workflowId = await t.mutation(
      api.workflows.validator.api.initializeRootWorkflow,
      {
        payload: { runId: "run-2" },
      }
    );
    await waitForFlush(t);

    const validateItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "validate",
      }
    );

    const validateWorkItemId = validateItems[0]._id;

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: validateWorkItemId,
      args: {
        name: "validatorWorkItem",
        payload: { token: "2cc52a2a-3a0b-4d02-8f3a-70dc84a0d7a0" },
      },
    });
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.completeWorkItem, {
      workItemId: validateWorkItemId,
      args: { name: "validatorWorkItem", payload: { outcome: "ok" } },
    });
    await waitForFlush(t);

    const pathologicalItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "pathological",
      }
    );

    const pathologicalWorkItemId = pathologicalItems[0]._id;

    await expect(
      t.mutation(api.workflows.validator.api.startWorkItem, {
        workItemId: pathologicalWorkItemId,
        args: { name: "pathologicalWorkItem", payload: { mode: "alpha", count: 0 } },
      })
    ).rejects.toThrow();
    await waitForFlush(t);

    await expect(
      t.mutation(api.workflows.validator.api.startWorkItem, {
        workItemId: pathologicalWorkItemId,
        args: { name: "pathologicalWorkItem", payload: { mode: "beta", tags: [] } },
      })
    ).rejects.toThrow();
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: pathologicalWorkItemId,
      args: {
        name: "pathologicalWorkItem",
        payload: { mode: "alpha", count: 1 },
      },
    });
    await waitForFlush(t);

    await expect(
      t.mutation(api.workflows.validator.api.completeWorkItem, {
        workItemId: pathologicalWorkItemId,
        args: {
          name: "pathologicalWorkItem",
          payload: {
            meta: { "": "nope" },
            items: [{ id: "not-a-uuid", flags: [true] }],
          },
        },
      })
    ).rejects.toThrow();
    await waitForFlush(t);
  });

  it("handles z.any and z.never payloads", async () => {
    const t = setup();

    const workflowId = await t.mutation(
      api.workflows.validator.api.initializeRootWorkflow,
      {
        payload: { runId: "run-3" },
      }
    );
    await waitForFlush(t);

    const validateItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "validate",
      }
    );

    const validateWorkItemId = validateItems[0]._id;

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: validateWorkItemId,
      args: {
        name: "validatorWorkItem",
        payload: { token: "2cc52a2a-3a0b-4d02-8f3a-70dc84a0d7a0" },
      },
    });
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.completeWorkItem, {
      workItemId: validateWorkItemId,
      args: { name: "validatorWorkItem", payload: { outcome: "ok" } },
    });
    await waitForFlush(t);

    const pathologicalItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "pathological",
      }
    );

    const pathologicalWorkItemId = pathologicalItems[0]._id;

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: pathologicalWorkItemId,
      args: {
        name: "pathologicalWorkItem",
        payload: { mode: "alpha", count: 1 },
      },
    });
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.completeWorkItem, {
      workItemId: pathologicalWorkItemId,
      args: {
        name: "pathologicalWorkItem",
        payload: {
          meta: { ok: "yes", count: 2 },
          items: [
            {
              id: "2cc52a2a-3a0b-4d02-8f3a-70dc84a0d7a0",
              flags: [true, false],
            },
          ],
        },
      },
    });
    await waitForFlush(t);

    const anyItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "anyPayload",
      }
    );

    const anyWorkItemId = anyItems[0]._id;

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: anyWorkItemId,
      args: { name: "anyPayloadWorkItem", payload: 123 },
    });
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.completeWorkItem, {
      workItemId: anyWorkItemId,
      args: { name: "anyPayloadWorkItem", payload: { nested: ["ok"] } },
    });
    await waitForFlush(t);

    const neverItems = await t.query(
      api.workflows.validator.api.getWorkflowWorkItems,
      {
        workflowId,
        taskName: "neverPayload",
      }
    );

    const neverWorkItemId = neverItems[0]._id;

    await t.mutation(api.workflows.validator.api.startWorkItem, {
      workItemId: neverWorkItemId,
      // @ts-expect-error z.never payloads should be omitted but runtime allows {}.
      args: { name: "neverPayloadWorkItem", payload: {} },
    });
    await waitForFlush(t);

    await t.mutation(api.workflows.validator.api.completeWorkItem, {
      workItemId: neverWorkItemId,
      args: { name: "neverPayloadWorkItem", payload: "done" },
    });
    await waitForFlush(t);

    await expect(
      t.mutation(api.workflows.validator.api.startWorkItem, {
        workItemId: neverWorkItemId,
        // @ts-expect-error Invalid payload for z.never action.
        args: { name: "neverPayloadWorkItem", payload: { extra: 1 } },
      })
    ).rejects.toThrow();
    await waitForFlush(t);
  });
});
