import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { triagePatientTask } from "../workItems/triagePatient.workItem";
import { performSurgeryTask } from "../workItems/performSurgery.workItem";
import { reviewDiagnosticsTask } from "../workItems/reviewDiagnostics.workItem";
import {
  cardiologyConsultTask,
  neurologyConsultTask,
} from "../workItems/specialistConsult.workItem";
import { administerMedicationTask } from "../workItems/administerMedication.workItem";
import { diagnosticsWorkflow } from "./diagnostics.workflow";
import { hospitalStayWorkflow } from "./hospitalStay.workflow";
import { createPatientAdmission } from "../application/erApplication";
import type { AvailableRoutes } from "@repo/tasquencer";
import {
  getPatientByWorkflowId,
  getDiagnosticsByPatientId,
  getLatestDiagnosticReviewForPatient,
  listSpecialistConsultationsForPatient,
} from "../db";
import {
  assertDiagnosticReviewExists,
  assertDiagnosticsExists,
  assertPatientExists,
} from "../exceptions";
import { decideDiagnosticRoute } from "../domain/services/diagnosticRoutingService";
import { determineRequiredConsultations } from "../domain/services/consultationDecisionService";
import {
  markPatientReadyForDischarge,
  markPatientDischarged,
} from "../domain/services/statusTransitionService";
import { assertUserHasScope } from "../../../authorization";

const dischargeTask = Builder.dummyTask().withActivities({
  onEnabled: async ({ mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertPatientExists(patient, parent.workflow.id);

    await markPatientReadyForDischarge(
      mutationCtx.db,
      patient._id,
      parent.workflow.id
    );
  },
  onCompleted: async ({ mutationCtx, parent }) => {
    const patient = await getPatientByWorkflowId(
      mutationCtx.db,
      parent.workflow.id
    );
    assertPatientExists(patient, parent.workflow.id);

    await markPatientDischarged(
      mutationCtx.db,
      patient._id,
      parent.workflow.id
    );
  },
});

const erWorkflowActions = Builder.workflowActions().initialize(
  z.object({
    name: z.string(),
    complaint: z.string(),
  }),
  async ({ mutationCtx, workflow }, payload) => {
    // Check if user has ER staff scope
    await assertUserHasScope(mutationCtx, "er:staff");

    const workflowId = await workflow.initialize();

    await createPatientAdmission(mutationCtx.db, workflowId, {
      name: payload.name,
      complaint: payload.complaint,
    });
  }
);

export const erPatientJourneyWorkflow = Builder.workflow("erPatientJourney")
  .withActions(erWorkflowActions)
  .startCondition("start")
  .task("triage", triagePatientTask)
  .compositeTask(
    "diagnostics",
    Builder.compositeTask(diagnosticsWorkflow)
      .withSplitType("xor")
      .withActivities({
        onEnabled: async ({ workflow, mutationCtx, parent }) => {
          const patient = await getPatientByWorkflowId(
            mutationCtx.db,
            parent.workflow.id
          );
          assertPatientExists(patient, parent.workflow.id);
          await workflow.initialize({ patientId: patient._id });
        },
      })
  )
  .task("performSurgery", performSurgeryTask)
  .compositeTask(
    "hospitalStay",
    Builder.compositeTask(hospitalStayWorkflow).withActivities({
      onEnabled: async ({ workflow, mutationCtx, parent }) => {
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertPatientExists(patient, parent.workflow.id);
        await workflow.initialize({ patientId: patient._id });
      },
    })
  )
  .task("reviewDiagnostics", reviewDiagnosticsTask.withSplitType("or"))
  .task("consultCardiologist", cardiologyConsultTask)
  .task("consultNeurologist", neurologyConsultTask)
  // YAWL OR-join: only fires after the selected consult tasks complete, so
  // discharge routing never bypasses outstanding specialists.
  .dummyTask(
    "gatherConsultations",
    Builder.dummyTask().withJoinType("or").withSplitType("xor")
  )
  .task("administerMedication", administerMedicationTask)
  .dummyTask("discharge", dischargeTask.withJoinType("or"))
  .endCondition("end")
  .connectCondition("start", (to) => to.task("triage"))
  .connectTask("triage", (to) => to.task("diagnostics"))
  .connectTask("diagnostics", (to) =>
    to
      .task("performSurgery")
      .task("reviewDiagnostics")
      .route(async ({ mutationCtx, route, parent }) => {
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertPatientExists(patient, parent.workflow.id);

        const diagnosticsRecord = await getDiagnosticsByPatientId(
          mutationCtx.db,
          patient._id,
          { workflowId: parent.workflow.id }
        );
        assertDiagnosticsExists(diagnosticsRecord, parent.workflow.id);

        const decision = decideDiagnosticRoute({
          isCritical: diagnosticsRecord.xrayIsCritical ?? false,
        });

        return decision === "emergency"
          ? route.toTask("performSurgery")
          : route.toTask("reviewDiagnostics");
      })
  )
  .connectTask("performSurgery", (to) => to.task("hospitalStay"))
  .connectTask("hospitalStay", (to) => to.task("discharge"))
  .connectTask("reviewDiagnostics", (to) =>
    to
      .task("consultCardiologist")
      .task("consultNeurologist")
      .task("gatherConsultations")
      .route(async ({ mutationCtx, route, parent }) => {
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertPatientExists(patient, parent.workflow.id);

        const review = await getLatestDiagnosticReviewForPatient(
          mutationCtx.db,
          patient._id,
          { workflowId: parent.workflow.id }
        );
        assertDiagnosticReviewExists(review, patient._id);

        const routes: AvailableRoutes<typeof route>[] = [
          route.toTask("gatherConsultations"),
        ];

        const decisions = determineRequiredConsultations(
          review.consultationsNeeded
        );

        if (decisions.needsCardiologist) {
          routes.push(route.toTask("consultCardiologist"));
        }
        if (decisions.needsNeurologist) {
          routes.push(route.toTask("consultNeurologist"));
        }

        return routes;
      })
  )
  .connectTask("consultCardiologist", (to) => to.task("gatherConsultations"))
  .connectTask("consultNeurologist", (to) => to.task("gatherConsultations"))
  .connectTask("gatherConsultations", (to) =>
    to
      .task("administerMedication")
      .task("discharge")
      .route(async ({ mutationCtx, route, parent }) => {
        const patient = await getPatientByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertPatientExists(patient, parent.workflow.id);

        const review = await getLatestDiagnosticReviewForPatient(
          mutationCtx.db,
          patient._id,
          { workflowId: parent.workflow.id }
        );
        assertDiagnosticReviewExists(review, patient._id);

        let needsMedication = review.prescribeMedication ?? false;

        if (!needsMedication) {
          const consultations = await listSpecialistConsultationsForPatient(
            mutationCtx.db,
            patient._id,
            { workflowId: parent.workflow.id }
          );
          needsMedication = consultations.some(
            (consultation) =>
              consultation.state.status === "completed" &&
              consultation.state.prescribeMedication
          );
        }

        return needsMedication
          ? route.toTask("administerMedication")
          : route.toTask("discharge");
      })
  )
  .connectTask("administerMedication", (to) => to.task("discharge"))
  .connectTask("discharge", (to) => to.condition("end"));
