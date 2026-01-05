import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { FileSearch, Heart, Brain, Activity } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";
import type { SpecialtyType } from "@/convex/workflows/er/domain/services/consultationDecisionService";

const schema = z.object({
  treatmentPlan: z.string().min(1, "Treatment plan is required"),
  needsCardiology: z.boolean(),
  needsNeurology: z.boolean(),
  prescribeMedication: z.boolean(),
});

const ReviewTaskComponent = createErTaskComponent({
  workflowTaskName: "reviewDiagnostics",
  schema,
  getDefaultValues: () => ({
    treatmentPlan: "",
    needsCardiology: false,
    needsNeurology: false,
    prescribeMedication: false,
  }),
  mapSubmit: ({ values, patient }) => {
    const consultationsNeeded: SpecialtyType[] = [];
    if (values.needsCardiology) consultationsNeeded.push("cardiologist");
    if (values.needsNeurology) consultationsNeeded.push("neurologist");

    return {
      payload: {
        patientId: patient._id,
        consultationsNeeded,
        treatmentPlan: values.treatmentPlan,
        prescribeMedication: values.prescribeMedication,
      },
    };
  },
  renderForm: ({ form, isStarted }) => {
    const consultations: SpecialtyType[] = [];
    if (form.watch("needsCardiology")) consultations.push("cardiologist");
    if (form.watch("needsNeurology")) consultations.push("neurologist");

    return (
      <>
        <div className="grid gap-2">
          <Label htmlFor="treatmentPlan">Treatment Plan</Label>
          <Textarea
            id="treatmentPlan"
            placeholder="Document diagnosis, recommended treatment, and follow-up care..."
            rows={6}
            {...form.register("treatmentPlan")}
            disabled={!isStarted}
          />
          {form.formState.errors.treatmentPlan && (
            <p className="text-sm text-destructive">
              {form.formState.errors.treatmentPlan.message}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Label>Specialist Consultations Required</Label>
          <div className="space-y-3">
            <div className="flex items-start space-x-3 p-4 border rounded-lg">
              <Checkbox
                id="cardiology"
                checked={form.watch("needsCardiology")}
                onCheckedChange={(checked) =>
                  form.setValue("needsCardiology", checked === true)
                }
                disabled={!isStarted}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="cardiology"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <Heart className="h-4 w-4 text-red-500" />
                  Cardiology Consultation
                </label>
                <p className="text-sm text-muted-foreground">
                  Request evaluation by cardiologist for heart-related concerns
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 border rounded-lg">
              <Checkbox
                id="neurology"
                checked={form.watch("needsNeurology")}
                onCheckedChange={(checked) =>
                  form.setValue("needsNeurology", checked === true)
                }
                disabled={!isStarted}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="neurology"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <Brain className="h-4 w-4 text-purple-500" />
                  Neurology Consultation
                </label>
                <p className="text-sm text-muted-foreground">
                  Request evaluation by neurologist for neurological symptoms
                </p>
              </div>
            </div>
          </div>
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

        {consultations.length > 0 && (
          <div className="p-4 bg-blue-50/10 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Activity className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-blue-600 mb-1">
                  Consultation Request
                </div>
                <div className="text-muted-foreground">
                  Selected specialists: {consultations.join(", ")}. We’ll notify
                  those teams and surface results here once they publish
                  recommendations.
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  },
  icon: <FileSearch className="h-8 w-8 text-indigo-500" />,
  title: "Diagnostic Review",
  description: "Evaluate test results and determine treatment plan",
  formTitle: "Doctor Review Form",
  formDescription:
    "Document treatment plan and request specialist consultations",
  submitButtonText: "Submit Review",
});

export const Route = createFileRoute("/_app/er/tasks/review/$workItemId")({
  component: ReviewTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function ReviewTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <ReviewTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
