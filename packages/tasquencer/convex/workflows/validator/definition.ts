import { z } from "zod";
import type { MutationCtx } from "../../_generated/server";
import { makeBuilder } from "../../tasquencer/builder";
import { versionManagerFor } from "../../tasquencer/versionManager";

const Builder = makeBuilder<MutationCtx>();

const validatorWorkItemActions = Builder.workItemActions()
  .start(
    z.object({
      token: z.string().uuid(),
    }),
    async ({ workItem }) => {
      await workItem.start();
    }
  )
  .complete(
    z.object({
      outcome: z.literal("ok"),
    }),
    async ({ workItem }) => {
      await workItem.complete();
    }
  );

const validatorWorkItem = Builder.workItem("validatorWorkItem").withActions(
  validatorWorkItemActions
);

const pathologicalWorkItemActions = Builder.workItemActions()
  .start(
    z
      .union([
        z.object({
          mode: z.literal("alpha"),
          count: z.number().int().min(1),
        }),
        z.object({
          mode: z.literal("beta"),
          tags: z.array(z.string().min(1)).min(1),
        }),
      ])
      .optional(),
    async ({ workItem }) => {
      await workItem.start();
    }
  )
  .complete(
    z.object({
      meta: z.record(z.string().min(1), z.union([z.string(), z.number()])),
      items: z.array(
        z.object({
          id: z.string().uuid(),
          flags: z.array(z.boolean()),
        })
      ),
    }),
    async ({ workItem }) => {
      await workItem.complete();
    }
  );

const pathologicalWorkItem = Builder.workItem("pathologicalWorkItem").withActions(
  pathologicalWorkItemActions
);

const anyPayloadWorkItemActions = Builder.workItemActions()
  .start(z.any(), async ({ workItem }) => {
    await workItem.start();
  })
  .complete(z.any(), async ({ workItem }) => {
    await workItem.complete();
  });

const anyPayloadWorkItem = Builder.workItem("anyPayloadWorkItem").withActions(
  anyPayloadWorkItemActions
);

const neverPayloadWorkItemActions = Builder.workItemActions()
  .start(z.never(), async ({ workItem }) => {
    await workItem.start();
  })
  .complete(z.any(), async ({ workItem }) => {
    await workItem.complete();
  });

const neverPayloadWorkItem = Builder.workItem("neverPayloadWorkItem").withActions(
  neverPayloadWorkItemActions
);

const validatorWorkflowActions = Builder.workflowActions()
  .initialize(
    z.object({
      runId: z.string().min(1),
    }),
    async ({ workflow }) => {
      await workflow.initialize();
    }
  )
  .cancel(
    z.object({
      reason: z.string(),
    }),
    async ({ workflow }) => {
      await workflow.cancel();
    }
  );

const validatorWorkflow = Builder.workflow("validatorWorkflow")
  .withActions(validatorWorkflowActions)
  .startCondition("start")
  .task(
    "validate",
    Builder.task(validatorWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .task(
    "pathological",
    Builder.task(pathologicalWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .task(
    "anyPayload",
    Builder.task(anyPayloadWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .task(
    "neverPayload",
    Builder.task(neverPayloadWorkItem).withActivities({
      onEnabled: async ({ workItem }) => {
        await workItem.initialize();
      },
    })
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("validate"))
  .connectTask("validate", (to) => to.task("pathological"))
  .connectTask("pathological", (to) => to.task("anyPayload"))
  .connectTask("anyPayload", (to) => to.task("neverPayload"))
  .connectTask("neverPayload", (to) => to.condition("end"));

export const validatorVersionManager = versionManagerFor("validatorWorkflow")
  .registerVersion("v1", validatorWorkflow)
  .build();
