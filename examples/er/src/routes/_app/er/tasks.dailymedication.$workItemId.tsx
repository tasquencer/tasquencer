import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Pill } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  medicationsAdministered: z
    .string()
    .min(1, "Medications administered are required"),
});

const DailyMedicationTaskComponent = createErTaskComponent({
  workflowTaskName: "administerDailyMedication",
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
        placeholder="e.g., Antibiotics 500mg IV, Pain medication 10mg oral"
        rows={4}
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
  icon: <Pill className="h-8 w-8 text-green-500" />,
  title: "Administer Daily Medication",
  description: "Provide prescribed medications to patient",
  formTitle: "Daily Medication Form",
  formDescription: "Record medications administered to patient",
  submitButtonText: "Complete Medication",
});

export const Route = createFileRoute(
  "/_app/er/tasks/dailymedication/$workItemId"
)({
  component: DailyMedicationTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function DailyMedicationTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <DailyMedicationTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
