import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeSurgeryTask } from "../application/erApplication";
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

const surgeryPolicy = authService.policies.requireScope(
  "er:specialist:surgery"
);

const performSurgeryActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    surgeryPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:specialist:surgery",
        patientId: payload.patientId,
        payload: {
          type: "performSurgery",
          taskName: "Perform Emergency Surgery",
          priority: "critical",
        },
      });

      await transitionPatientStatusForWorkItem(
        mutationCtx,
        workItemId,
        "emergency_surgery"
      );
    }
  )
  .start(z.never(), surgeryPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      patientId: zid("erPatients"),
      notes: z.string(),
    }),
    surgeryPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeSurgeryTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        notes: payload.notes,
      });
    }
  );

export const performSurgeryWorkItem = Builder.workItem("performSurgery")
  .withActions(performSurgeryActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const performSurgeryTask = Builder.task(
  performSurgeryWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithPatientAuth(
      mutationCtx,
      parent.workflow,
      workItem
    );
  },
});
