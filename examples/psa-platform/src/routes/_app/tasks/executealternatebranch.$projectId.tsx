/**
 * Execute Alternate Branch Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-executealternatebranch.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { ArrowRightLeft, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  branchResult: z.string().optional(),
});

function ExecuteAlternateBranchComponentFactory(
  projectId: Id<"projects">,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "executeAlternateBranch",
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <ArrowRightLeft className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-800 dark:text-amber-200">
                Alternate Branch Execution
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                You are executing the alternate workflow branch. This path
                represents an alternative flow when the primary conditions were
                not met.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Complete this task to finish the alternate branch execution. You can
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
            alternate path.
          </p>
        </div>

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to complete the alternate branch.
          </p>
        )}
      </div>
    ),
    icon: <ArrowRightLeft className="h-8 w-8 text-amber-500" />,
    title: "Execute Alternate Branch",
    description: "Complete the alternate execution branch",
    formTitle: "Alternate Branch",
    formDescription:
      "Execute and complete the alternate workflow branch.",
    submitButtonText: "Complete Alternate Branch",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/executealternatebranch/$projectId"
)({
  component: ExecuteAlternateBranchTask,
});

function ExecuteAlternateBranchTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "executeAlternateBranch" }
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

  const Component = ExecuteAlternateBranchComponentFactory(projectId, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
