/**
 * Sync Parallel Tasks Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-syncparalleltasks.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import {
  GitMerge,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  Circle,
} from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { Progress } from "@repo/ui/components/progress";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({});

function SyncParallelTasksComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  onRedirectStart?: () => void
) {
  // Calculate task statistics
  const todoCount = tasks.filter((t) => t.status === "Todo").length;
  const inProgressCount = tasks.filter((t) => t.status === "InProgress").length;
  const doneCount = tasks.filter((t) => t.status === "Done").length;
  const totalCount = tasks.length;

  const completionPercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const hasMoreWork = todoCount > 0 || inProgressCount > 0;

  return createPsaTaskComponent({
    workflowTaskName: "syncParallelTasks",
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
            Synchronize the parallel task batch and determine if more work
            remains. This task summarizes the current state and decides whether
            to continue or complete the parallel execution.
          </p>
        </div>

        {/* Progress Overview */}
        <div className="rounded-lg border p-4 space-y-3">
          <h4 className="font-medium">Batch Progress</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Completion</span>
              <span className="font-medium">{completionPercent}%</span>
            </div>
            <Progress value={completionPercent} className="h-2" />
          </div>
        </div>

        {/* Task Counts */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Circle className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-muted-foreground">Todo</span>
            </div>
            <p className="text-2xl font-bold">{todoCount}</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">In Progress</span>
            </div>
            <p className="text-2xl font-bold">{inProgressCount}</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Done</span>
            </div>
            <p className="text-2xl font-bold">{doneCount}</p>
          </div>
        </div>

        {/* Status Summary */}
        {hasMoreWork ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 p-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-800 dark:text-blue-200">
                  Work Remaining
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {todoCount + inProgressCount} task
                  {todoCount + inProgressCount !== 1 ? "s" : ""} still need to be
                  completed. The batch will continue after sync.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-800 dark:text-green-200">
                  All Tasks Complete
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  All tasks in the parallel batch have been completed. The
                  workflow will proceed to the next phase.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Task List */}
        {tasks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Task Status</h4>
            <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
              {tasks.map((task) => (
                <div
                  key={task._id}
                  className="p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    {task.status === "Done" ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : task.status === "InProgress" ? (
                      <Clock className="h-4 w-4 text-blue-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-400" />
                    )}
                    <span
                      className={
                        task.status === "Done" ? "text-muted-foreground" : ""
                      }
                    >
                      {task.name}
                    </span>
                  </div>
                  <Badge
                    variant={
                      task.status === "Done"
                        ? "default"
                        : task.status === "InProgress"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-xs"
                  >
                    {task.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isStarted && (
          <p className="text-sm text-muted-foreground">
            Claim this task to sync the parallel batch.
          </p>
        )}
      </div>
    ),
    icon: <GitMerge className="h-8 w-8 text-purple-500" />,
    title: "Sync Parallel Tasks",
    description: "Synchronize parallel batch and check remaining work",
    formTitle: "Batch Sync",
    formDescription:
      "Review the current state of the parallel batch and sync progress.",
    submitButtonText: "Sync",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/syncparalleltasks/$projectId"
)({
  component: SyncParallelTasksTask,
});

function SyncParallelTasksTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "syncParallelTasks" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Batch synced</h3>
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

  const Component = SyncParallelTasksComponentFactory(projectId, tasks, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
