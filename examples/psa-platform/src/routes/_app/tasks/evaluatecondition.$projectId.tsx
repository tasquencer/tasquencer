/**
 * Evaluate Condition Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-evaluatecondition.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { GitBranch, Loader2, AlertTriangle, ArrowRight, ArrowRightLeft } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  conditionResult: z.enum(["true", "false"]),
  conditionNotes: z.string().optional(),
});

function EvaluateConditionComponentFactory(
  projectId: Id<"projects">,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "evaluateCondition",
    schema,
    getDefaultValues: () => ({
      conditionResult: "true" as const,
      conditionNotes: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        conditionResult: values.conditionResult === "true",
        conditionNotes: values.conditionNotes || undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => {
      const isPrimary = form.watch("conditionResult") === "true";

      return (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Evaluate a condition to determine which branch of the workflow to
              execute. Choose the primary branch for the standard path, or the
              alternate branch for an alternative execution path.
            </p>
          </div>

          {/* Branch Selection */}
          <div className="space-y-3">
            <Label>Select Branch *</Label>
            <RadioGroup
              value={form.watch("conditionResult")}
              onValueChange={(v) =>
                form.setValue("conditionResult", v as "true" | "false")
              }
              disabled={!isStarted}
              className="space-y-3"
            >
              <div
                className={`flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                  isPrimary
                    ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                    : "hover:bg-muted/50"
                }`}
              >
                <RadioGroupItem value="true" id="primary" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="h-4 w-4 text-green-600" />
                    <Label htmlFor="primary" className="cursor-pointer font-medium">
                      Primary Branch
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Execute the standard workflow path. This is the default
                    execution branch for normal conditions.
                  </p>
                </div>
              </div>

              <div
                className={`flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                  !isPrimary
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                    : "hover:bg-muted/50"
                }`}
              >
                <RadioGroupItem value="false" id="alternate" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                    <Label htmlFor="alternate" className="cursor-pointer font-medium">
                      Alternate Branch
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Execute the alternative workflow path. Use this when the
                    primary path conditions are not met.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="conditionNotes">Decision Notes (optional)</Label>
            <Textarea
              id="conditionNotes"
              placeholder="Explain the reasoning for this decision..."
              {...form.register("conditionNotes")}
              disabled={!isStarted}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Document the rationale for choosing this branch for audit purposes.
            </p>
          </div>

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to evaluate the condition.
            </p>
          )}
        </div>
      );
    },
    icon: <GitBranch className="h-8 w-8 text-purple-500" />,
    title: "Evaluate Condition",
    description: "Choose the workflow execution branch",
    formTitle: "Branch Decision",
    formDescription:
      "Evaluate the condition and select the appropriate execution path.",
    getSubmitProps: ({ form }) => ({
      text:
        form.watch("conditionResult") === "true"
          ? "Execute Primary"
          : "Execute Alternate",
    }),
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/evaluatecondition/$projectId"
)({
  component: EvaluateConditionTask,
});

function EvaluateConditionTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "evaluateCondition" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Condition evaluated</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (workItem === undefined) {
    return <SpinningLoader />;
  }

  if (workItem === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Task not available</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            This task is not currently available for this project.
          </p>
        </CardContent>
      </Card>
    );
  }

  const Component = EvaluateConditionComponentFactory(projectId, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
