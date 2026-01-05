import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { admitToHospitalTask } from "../workItems/admitToHospital.workItem";
import { performDailyCheckTask } from "../workItems/performDailyCheck.workItem";
import { administerDailyMedicationTask } from "../workItems/administerDailyMedication.workItem";
import { prepareForDischargeTask } from "../workItems/prepareForDischarge.workItem";
import {
  insertHospitalStay,
  getHospitalStayByWorkflowId,
  getLatestDailyCheckAssessment,
} from "../db";
import { assertHospitalStayExists } from "../exceptions";
import { helpers } from "../../../tasquencer";

const hospitalStayWorkflowActions = Builder.workflowActions().initialize(
  z.object({
    patientId: zid("erPatients"),
  }),
  async ({ mutationCtx, workflow }, payload) => {
    const workflowId = await workflow.initialize();

    const rootWorkflowId = await helpers.getRootWorkflowId(
      mutationCtx.db,
      workflowId
    );

    await insertHospitalStay(mutationCtx.db, {
      patientId: payload.patientId,
      workflowId,
      rootWorkflowId,
      status: "pending",
    });
  }
);

export const hospitalStayWorkflow = Builder.workflow("hospitalStay")
  .withActions(hospitalStayWorkflowActions)
  .startCondition("start")
  .task("admitToHospital", admitToHospitalTask)
  .task(
    "performDailyCheck",
    performDailyCheckTask.withJoinType("xor").withSplitType("xor")
  )
  .task("administerDailyMedication", administerDailyMedicationTask)
  .dummyTask("continueObservation", Builder.dummyTask())
  .task("prepareForDischarge", prepareForDischargeTask)
  .endCondition("end")
  .connectCondition("start", (to) => to.task("admitToHospital"))
  .connectTask("admitToHospital", (to) => to.task("performDailyCheck"))
  .connectTask("performDailyCheck", (to) =>
    to
      .task("administerDailyMedication")
      .task("prepareForDischarge")
      .task("continueObservation")
      .route(async ({ mutationCtx, route, parent }) => {
        const hospitalStay = await getHospitalStayByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertHospitalStayExists(hospitalStay, parent.workflow.id);

        const latestAssessment = await getLatestDailyCheckAssessment(
          mutationCtx.db,
          parent.workflow.id
        );

        const decision = latestAssessment?.decision;

        if (decision === "readyForDischarge") {
          return route.toTask("prepareForDischarge");
        }

        if (decision === "needsMedication") {
          return route.toTask("administerDailyMedication");
        }

        return route.toTask("continueObservation");
      })
  )
  .connectTask("administerDailyMedication", (to) =>
    to.task("performDailyCheck")
  )
  .connectTask("continueObservation", (to) => to.task("performDailyCheck"))
  .connectTask("prepareForDischarge", (to) => to.condition("end"));
