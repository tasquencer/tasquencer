import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeBloodWorkTask } from "../application/erApplication";
import { getDiagnosticsByWorkflowId } from "../db";
import { assertDiagnosticsExists } from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const labPolicy = authService.policies.requireScope("er:diagnostics:lab");

const analyzeBloodSampleActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    labPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:diagnostics:lab",
        patientId: payload.patientId,
        payload: {
          type: "analyzeBloodSample",
          taskName: "Analyze Blood Sample",
          priority: "routine",
        },
      });
    }
  )
  .start(z.never(), labPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      results: z.string(),
    }),
    labPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeBloodWorkTask(mutationCtx.db, {
        workItemId: workItem.id,
        results: payload.results,
      });
    }
  );

export const analyzeBloodSampleWorkItem = Builder.workItem("analyzeBloodSample")
  .withActions(analyzeBloodSampleActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const analyzeBloodSampleTask = Builder.task(
  analyzeBloodSampleWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const diagnostics = await getDiagnosticsByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertDiagnosticsExists(diagnostics, parent.workflow.id);

    await workItem.initialize({ patientId: diagnostics.patientId });
  },
});
