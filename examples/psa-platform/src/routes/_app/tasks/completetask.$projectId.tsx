/**
 * Complete Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-completetask.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { CheckCircle, Loader2, AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  taskId: z.string().min(1, "Task selection is required"),
  actualHours: z.number().min(0, "Hours must be 0 or greater").optional(),
  notes: z.string().optional(),
});

function CompleteTaskComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  onRedirectStart?: () => void
) {
  // Get InProgress tasks for completion
  const inProgressTasks = tasks.filter((t) => t.status === "InProgress");
  const defaultTask = inProgressTasks[0]?._id ?? "";

  return createPsaTaskComponent({
    workflowTaskName: "completeTask",
    schema,
    getDefaultValues: () => ({
      taskId: defaultTask,
      actualHours: undefined,
      notes: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        taskId: values.taskId as Id<"tasks">,
        actualHours: values.actualHours,
        notes: values.notes || undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => {
      const selectedTaskId = form.watch("taskId");
      const selectedTask = tasks.find((t) => t._id === selectedTaskId);

      return (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Mark an in-progress task as complete. Optionally record the actual
              hours spent and any completion notes.
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
                <SelectValue placeholder="Select a task to complete..." />
              </SelectTrigger>
              <SelectContent>
                {inProgressTasks.map((task) => (
                  <SelectItem key={task._id} value={task._id}>
                    {task.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {inProgressTasks.length === 0 && (
              <p className="text-sm text-amber-600">
                No in-progress tasks available to complete.
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant="secondary">
                    <Clock className="h-3 w-3 mr-1" />
                    In Progress
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Estimated Hours
                  </p>
                  <p className="font-medium">
                    {selectedTask.estimatedHours ?? "Not set"}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="actualHours">Actual Hours (optional)</Label>
            <Input
              id="actualHours"
              type="number"
              min="0"
              step="0.25"
              placeholder={
                selectedTask?.estimatedHours?.toString() ?? "Enter hours"
              }
              {...form.register("actualHours", { valueAsNumber: true })}
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              Record the actual time spent on this task.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Completion Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about the completed work..."
              {...form.register("notes")}
              disabled={!isStarted}
              rows={3}
            />
          </div>

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to mark it as complete.
            </p>
          )}
        </div>
      );
    },
    icon: <CheckCircle className="h-8 w-8 text-green-500" />,
    title: "Complete Task",
    description: "Mark an in-progress task as done",
    formTitle: "Task Completion",
    formDescription:
      "Select a task and optionally record actual hours and notes.",
    submitButtonText: "Mark Done",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute("/_app/tasks/completetask/$projectId")({
  component: CompleteTaskTask,
});

function CompleteTaskTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "completeTask" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Task completed</h3>
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

  const Component = CompleteTaskComponentFactory(projectId, tasks, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
