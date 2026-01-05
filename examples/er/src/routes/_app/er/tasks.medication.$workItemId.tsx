import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Activity } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  medicationsAdministered: z.string().min(1, "Medications list is required"),
});

const MedicationTaskComponent = createErTaskComponent({
  workflowTaskName: "administerMedication",
  schema,
  getDefaultValues: () => ({
    medicationsAdministered: "",
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      patientId: patient._id,
      medicationsAdministered: values.medicationsAdministered,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <div className="grid gap-2">
      <Label htmlFor="medicationsAdministered">Medications Administered</Label>
      <Textarea
        id="medicationsAdministered"
        placeholder="Enter medications administered..."
        rows={8}
        {...form.register("medicationsAdministered")}
        disabled={!isStarted}
      />
      {form.formState.errors.medicationsAdministered && (
        <p className="text-sm text-destructive">
          {form.formState.errors.medicationsAdministered.message}
        </p>
      )}
    </div>
  ),
  icon: <Activity className="h-8 w-8 text-blue-500" />,
  title: "Administer Medication",
  description: "Record medications administered",
  formTitle: "Medication Administration",
  formDescription: "Record the medications administered to the patient",
  submitButtonText: "Complete Administration",
});

export const Route = createFileRoute("/_app/er/tasks/medication/$workItemId")({
  component: MedicationTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function MedicationTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <MedicationTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
