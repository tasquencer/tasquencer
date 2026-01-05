import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeMedicationTask } from "../application/erApplication";
import {
  startAndClaimWorkItem,
  cleanupErWorkItemOnCancel,
  transitionPatientStatusForWorkItem,
} from "./helpers";
import { authService } from "../../../authorization";
import {
  initializeErWorkItemAuth,
  initializeWorkItemWithPatientAuth,
} from "./helpersAuth";

const nursingWritePolicy =
  authService.policies.requireScope("er:nursing:write");

const administerMedicationActions = authService.builders.workItemActions
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
          type: "administerMedication",
          taskName: "Administer Medication",
          priority: "routine",
        },
      });

      await transitionPatientStatusForWorkItem(
        mutationCtx,
        workItemId,
        "treatment"
      );
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
      await completeMedicationTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        medicationsAdministered: payload.medicationsAdministered,
      });
    }
  );

export const administerMedicationWorkItem = Builder.workItem(
  "administerMedication"
)
  .withActions(administerMedicationActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const administerMedicationTask = Builder.task(
  administerMedicationWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithPatientAuth(
      mutationCtx,
      parent.workflow,
      workItem
    );
  },
});
