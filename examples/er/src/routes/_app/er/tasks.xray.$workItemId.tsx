import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Scan, AlertTriangle, Zap } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  findings: z.string().min(1, "Findings are required"),
  isCritical: z.boolean(),
});

const XRayTaskComponent = createErTaskComponent({
  workflowTaskName: "conductXRay",
  schema,
  getDefaultValues: () => ({
    findings: "",
    isCritical: false,
  }),
  mapSubmit: ({ values }) => ({
    payload: {
      findings: values.findings,
      isCritical: values.isCritical,
    },
  }),
  getSubmitProps: ({ form }) => {
    const isCritical = form.watch("isCritical");
    return {
      text: isCritical ? "Submit Critical Result" : "Submit Results",
      variant: isCritical ? "destructive" : "default",
    };
  },
  renderForm: ({ form, isStarted }) => {
    const isCritical = form.watch("isCritical");
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="findings" className="text-sm font-medium">
            Radiological Findings
          </Label>
          <Textarea
            id="findings"
            placeholder="Describe X-ray findings in detail..."
            rows={6}
            {...form.register("findings")}
            disabled={!isStarted}
            className="resize-none"
          />
          {form.formState.errors.findings && (
            <p className="text-sm text-destructive">
              {form.formState.errors.findings.message}
            </p>
          )}
        </div>

        <div
          className={`flex items-start gap-3 p-4 border rounded-xl transition-colors ${
            isCritical
              ? "border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/5"
              : "border-border bg-muted/30"
          }`}
        >
          <Checkbox
            id="critical"
            checked={isCritical}
            onCheckedChange={(checked) =>
              form.setValue("isCritical", checked === true)
            }
            disabled={!isStarted}
            className="mt-0.5"
          />
          <div className="space-y-1.5">
            <label
              htmlFor="critical"
              className="text-sm font-medium leading-none flex items-center gap-2 cursor-pointer"
            >
              <AlertTriangle
                className={`h-4 w-4 ${isCritical ? "text-amber-500" : "text-muted-foreground"}`}
              />
              Critical Finding Detected (Rupture/Emergency)
            </label>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Check this box if imaging shows critical abnormalities requiring
              immediate surgical intervention. This will automatically cancel
              blood work and fast-track the patient to emergency surgery.
            </p>
          </div>
        </div>

        {isCritical && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl dark:bg-red-500/5">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/20">
                <Zap className="h-4 w-4 text-red-500" />
              </div>
              <div className="space-y-2">
                <div className="font-semibold text-red-600 dark:text-red-400">
                  Emergency Protocol Activated
                </div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  Completing this form with critical finding will trigger:
                </div>
                <ul className="text-sm text-muted-foreground space-y-1 ml-1">
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500/60" />
                    Automatic cancellation of blood work (if still pending)
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500/60" />
                    XOR-split routing to emergency surgery path
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500/60" />
                    High-priority notification to surgical team
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
  icon: <Scan className="h-7 w-7 text-purple-500" />,
  title: "X-Ray Imaging Results",
  description: "Record radiological findings and assessment",
  formTitle: "X-Ray Results Form",
  formDescription: "Document imaging findings and indicate if critical",
});

export const Route = createFileRoute("/_app/er/tasks/xray/$workItemId")({
  component: XRayTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function XRayTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <XRayTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
