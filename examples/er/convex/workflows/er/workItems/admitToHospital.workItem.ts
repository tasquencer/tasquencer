import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeHospitalAdmissionTask } from "../application/erApplication";
import { getHospitalStayByWorkflowId } from "../db";
import { assertHospitalStayExists } from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const admissionsPolicy = authService.policies.requireScope(
  "er:support:admission"
);

const admitToHospitalActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    admissionsPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:support:admission",
        patientId: payload.patientId,
        payload: {
          type: "admitToHospital",
          taskName: "Admit to Hospital",
          priority: "routine",
        },
      });
    }
  )
  .start(z.never(), admissionsPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      patientId: zid("erPatients"),
      roomNumber: z.string(),
      ward: z.string(),
    }),
    admissionsPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeHospitalAdmissionTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        roomNumber: payload.roomNumber,
        ward: payload.ward,
      });
    }
  );

export const admitToHospitalWorkItem = Builder.workItem("admitToHospital")
  .withActions(admitToHospitalActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const admitToHospitalTask = Builder.task(
  admitToHospitalWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const hospitalStay = await getHospitalStayByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertHospitalStayExists(hospitalStay, parent.workflow.id);

    await workItem.initialize({ patientId: hospitalStay.patientId });
  },
});
