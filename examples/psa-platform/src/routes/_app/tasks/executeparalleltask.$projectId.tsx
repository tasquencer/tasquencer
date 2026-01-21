/**
 * Execute Parallel Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-executeParalleltask.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Play, Loader2, AlertTriangle, User, Clock } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  taskId: z.string().min(1, "Task selection is required"),
  markAsDone: z.boolean(),
});

function ExecuteParallelTaskComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  users: Doc<"users">[],
  onRedirectStart?: () => void
) {
  // Get Todo and InProgress tasks from the parallel batch
  const eligibleTasks = tasks.filter(
    (t) => t.status === "Todo" || t.status === "InProgress"
  );

  const defaultTask = eligibleTasks[0]?._id ?? "";

  return createPsaTaskComponent({
    workflowTaskName: "executeParallelTask",
    schema,
    getDefaultValues: () => ({
      taskId: defaultTask,
      markAsDone: false,
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        taskId: values.taskId as Id<"tasks">,
        markAsDone: values.markAsDone,
      },
    }),
    renderForm: ({ form, isStarted }) => {
      const selectedTaskId = form.watch("taskId");
      const selectedTask = tasks.find((t) => t._id === selectedTaskId);
      const assigneeNames = selectedTask?.assigneeIds
        ?.map((id) => users.find((u) => u._id === id)?.name)
        .filter(Boolean)
        .join(", ");

      return (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Execute a task from the parallel batch. You can start a task
              (moves to InProgress) or complete it directly (moves to Done).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="taskId">Select Task *</Label>
            <Select
              value={form.watch("taskId")}
              onValueChange={(v) => form.setValue("taskId", v)}
              disabled={!isStarted}
            >
              <SelectTrigger id="taskId">
                <SelectValue placeholder="Select a task..." />
              </SelectTrigger>
              <SelectContent>
                {eligibleTasks.map((task) => (
                  <SelectItem key={task._id} value={task._id}>
                    <div className="flex items-center gap-2">
                      <span>{task.name}</span>
                      <Badge
                        variant={
                          task.status === "InProgress" ? "secondary" : "outline"
                        }
                        className="text-xs"
                      >
                        {task.status}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleTasks.length === 0 && (
              <p className="text-sm text-amber-600">
                No tasks available in the parallel batch.
              </p>
            )}
          </div>

          {selectedTask && (
            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="font-medium">Task Details</h4>
              <div className="space-y-2">
                <p className="text-lg font-semibold">{selectedTask.name}</p>
                {selectedTask.description && (
                  <p className="text-sm text-muted-foreground">
                    {selectedTask.description}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      selectedTask.status === "InProgress"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {selectedTask.status === "InProgress" && (
                      <Clock className="h-3 w-3 mr-1" />
                    )}
                    {selectedTask.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Priority</p>
                  <Badge variant="outline">
                    {selectedTask.priority ?? "Medium"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Est. Hours</p>
                  <p className="font-medium">
                    {selectedTask.estimatedHours ?? "N/A"}
                  </p>
                </div>
              </div>
              {assigneeNames && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Assigned to: {assigneeNames}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 py-2 rounded-lg border p-3">
            <Checkbox
              id="markAsDone"
              checked={form.watch("markAsDone")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("markAsDone", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="markAsDone">Mark as Done</Label>
              <p className="text-xs text-muted-foreground">
                {selectedTask?.status === "InProgress"
                  ? "Complete this task (InProgress → Done)"
                  : "Skip InProgress and mark directly as Done (Todo → Done)"}
              </p>
            </div>
          </div>

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to execute a parallel task.
            </p>
          )}
        </div>
      );
    },
    icon: <Play className="h-8 w-8 text-green-500" />,
    title: "Execute Parallel Task",
    description: "Start or complete a task in the parallel batch",
    formTitle: "Execute Task",
    formDescription:
      "Select a task and choose whether to start or complete it.",
    getSubmitProps: ({ form }) => ({
      text: form.watch("markAsDone") ? "Complete Task" : "Start Task",
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
  "/_app/tasks/executeparalleltask/$projectId"
)({
  component: ExecuteParallelTaskTask,
});

function ExecuteParallelTaskTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "executeParallelTask" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });
  const users = useQuery(
    api.workflows.dealToDelivery.api.organizations.listUsers,
    { activeOnly: true }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Task updated</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (workItem === undefined || tasks === undefined || users === undefined) {
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

  const Component = ExecuteParallelTaskComponentFactory(
    projectId,
    tasks,
    users,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
