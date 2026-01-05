import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { ClipboardList } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  severity: z.enum(["routine", "urgent", "critical"]),
  vitalSigns: z.string().min(1, "Vital signs are required"),
});

const TriageTaskComponent = createErTaskComponent({
  workflowTaskName: "triagePatient",
  schema,
  getDefaultValues: () => ({
    severity: "urgent" as const,
    vitalSigns: "",
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      severity: values.severity,
      vitalSigns: values.vitalSigns,
      patientId: patient._id,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="grid gap-2">
        <Label htmlFor="severity">Severity Level</Label>
        <Select
          value={form.watch("severity")}
          onValueChange={(v) =>
            form.setValue("severity", v as "routine" | "urgent" | "critical")
          }
          disabled={!isStarted}
        >
          <SelectTrigger id="severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="routine">Routine - Non-urgent</SelectItem>
            <SelectItem value="urgent">Urgent - Needs attention</SelectItem>
            <SelectItem value="critical">
              Critical - Life threatening
            </SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.severity && (
          <p className="text-sm text-destructive">
            {form.formState.errors.severity.message}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="vitalSigns">Vital Signs & Notes</Label>
        <Textarea
          id="vitalSigns"
          placeholder="BP: 120/80, HR: 72, Temp: 98.6°F, RR: 16, SpO2: 98%"
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
    </>
  ),
  icon: <ClipboardList className="h-8 w-8 text-blue-500" />,
  title: "Triage Assessment",
  description: "Initial patient evaluation and priority assignment",
  formTitle: "Triage Assessment Form",
  formDescription: "Complete patient evaluation and assign priority level",
  submitButtonText: "Complete Triage",
});

export const Route = createFileRoute("/_app/er/tasks/triage/$workItemId")({
  component: TriageTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function TriageTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <TriageTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
