import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeReviewTask } from "../application/erApplication";
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

const physicianWritePolicy =
  authService.policies.requireScope("er:physician:write");

const reviewDiagnosticsActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
    }),
    physicianWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:physician:write",
        patientId: payload.patientId,
        payload: {
          type: "reviewDiagnostics",
          taskName: "Review Diagnostics",
          priority: "urgent",
        },
      });

      await transitionPatientStatusForWorkItem(
        mutationCtx,
        workItemId,
        "review"
      );
    }
  )
  .start(z.never(), physicianWritePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      patientId: zid("erPatients"),
      consultationsNeeded: z.array(z.enum(["cardiologist", "neurologist"])),
      treatmentPlan: z.string(),
      prescribeMedication: z.boolean().optional(),
    }),
    physicianWritePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      await completeReviewTask(mutationCtx.db, {
        workItemId: workItem.id,
        patientId: payload.patientId,
        consultationsNeeded: payload.consultationsNeeded,
        treatmentPlan: payload.treatmentPlan,
        prescribeMedication: payload.prescribeMedication,
      });
    }
  );

export const reviewDiagnosticsWorkItem = Builder.workItem("reviewDiagnostics")
  .withActions(reviewDiagnosticsActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const reviewDiagnosticsTask = Builder.task(
  reviewDiagnosticsWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithPatientAuth(
      mutationCtx,
      parent.workflow,
      workItem
    );
  },
});
