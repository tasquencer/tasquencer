/**
 * Select Time Entry Method Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-selectentrymethod.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import {
  Clock,
  Loader2,
  AlertTriangle,
  Timer,
  PenLine,
  Calendar,
  CalendarClock,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

const selectEntryMethodSchema = z.object({
  method: z.enum(["timer", "manual", "calendar", "autoBooking"]),
});

type SelectEntryMethodFormValues = z.infer<typeof selectEntryMethodSchema>;

const ENTRY_METHODS = [
  {
    value: "timer" as const,
    label: "Timer",
    description: "Track time with a live timer",
    icon: Timer,
  },
  {
    value: "manual" as const,
    label: "Manual Entry",
    description: "Enter hours and date manually",
    icon: PenLine,
  },
  {
    value: "calendar" as const,
    label: "Import from Calendar",
    description: "Create entries from calendar events",
    icon: Calendar,
  },
  {
    value: "autoBooking" as const,
    label: "Auto from Bookings",
    description: "Generate entries from resource bookings",
    icon: CalendarClock,
  },
];

export const Route = createFileRoute("/_app/tasks/selectentrymethod/$projectId")(
  {
    component: SelectEntryMethodTask,
  }
);

function SelectEntryMethodTask() {
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
    { projectId, taskType: "selectEntryMethod" }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Method selected</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to next step...
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
      <SelectEntryMethodTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function SelectEntryMethodTaskForm({
  workItemId,
  projectId,
  onRedirect,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  projectId: Id<"projects">;
  onRedirect: () => void;
}) {
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<SelectEntryMethodFormValues>({
    resolver: zodResolver(selectEntryMethodSchema),
    defaultValues: {
      method: "manual",
    },
  });

  if (!task) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Task details unavailable.
      </div>
    );
  }

  const selectedMethod = form.watch("method");

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "selectEntryMethod" as const,
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

  const handleSubmit = async (values: SelectEntryMethodFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "selectEntryMethod" as const,
          payload: {
            method: values.method,
            projectId,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit task."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Clock className="h-8 w-8 text-blue-500" />}
      title="Select Time Entry Method"
      description="Choose how you want to record time for this project"
      formTitle="Entry Method"
      formDescription="Select the method that works best for your workflow."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Continue"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <Label className="text-base font-medium">
            How do you want to enter time?
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ENTRY_METHODS.map((method) => {
              const Icon = method.icon;
              const isSelected = selectedMethod === method.value;
              return (
                <Button
                  key={method.value}
                  type="button"
                  variant="outline"
                  disabled={!isStarted}
                  onClick={() => form.setValue("method", method.value)}
                  className={cn(
                    "h-auto p-4 flex flex-col items-start gap-2 text-left",
                    isSelected &&
                      "border-primary bg-primary/5 ring-2 ring-primary ring-offset-2"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <span className="font-medium">{method.label}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {method.description}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
