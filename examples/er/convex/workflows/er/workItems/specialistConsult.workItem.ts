import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { completeConsultTask } from "../application/erApplication";
import {
  getPatientByWorkflowId,
  getWorkflowIdsForWorkItem,
  createPendingSpecialistConsultation,
  getSpecialistConsultationByWorkItemId,
} from "../db";
import {
  assertPatientExists,
  assertSpecialistConsultationExists,
} from "../exceptions";
import { startAndClaimWorkItem, cleanupErWorkItemOnCancel } from "./helpers";
import { authService } from "../../../authorization";
import { initializeErWorkItemAuth } from "./helpersAuth";

const SpecialtyContextSchema = z.object({
  specialty: z.enum(["cardiologist", "neurologist"]),
});

const specialistConsultPolicy = authService.policies.requireScope(
  "er:specialist:consult"
);

const specialistConsultActions = authService.builders.workItemActions
  .initialize(
    z.object({
      patientId: zid("erPatients"),
      specialty: z.enum(["cardiologist", "neurologist"]),
    }),
    specialistConsultPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      await initializeErWorkItemAuth(mutationCtx, workItemId, {
        scope: "er:specialist:consult",
        patientId: payload.patientId,
        payload: {
          type: "specialistConsult",
          taskName: `Specialist Consultation (${payload.specialty})`,
          priority: "urgent",
          specialty: payload.specialty,
        },
      });

      const { workflowId, rootWorkflowId } = await getWorkflowIdsForWorkItem(
        mutationCtx.db,
        workItemId
      );

      await createPendingSpecialistConsultation(mutationCtx.db, {
        patientId: payload.patientId,
        workflowId,
        rootWorkflowId,
        workItemId,
        specialty: payload.specialty,
      });
    }
  )
  .start(
    z.never(),
    specialistConsultPolicy,
    async ({ mutationCtx, workItem }) => {
      await startAndClaimWorkItem(mutationCtx, workItem);
    }
  )
  .complete(
    z.object({
      recommendations: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      prescribeMedication: z.boolean().optional(),
    }),
    specialistConsultPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const consultation = await getSpecialistConsultationByWorkItemId(
        mutationCtx.db,
        workItem.id
      );
      assertSpecialistConsultationExists(consultation, {
        workItemId: workItem.id,
      });
      SpecialtyContextSchema.parse({
        specialty: consultation.specialty,
      });

      await completeConsultTask(mutationCtx.db, {
        workItemId: workItem.id,
        recommendations: payload.recommendations,
        prescribeMedication: payload.prescribeMedication,
        title: payload.title,
        description: payload.description,
      });
    }
  );

export const specialistConsultWorkItem = Builder.workItem("specialistConsult")
  .withActions(specialistConsultActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupErWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

export const cardiologyConsultTask = Builder.task(
  specialistConsultWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );

    assertPatientExists(patient, parent.workflow.id);

    await workItem.initialize({
      patientId: patient._id,
      specialty: "cardiologist",
    });
  },
});

export const neurologyConsultTask = Builder.task(
  specialistConsultWorkItem
).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );

    assertPatientExists(patient, parent.workflow.id);

    await workItem.initialize({
      patientId: patient._id,
      specialty: "neurologist",
    });
  },
});
