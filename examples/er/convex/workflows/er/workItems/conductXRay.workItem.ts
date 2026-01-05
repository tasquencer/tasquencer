import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeXRayTask } from "../application/erApplication";
import { getDiagnosticsByWorkflowId } from "../db";
import { assertDiagnosticsExists } from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const xrayPolicy = authService.policies.requireScope("er:diagnostics:xray");

const conductXRayActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    xrayPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:diagnostics:xray",
        patientId: payload.patientId,
        payload: {
          type: "conductXRay",
          taskName: "Conduct X-Ray",
          priority: "urgent",
        },
      });
    }
  )
  .start(z.never(), xrayPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      findings: z.string(),
      isCritical: z.boolean(),
    }),
    xrayPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeXRayTask(mutationCtx.db, {
        workItemId: workItem.id,
        findings: payload.findings,
        isCritical: payload.isCritical,
      });
    }
  );

export const conductXRayWorkItem = Builder.workItem("conductXRay")
  .withActions(conductXRayActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const conductXRayTask = Builder.task(conductXRayWorkItem).withActivities(
  {
    onEnabled: async ({ workItem, mutationCtx, parent }) => {
      const diagnostics = await getDiagnosticsByWorkflowId(
        mutationCtx.db,
        parent.workflow.id
      );

      assertDiagnosticsExists(diagnostics, parent.workflow.id);

      await workItem.initialize({ patientId: diagnostics.patientId });
    },
  }
);
