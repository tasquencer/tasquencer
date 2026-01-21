/**
 * Manual Time Entry Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-manualentry.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { PenLine, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const manualEntrySchema = z.object({
  taskId: z.string().optional(),
  serviceId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  hours: z
    .number()
    .min(0.25, "Minimum 0.25 hours")
    .max(24, "Maximum 24 hours"),
  billable: z.boolean(),
  notes: z.string().optional(),
});

type ManualEntryFormValues = z.infer<typeof manualEntrySchema>;

export const Route = createFileRoute("/_app/tasks/manualentry/$projectId")({
  component: ManualEntryTask,
});

function ManualEntryTask() {
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
    { projectId, taskType: "manualEntry" }
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
      <ManualEntryTaskForm
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

function ManualEntryTaskForm({
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

  // Get services from project budget
  const services = useMemo(() => {
    return project?.budget?.services ?? [];
  }, [project?.budget?.services]);

  const form = useForm<ManualEntryFormValues>({
    resolver: zodResolver(manualEntrySchema),
    defaultValues: {
      taskId: "",
      serviceId: "",
      date: new Date().toISOString().split("T")[0],
      hours: 1,
      billable: true,
      notes: "",
    },
  });

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
          name: "manualEntry" as const,
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

  const handleSubmit = async (values: ManualEntryFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Parse date to timestamp (start of day)
      const dateTs = new Date(values.date).getTime();

      // Validate: no future dates
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (dateTs > today.getTime()) {
        setErrorMessage("Cannot enter time for future dates.");
        setIsSubmitting(false);
        return;
      }

      // Round hours to nearest 0.25
      const roundedHours = Math.round(values.hours * 4) / 4;

      await completeWorkItem({
        workItemId,
        args: {
          name: "manualEntry" as const,
          payload: {
            projectId,
            taskId: values.taskId
              ? (values.taskId as Id<"tasks">)
              : undefined,
            serviceId: values.serviceId
              ? (values.serviceId as Id<"services">)
              : undefined,
            date: dateTs,
            hours: roundedHours,
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

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<PenLine className="h-8 w-8 text-blue-500" />}
      title="Manual Time Entry"
      description="Enter time worked manually for this project"
      formTitle="Time Entry Details"
      formDescription="Enter the date, hours, and other details for this time entry."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Create Entry"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                {...form.register("date")}
                disabled={!isStarted}
                max={new Date().toISOString().split("T")[0]}
              />
              {form.formState.errors.date && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="hours">Hours</Label>
              <Input
                id="hours"
                type="number"
                step="0.25"
                min="0.25"
                max="24"
                {...form.register("hours", { valueAsNumber: true })}
                disabled={!isStarted}
              />
              {form.formState.errors.hours && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.hours.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Minimum 0.25h, maximum 24h. Rounds to nearest 0.25h.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taskId">Task (optional)</Label>
              <Select
                value={form.watch("taskId") || ""}
                onValueChange={(v) => form.setValue("taskId", v || "")}
                disabled={!isStarted}
              >
                <SelectTrigger id="taskId">
                  <SelectValue placeholder="Select task..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No task</SelectItem>
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
                value={form.watch("serviceId") || ""}
                onValueChange={(v) => form.setValue("serviceId", v || "")}
                disabled={!isStarted}
              >
                <SelectTrigger id="serviceId">
                  <SelectValue placeholder="Select service..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No service</SelectItem>
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
