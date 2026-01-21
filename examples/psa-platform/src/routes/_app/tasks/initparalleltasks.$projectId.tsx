/**
 * Initialize Parallel Tasks Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-initparalleltasks.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { GitBranch, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({});

function InitParallelTasksComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  onRedirectStart?: () => void
) {
  // Get Todo tasks that can run in parallel (tasks with satisfied dependencies)
  const todoTasks = tasks.filter((t) => t.status === "Todo");

  return createPsaTaskComponent({
    workflowTaskName: "initParallelTasks",
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
            This task identifies tasks that can be executed in parallel. Click
            "Initialize Batch" to prepare the parallel execution batch.
          </p>
        </div>

        {todoTasks.length > 0 ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-4">
            <div className="flex items-start gap-3">
              <GitBranch className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-800 dark:text-blue-200">
                  Parallel Batch Ready
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {todoTasks.length} task{todoTasks.length !== 1 ? "s" : ""} can
                  be executed in parallel.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No Todo tasks available for parallel execution.
            </p>
          </div>
        )}

        {todoTasks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              Tasks for Parallel Execution
            </h4>
            <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
              {todoTasks.map((task) => (
                <div
                  key={task._id}
                  className="p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span>{task.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {task.priority ?? "Medium"}
                    </Badge>
                    {task.estimatedHours && (
                      <Badge variant="secondary" className="text-xs">
                        {task.estimatedHours}h
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to initialize the parallel batch.
          </p>
        )}
      </div>
    ),
    icon: <GitBranch className="h-8 w-8 text-blue-500" />,
    title: "Initialize Parallel Tasks",
    description: "Prepare tasks for parallel execution",
    formTitle: "Parallel Batch",
    formDescription:
      "Review tasks that can run in parallel and initialize the batch.",
    submitButtonText: "Initialize Batch",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/initparalleltasks/$projectId"
)({
  component: InitParallelTasksTask,
});

function InitParallelTasksTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "initParallelTasks" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Batch initialized</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (workItem === undefined || tasks === undefined) {
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

  const Component = InitParallelTasksComponentFactory(projectId, tasks, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
