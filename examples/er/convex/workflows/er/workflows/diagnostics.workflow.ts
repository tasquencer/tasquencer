import { Builder } from "../../../tasquencer";
import { conductXRayTask } from "../workItems/conductXRay.workItem";
import { analyzeBloodSampleTask } from "../workItems/analyzeBloodSample.workItem";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import {
  insertDiagnostics,
  getDiagnosticsByWorkflowId,
  updateDiagnostics,
} from "../db";
import { assertDiagnosticsExists } from "../exceptions";
import { decideDiagnosticRoute } from "../domain/services/diagnosticRoutingService";
import { helpers } from "../../../tasquencer";

const diagnosticsWorkflowActions = Builder.workflowActions().initialize(
  z.object({
    patientId: zid("erPatients"),
  }),
  async ({ mutationCtx, workflow }, payload) => {
    const workflowId = await workflow.initialize();

    const rootWorkflowId = await helpers.getRootWorkflowId(
      mutationCtx.db,
      workflowId
    );

    await insertDiagnostics(mutationCtx.db, {
      patientId: payload.patientId,
      workflowId,
      rootWorkflowId,
      status: "pending",
    });
  }
);

export const diagnosticsWorkflow = Builder.workflow("diagnostics")
  .withActions(diagnosticsWorkflowActions)
  .startCondition("start")
  .dummyTask("initiateDiagnostics", Builder.dummyTask().withSplitType("and"))
  .task("conductXRay", conductXRayTask.withSplitType("xor"))
  .task("analyzeBloodSample", analyzeBloodSampleTask)

  .dummyTask("emergencySurgeryTrigger", Builder.dummyTask())
  // YAWL OR-join: waits for the set of branches actually activated, so the
  // stable path only completes once X-ray or its cancellation finishes.
  .dummyTask(
    "stableDiagnosticsComplete",
    Builder.dummyTask().withJoinType("and")
  )
  .endCondition("end")
  .connectCondition("start", (to) => to.task("initiateDiagnostics"))
  .connectTask("initiateDiagnostics", (to) =>
    to.task("conductXRay").task("analyzeBloodSample")
  )
  .connectTask("conductXRay", (to) =>
    to
      .task("emergencySurgeryTrigger")
      .task("stableDiagnosticsComplete")
      .route(async ({ mutationCtx, route, parent }) => {
        const diagnostics = await getDiagnosticsByWorkflowId(
          mutationCtx.db,
          parent.workflow.id
        );
        assertDiagnosticsExists(diagnostics, parent.workflow.id);

        const decision = decideDiagnosticRoute({
          isCritical: diagnostics.xrayIsCritical ?? false,
        });

        return decision === "emergency"
          ? route.toTask("emergencySurgeryTrigger")
          : route.toTask("stableDiagnosticsComplete");
      })
  )
  .connectTask("analyzeBloodSample", (to) =>
    to.task("stableDiagnosticsComplete")
  )
  .connectTask("stableDiagnosticsComplete", (to) => to.condition("end"))
  .connectTask("emergencySurgeryTrigger", (to) => to.condition("end"))

  .withCancellationRegion("emergencySurgeryTrigger", (cr) =>
    cr
      .condition("initiateDiagnostics__to__analyzeBloodSample")
      .task("analyzeBloodSample")
  )
  .withActivities({
    onCompleted: async ({ mutationCtx, workflow }) => {
      const diagnostics = await getDiagnosticsByWorkflowId(
        mutationCtx.db,
        workflow.id
      );

      if (diagnostics && diagnostics.status !== "completed") {
        await updateDiagnostics(mutationCtx.db, diagnostics._id, {
          status: "completed",
        });
      }
    },
  });
