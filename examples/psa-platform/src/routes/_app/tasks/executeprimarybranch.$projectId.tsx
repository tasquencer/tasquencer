/**
 * Execute Primary Branch Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-executeprimarybranch.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { ArrowRight, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  branchResult: z.string().optional(),
});

function ExecutePrimaryBranchComponentFactory(
  projectId: Id<"projects">,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "executePrimaryBranch",
    schema,
    getDefaultValues: () => ({
      branchResult: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        branchResult: values.branchResult || undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4">
          <div className="flex items-start gap-3">
            <ArrowRight className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-green-800 dark:text-green-200">
                Primary Branch Execution
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                You are executing the primary (standard) workflow branch. This
                path represents the normal flow of execution.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Complete this task to finish the primary branch execution. You can
            optionally add notes about the branch result.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="branchResult">Branch Result Notes (optional)</Label>
          <Textarea
            id="branchResult"
            placeholder="Document any results or observations from this branch..."
            {...form.register("branchResult")}
            disabled={!isStarted}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Record any relevant information about what was accomplished in this
            branch.
          </p>
        </div>

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to complete the primary branch.
          </p>
        )}
      </div>
    ),
    icon: <ArrowRight className="h-8 w-8 text-green-500" />,
    title: "Execute Primary Branch",
    description: "Complete the primary execution branch",
    formTitle: "Primary Branch",
    formDescription:
      "Execute and complete the primary workflow branch.",
    submitButtonText: "Complete Primary Branch",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/executeprimarybranch/$projectId"
)({
  component: ExecutePrimaryBranchTask,
});

function ExecutePrimaryBranchTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "executePrimaryBranch" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Branch completed</h3>
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

  const Component = ExecutePrimaryBranchComponentFactory(projectId, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
