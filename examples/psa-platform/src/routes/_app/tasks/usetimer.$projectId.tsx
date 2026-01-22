/**
 * Use Timer Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-usetimer.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo, useEffect, useCallback } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import {
  Timer,
  Loader2,
  AlertTriangle,
  Play,
  Square,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const useTimerSchema = z.object({
  taskId: z.string().optional(),
  serviceId: z.string().optional(),
  billable: z.boolean(),
  notes: z.string().optional(),
});

type UseTimerFormValues = z.infer<typeof useTimerSchema>;

const MIN_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const MAX_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours
const NO_TASK_VALUE = "none";
const NO_SERVICE_VALUE = "none";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export const Route = createFileRoute("/_app/tasks/usetimer/$projectId")({
  component: UseTimerTask,
});

function UseTimerTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    {
      projectId,
    }
  );

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "useTimer" }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Time entry created</h3>
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

  // No active work item for this task
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

  return (
    <Suspense fallback={<SpinningLoader />}>
      <UseTimerTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        project={project}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function UseTimerTaskForm({
  workItemId,
  projectId,
  project,
  onRedirect,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  projectId: Id<"projects">;
  project: NonNullable<
    ReturnType<typeof useQuery<typeof api.workflows.dealToDelivery.api.projects.getProject>>
  >;
  onRedirect: () => void;
}) {
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  // Get project tasks for the dropdown
  const tasks = useQuery(api.workflows.dealToDelivery.api.projects.listTasks, {
    projectId,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Timer state
  const [timerStartTime, setTimerStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const isTimerRunning = timerStartTime !== null;

  // Get services from project budget
  const services = useMemo(() => {
    return project?.budget?.services ?? [];
  }, [project?.budget?.services]);

  const form = useForm<UseTimerFormValues>({
    resolver: zodResolver(useTimerSchema),
    defaultValues: {
      billable: true,
      notes: "",
    },
  });

  // Update elapsed time while timer is running
  useEffect(() => {
    if (!timerStartTime) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - timerStartTime;
      setElapsedTime(elapsed);

      // Auto-stop warning at max duration
      if (elapsed >= MAX_DURATION_MS) {
        setErrorMessage(
          "Timer has reached maximum duration (12 hours). Please stop and save."
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timerStartTime]);

  const handleStartTimer = useCallback(() => {
    setTimerStartTime(Date.now());
    setElapsedTime(0);
    setErrorMessage(null);
  }, []);

  const handleStopTimer = useCallback(() => {
    if (!timerStartTime) return;
    const elapsed = Date.now() - timerStartTime;
    setElapsedTime(elapsed);
    setTimerStartTime(null);
  }, [timerStartTime]);

  if (!task) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Task details unavailable.
      </div>
    );
  }

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "useTimer" as const,
        },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: UseTimerFormValues) => {
    // Validate timer has run for at least 15 minutes
    if (elapsedTime < MIN_DURATION_MS) {
      setErrorMessage(
        `Timer must run for at least 15 minutes. Current: ${formatDuration(elapsedTime)}`
      );
      return;
    }

    // Stop timer if still running
    if (isTimerRunning) {
      handleStopTimer();
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Calculate start time (when timer was started)
      const startTime = Date.now() - elapsedTime;

      await completeWorkItem({
        workItemId,
        args: {
          name: "useTimer" as const,
          payload: {
            projectId,
            taskId: values.taskId
              ? (values.taskId as Id<"tasks">)
              : undefined,
            serviceId: values.serviceId
              ? (values.serviceId as Id<"services">)
              : undefined,
            startTime,
            billable: values.billable,
            notes: values.notes || undefined,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create time entry."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = elapsedTime >= MIN_DURATION_MS && !isTimerRunning;
  const hoursTracked = elapsedTime / (1000 * 60 * 60);

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Timer className="h-8 w-8 text-green-500" />}
      title="Timer"
      description="Track time with a live timer"
      formTitle="Timer Controls"
      formDescription="Start the timer, then stop when done to create a time entry."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={canSubmit ? "Save Time Entry" : "Stop Timer First"}
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-6">
          {/* Timer Display */}
          <div className="flex flex-col items-center justify-center py-8 bg-muted/50 rounded-lg">
            <div className="text-6xl font-mono font-bold tracking-wider mb-4">
              {formatDuration(elapsedTime)}
            </div>
            <div className="text-sm text-muted-foreground mb-4">
              {hoursTracked.toFixed(2)} hours
            </div>
            <div className="flex gap-2">
              {!isTimerRunning ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={handleStartTimer}
                  disabled={!isStarted || elapsedTime > 0}
                  className="gap-2"
                >
                  <Play className="h-5 w-5" />
                  Start Timer
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  variant="destructive"
                  onClick={handleStopTimer}
                  className="gap-2"
                >
                  <Square className="h-5 w-5" />
                  Stop Timer
                </Button>
              )}
            </div>
          </div>

          {/* Validation warnings */}
          {elapsedTime > 0 && elapsedTime < MIN_DURATION_MS && !isTimerRunning && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Timer must run for at least 15 minutes to save. Current:{" "}
                {formatDuration(elapsedTime)}
              </AlertDescription>
            </Alert>
          )}

          {elapsedTime >= MAX_DURATION_MS && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Timer has reached maximum duration (12 hours). Please save your
                entry.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taskId">Task (optional)</Label>
              <Select
                value={form.watch("taskId") ?? NO_TASK_VALUE}
                onValueChange={(value) =>
                  form.setValue(
                    "taskId",
                    value === NO_TASK_VALUE ? undefined : value
                  )
                }
                disabled={!isStarted}
              >
                <SelectTrigger id="taskId">
                  <SelectValue placeholder="Select task..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TASK_VALUE}>No task</SelectItem>
                  {tasks?.map((t) => (
                    <SelectItem key={t._id} value={t._id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="serviceId">Service (optional)</Label>
              <Select
                value={form.watch("serviceId") ?? NO_SERVICE_VALUE}
                onValueChange={(value) =>
                  form.setValue(
                    "serviceId",
                    value === NO_SERVICE_VALUE ? undefined : value
                  )
                }
                disabled={!isStarted}
              >
                <SelectTrigger id="serviceId">
                  <SelectValue placeholder="Select service..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SERVICE_VALUE}>No service</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name} (${(s.rate / 100).toFixed(2)}/hr)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="billable"
              checked={form.watch("billable")}
              onCheckedChange={(checked: boolean) => form.setValue("billable", checked)}
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="billable">Billable</Label>
              <p className="text-xs text-muted-foreground">
                Mark this time as billable to the client
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Describe what you worked on..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
