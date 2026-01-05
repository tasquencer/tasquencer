import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeDischargePreparationTask } from "../application/erApplication";
import { getHospitalStayByWorkflowId } from "../db";
import { assertHospitalStayExists } from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const dischargePolicy = authService.policies.requireScope(
  "er:support:discharge"
);

const prepareForDischargeActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    dischargePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:support:discharge",
        patientId: payload.patientId,
        payload: {
          type: "prepareForDischarge",
          taskName: "Prepare for Discharge",
          priority: "routine",
        },
      });
    }
  )
  .start(z.never(), dischargePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      patientId: zid("erPatients"),
      dischargeInstructions: z.string(),
      followUpRequired: z.boolean(),
    }),
    dischargePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeDischargePreparationTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        dischargeInstructions: payload.dischargeInstructions,
        followUpRequired: payload.followUpRequired,
      });
    }
  );

export const prepareForDischargeWorkItem = Builder.workItem(
  "prepareForDischarge"
)
  .withActions(prepareForDischargeActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const prepareForDischargeTask = Builder.task(
  prepareForDischargeWorkItem
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
