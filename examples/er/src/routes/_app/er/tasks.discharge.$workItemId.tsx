import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { FileCheck } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  dischargeInstructions: z
    .string()
    .min(1, "Discharge instructions are required"),
  followUpRequired: z.boolean(),
});

const DischargeTaskComponent = createErTaskComponent({
  workflowTaskName: "prepareForDischarge",
  schema,
  getDefaultValues: () => ({
    dischargeInstructions: "",
    followUpRequired: false,
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      patientId: patient._id,
      dischargeInstructions: values.dischargeInstructions,
      followUpRequired: values.followUpRequired,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="grid gap-2">
        <Label htmlFor="dischargeInstructions">Discharge Instructions</Label>
        <Textarea
          id="dischargeInstructions"
          placeholder="Include medications, activity restrictions, wound care, diet, warning signs, etc."
          rows={6}
          {...form.register("dischargeInstructions")}
          disabled={!isStarted}
        />
        {form.formState.errors.dischargeInstructions && (
          <p className="text-sm text-destructive">
            {form.formState.errors.dischargeInstructions.message}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="followUpRequired"
          checked={form.watch("followUpRequired")}
          onCheckedChange={(checked) =>
            form.setValue("followUpRequired", checked === true)
          }
          disabled={!isStarted}
        />
        <Label
          htmlFor="followUpRequired"
          className="text-sm font-normal cursor-pointer"
        >
          Follow-up appointment required
        </Label>
      </div>
    </>
  ),
  icon: <FileCheck className="h-8 w-8 text-purple-500" />,
  title: "Prepare for Discharge",
  description: "Prepare patient discharge paperwork and instructions",
  formTitle: "Discharge Preparation Form",
  formDescription:
    "Provide discharge instructions and schedule follow-up if needed",
  submitButtonText: "Complete Discharge Preparation",
});

export const Route = createFileRoute("/_app/er/tasks/discharge/$workItemId")({
  component: DischargeTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function DischargeTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <DischargeTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
