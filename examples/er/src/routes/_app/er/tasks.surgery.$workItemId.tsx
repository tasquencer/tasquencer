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
  notes: z.string().min(1, "Surgical notes are required"),
});

const SurgeryTaskComponent = createErTaskComponent({
  workflowTaskName: "performSurgery",
  schema,
  getDefaultValues: () => ({
    notes: "",
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      patientId: patient._id,
      notes: values.notes,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <div className="grid gap-2">
      <Label htmlFor="notes">Surgical Notes</Label>
      <Textarea
        id="notes"
        placeholder="Enter surgical notes..."
        rows={8}
        {...form.register("notes")}
        disabled={!isStarted}
      />
      {form.formState.errors.notes && (
        <p className="text-sm text-destructive">
          {form.formState.errors.notes.message}
        </p>
      )}
    </div>
  ),
  icon: <Activity className="h-8 w-8 text-blue-500" />,
  title: "Emergency Surgery",
  description: "Document surgical procedure and outcomes",
  formTitle: "Surgery Documentation",
  formDescription: "Document the surgical procedure and outcomes",
  submitButtonText: "Complete Surgery",
});

export const Route = createFileRoute("/_app/er/tasks/surgery/$workItemId")({
  component: SurgeryTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function SurgeryTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <SurgeryTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
