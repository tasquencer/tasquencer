/**
 * Get Next Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-getnexttask.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { ListOrdered, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({});

function GetNextTaskComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  onRedirectStart?: () => void
) {
  // Get Todo tasks sorted by sortOrder
  const todoTasks = tasks
    .filter((t) => t.status === "Todo")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const nextTask = todoTasks[0];

  return createPsaTaskComponent({
    workflowTaskName: "getNextTask",
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
            This task identifies the next task in the sequential execution queue.
            Click "Pick Next Task" to select the next task for execution.
          </p>
        </div>

        {nextTask ? (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-800 dark:text-green-200">
                  Next Task Ready
                </h4>
                <p className="text-lg font-semibold mt-1">{nextTask.name}</p>
                {nextTask.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {nextTask.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline">
                    Priority: {nextTask.priority ?? "Medium"}
                  </Badge>
                  {nextTask.estimatedHours && (
                    <Badge variant="secondary">
                      Est: {nextTask.estimatedHours}h
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No Todo tasks remaining in the queue.
            </p>
          </div>
        )}

        {todoTasks.length > 1 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Task Queue ({todoTasks.length} remaining)</h4>
            <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
              {todoTasks.map((task, index) => (
                <div
                  key={task._id}
                  className={`p-3 flex items-center justify-between ${
                    index === 0 ? "bg-green-50 dark:bg-green-900/20" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-6">
                      #{index + 1}
                    </span>
                    <span className={index === 0 ? "font-medium" : ""}>
                      {task.name}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {task.priority ?? "Medium"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to pick the next task for execution.
          </p>
        )}
      </div>
    ),
    icon: <ListOrdered className="h-8 w-8 text-blue-500" />,
    title: "Get Next Task",
    description: "Identify the next task in the sequential execution queue",
    formTitle: "Task Queue",
    formDescription:
      "Review the task queue and pick the next task for execution.",
    submitButtonText: "Pick Next Task",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute("/_app/tasks/getnexttask/$projectId")({
  component: GetNextTaskTask,
});

function GetNextTaskTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "getNextTask" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Task selected</h3>
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

  const Component = GetNextTaskComponentFactory(projectId, tasks, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
