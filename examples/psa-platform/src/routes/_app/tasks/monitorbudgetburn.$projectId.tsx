/**
 * Monitor Budget Burn Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-monitorbudgetburn.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Gauge, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({});

function MonitorBudgetBurnComponentFactory(
  projectId: Id<"projects">,
  budget: {
    totalAmount?: number;
    laborBudget?: number;
    expenseBudget?: number;
  } | null | undefined,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "monitorBudgetBurn",
    schema,
    getDefaultValues: () => ({}),
    mapSubmit: () => ({
      payload: {
        projectId,
      },
    }),
    renderForm: ({ isStarted }) => (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Click "Run Budget Check" to calculate the current budget burn rate
            and check for any warnings or overruns.
          </p>
        </div>

        {budget && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Total Budget</p>
              <p className="text-2xl font-bold">
                ${((budget.totalAmount ?? 0) / 100).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Labor Budget</p>
              <p className="text-2xl font-bold">
                ${((budget.laborBudget ?? 0) / 100).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">Expense Budget</p>
              <p className="text-2xl font-bold">
                ${((budget.expenseBudget ?? 0) / 100).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to run the budget check.
          </p>
        )}
      </div>
    ),
    icon: <Gauge className="h-8 w-8 text-orange-500" />,
    title: "Monitor Budget Burn",
    description: "Calculate budget burn rate and check for warnings",
    formTitle: "Budget Check",
    formDescription:
      "Review current budget status and run the burn rate calculation.",
    submitButtonText: "Run Budget Check",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/monitorbudgetburn/$projectId"
)({
  component: MonitorBudgetBurnTask,
});

function MonitorBudgetBurnTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "monitorBudgetBurn" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Budget check complete</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (project === undefined || workItem === undefined) {
    return <SpinningLoader />;
  }

  if (project === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Project not found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The project you're looking for doesn't exist.
          </p>
        </CardContent>
      </Card>
    );
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

  const Component = MonitorBudgetBurnComponentFactory(
    projectId,
    project?.budget,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
