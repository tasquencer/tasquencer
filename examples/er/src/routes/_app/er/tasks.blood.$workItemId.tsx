import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Microscope } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  results: z.string().min(1, "Results are required"),
});

const BloodWorkTaskComponent = createErTaskComponent({
  workflowTaskName: "analyzeBloodSample",
  schema,
  getDefaultValues: () => ({
    results: "",
  }),
  mapSubmit: ({ values }) => ({
    payload: { results: values.results },
  }),
  renderForm: ({ form, isStarted }) => (
    <div className="grid gap-2">
      <Label htmlFor="results">Laboratory Results</Label>
      <Textarea
        id="results"
        placeholder="CBC, metabolic panel, coagulation studies..."
        rows={8}
        {...form.register("results")}
        disabled={!isStarted}
      />
      {form.formState.errors.results && (
        <p className="text-sm text-destructive">
          {form.formState.errors.results.message}
        </p>
      )}
    </div>
  ),
  icon: <Microscope className="h-8 w-8 text-teal-500" />,
  title: "Blood Work Analysis",
  description: "Record laboratory test results",
  formTitle: "Lab Results Form",
  formDescription: "Document blood work analysis findings",
  submitButtonText: "Submit Results",
});

export const Route = createFileRoute("/_app/er/tasks/blood/$workItemId")({
  component: BloodWorkTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function BloodWorkTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <BloodWorkTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
