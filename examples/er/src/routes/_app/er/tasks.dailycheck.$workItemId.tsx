import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Stethoscope } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const decisionSchema = z
  .enum(["readyForDischarge", "needsMedication"])
  .optional();

const schema = z.object({
  vitalSigns: z.string().min(1, "Vital signs are required"),
  decision: decisionSchema,
});

const DailyCheckTaskComponent = createErTaskComponent({
  workflowTaskName: "performDailyCheck",
  schema,
  getDefaultValues: () => ({
    vitalSigns: "",
    decision: undefined,
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      patientId: patient._id,
      vitalSigns: values.vitalSigns,
      decision: values.decision,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="grid gap-2">
        <Label htmlFor="vitalSigns">Vital Signs & Assessment</Label>
        <Textarea
          id="vitalSigns"
          placeholder="BP: 120/80, HR: 72, Temp: 98.6°F, RR: 16, SpO2: 98%, Pain level, mobility, etc."
          rows={4}
          {...form.register("vitalSigns")}
          disabled={!isStarted}
        />
        {form.formState.errors.vitalSigns && (
          <p className="text-sm text-destructive">
            {form.formState.errors.vitalSigns.message}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="needsMedication"
          checked={form.watch("decision") === "needsMedication"}
          onCheckedChange={(checked) => {
            form.setValue(
              "decision",
              checked === true ? "needsMedication" : undefined
            );
          }}
          disabled={!isStarted}
        />
        <Label
          htmlFor="needsMedication"
          className="text-sm font-normal cursor-pointer"
        >
          Patient needs medication
        </Label>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="readyForDischarge"
          checked={form.watch("decision") === "readyForDischarge"}
          onCheckedChange={(checked) => {
            form.setValue(
              "decision",
              checked === true ? "readyForDischarge" : undefined
            );
          }}
          disabled={!isStarted}
        />
        <Label
          htmlFor="readyForDischarge"
          className="text-sm font-normal cursor-pointer"
        >
          Patient is ready for discharge
        </Label>
      </div>
    </>
  ),
  icon: <Stethoscope className="h-8 w-8 text-blue-500" />,
  title: "Daily Patient Check",
  description: "Perform daily patient assessment",
  formTitle: "Daily Check Form",
  formDescription: "Assess patient condition and determine next steps",
  submitButtonText: "Complete Check",
});

export const Route = createFileRoute("/_app/er/tasks/dailycheck/$workItemId")({
  component: DailyCheckTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function DailyCheckTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <DailyCheckTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
