import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeTriageTask } from "../application/erApplication";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import {
  initializeErWorkItemAuth,
  initializeWorkItemWithPatientAuth,
} from "./helpersAuth";

// Policy: Requires 'er:triage:write' scope
const triageWritePolicy = authService.policies.requireScope("er:triage:write");

const triageWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    triageWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:triage:write",
        patientId: payload.patientId,
        payload: {
          type: "triagePatient",
          taskName: "Triage Patient",
          priority: "urgent",
        },
      });
    }
  )
  .start(z.never(), triageWritePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      severity: z.enum(["routine", "urgent", "critical"]),
      vitalSigns: z.string(),
      patientId: zid("erPatients"),
    }),
    triageWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeTriageTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        severity: payload.severity,
        vitalSigns: payload.vitalSigns,
      });
    }
  )
  .fail(z.any().optional(), triageWritePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

export const triagePatientWorkItem = Builder.workItem("triagePatient")
  .withActions(triageWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const triagePatientTask = Builder.task(
  triagePatientWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithPatientAuth(
      mutationCtx,
      parent.workflow,
      workItem
    );
  },
});
