/**
 * Pause Work Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-pausework.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { PauseCircle, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  reason: z.string().min(1, "Reason is required"),
  notifyTeam: z.boolean(),
});

function TaskSelectionField({
  tasks,
  selectedTaskIds,
  setSelectedTaskIds,
  isStarted,
}: {
  tasks: Doc<"tasks">[];
  selectedTaskIds: Id<"tasks">[];
  setSelectedTaskIds: (ids: Id<"tasks">[]) => void;
  isStarted: boolean;
}) {
  const inProgressTasks = tasks.filter((t) => t.status === "InProgress");

  if (inProgressTasks.length === 0) {
    return (
      <div className="rounded-lg border p-4 bg-muted/50">
        <p className="text-sm text-muted-foreground">
          No tasks are currently in progress. All in-progress tasks will be
          paused.
        </p>
      </div>
    );
  }

  const toggleTask = (taskId: Id<"tasks">) => {
    if (selectedTaskIds.includes(taskId)) {
      setSelectedTaskIds(selectedTaskIds.filter((id) => id !== taskId));
    } else {
      setSelectedTaskIds([...selectedTaskIds, taskId]);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Select Tasks to Pause (optional)</Label>
      <p className="text-xs text-muted-foreground mb-2">
        Leave unchecked to pause all in-progress tasks.
      </p>
      <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border p-3">
        {inProgressTasks.map((task) => (
          <div key={task._id} className="flex items-center gap-3">
            <Checkbox
              id={`task-${task._id}`}
              checked={selectedTaskIds.includes(task._id)}
              onCheckedChange={() => toggleTask(task._id)}
              disabled={!isStarted}
            />
            <Label htmlFor={`task-${task._id}`} className="cursor-pointer">
              {task.name}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}

function PauseWorkComponentFactory(
  projectId: Id<"projects">,
  tasks: Doc<"tasks">[],
  selectedTaskIds: Id<"tasks">[],
  setSelectedTaskIds: (ids: Id<"tasks">[]) => void,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "pauseWork",
    schema,
    getDefaultValues: () => ({
      reason: "",
      notifyTeam: true,
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        reason: values.reason,
        notifyTeam: values.notifyTeam,
        pausedTaskIds:
          selectedTaskIds.length > 0 ? selectedTaskIds : undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <div className="space-y-4">
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Pausing work will halt all in-progress tasks and notify the team if
            selected. This action is typically used when budget overruns occur.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason">Reason for Pausing *</Label>
          <Textarea
            id="reason"
            placeholder="Explain why work is being paused..."
            {...form.register("reason")}
            disabled={!isStarted}
            rows={3}
          />
          {form.formState.errors.reason && (
            <p className="text-sm text-destructive">
              {form.formState.errors.reason.message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 py-2">
          <Checkbox
            id="notifyTeam"
            checked={form.watch("notifyTeam")}
            onCheckedChange={(checked: boolean) =>
              form.setValue("notifyTeam", checked)
            }
            disabled={!isStarted}
          />
          <div className="space-y-0.5">
            <Label htmlFor="notifyTeam">Notify Team</Label>
            <p className="text-xs text-muted-foreground">
              Send notification to team members about the pause
            </p>
          </div>
        </div>

        <TaskSelectionField
          tasks={tasks}
          selectedTaskIds={selectedTaskIds}
          setSelectedTaskIds={setSelectedTaskIds}
          isStarted={isStarted}
        />
      </div>
    ),
    icon: <PauseCircle className="h-8 w-8 text-amber-500" />,
    title: "Pause Work",
    description: "Pause project work due to budget overrun or other issues",
    formTitle: "Pause Details",
    formDescription: "Provide a reason for pausing and select tasks to pause.",
    submitButtonText: "Pause Work",
    submitButtonVariant: "destructive",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute("/_app/tasks/pausework/$projectId")({
  component: PauseWorkTask,
});

function PauseWorkTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Id<"tasks">[]>([]);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "pauseWork" }
  );
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Work paused</h3>
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

  const Component = PauseWorkComponentFactory(
    projectId,
    tasks,
    selectedTaskIds,
    setSelectedTaskIds,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
