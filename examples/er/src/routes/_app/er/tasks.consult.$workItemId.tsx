import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Activity } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  recommendations: z.string().min(1, "Recommendations are required"),
  prescribeMedication: z.boolean(),
});

const ConsultTaskComponent = createErTaskComponent({
  workflowTaskName: "specialistConsult",
  schema,
  getDefaultValues: () => ({
    recommendations: "",
    prescribeMedication: false,
  }),
  mapSubmit: ({ values }) => ({
    payload: values,
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="grid gap-2">
        <Label htmlFor="recommendations">Recommendations</Label>
        <Textarea
          id="recommendations"
          placeholder="Enter recommendations..."
          rows={8}
          {...form.register("recommendations")}
          disabled={!isStarted}
        />
        {form.formState.errors.recommendations && (
          <p className="text-sm text-destructive">
            {form.formState.errors.recommendations.message}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="prescribeMedication"
          checked={form.watch("prescribeMedication")}
          onCheckedChange={(checked) =>
            form.setValue("prescribeMedication", checked === true)
          }
          disabled={!isStarted}
        />
        <Label
          htmlFor="prescribeMedication"
          className="text-sm font-normal cursor-pointer"
        >
          Prescribe medication
        </Label>
      </div>
    </>
  ),
  icon: <Activity className="h-8 w-8 text-blue-500" />,
  title: ({ task }) => task.taskName,
  description: "Provide specialist evaluation and recommendations",
  formTitle: "Specialist Consultation",
  formDescription: "Provide your specialist evaluation and recommendations",
  submitButtonText: "Complete Consultation",
});

export const Route = createFileRoute("/_app/er/tasks/consult/$workItemId")({
  component: ConsultTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function ConsultTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <ConsultTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
