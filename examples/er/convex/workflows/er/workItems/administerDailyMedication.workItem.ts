import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeDailyMedicationTask } from "../application/erApplication";
import { getHospitalStayByWorkflowId } from "../db";
import { assertHospitalStayExists } from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const nursingWritePolicy =
  authService.policies.requireScope("er:nursing:write");

const administerDailyMedicationActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    nursingWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:nursing:write",
        patientId: payload.patientId,
        payload: {
          type: "administerDailyMedication",
          taskName: "Administer Daily Medication",
          priority: "routine",
        },
      });
    }
  )
  .start(z.never(), nursingWritePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      patientId: zid("erPatients"),
      medicationsAdministered: z.string(),
    }),
    nursingWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeDailyMedicationTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        medicationsAdministered: payload.medicationsAdministered,
      });
    }
  );

export const administerDailyMedicationWorkItem = Builder.workItem(
  "administerDailyMedication"
)
  .withActions(administerDailyMedicationActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const administerDailyMedicationTask = Builder.task(
  administerDailyMedicationWorkItem
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
