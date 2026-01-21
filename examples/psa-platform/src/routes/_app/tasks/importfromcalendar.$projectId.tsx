/**
 * Import From Calendar Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-importfromcalendar.md
 * Note: MVP placeholder - calendar integration not yet available
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { Calendar, Loader2, AlertTriangle, Info, Link2Off } from "lucide-react";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const importFromCalendarSchema = z.object({
  calendarSource: z.enum(["google", "outlook"]),
  dateRange: z.object({
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  }),
});

type ImportFromCalendarFormValues = z.infer<typeof importFromCalendarSchema>;

export const Route = createFileRoute(
  "/_app/tasks/importfromcalendar/$projectId"
)({
  component: ImportFromCalendarTask,
});

function ImportFromCalendarTask() {
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
    { projectId, taskType: "importFromCalendar" }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Time entries created</h3>
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
      <ImportFromCalendarTaskForm
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

function ImportFromCalendarTaskForm({
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
  const [isCalendarConnected] = useState(false); // MVP: always false

  // Get today and last week for default range
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const form = useForm<ImportFromCalendarFormValues>({
    resolver: zodResolver(importFromCalendarSchema),
    defaultValues: {
      calendarSource: "google",
      dateRange: {
        startDate: lastWeek.toISOString().split("T")[0],
        endDate: today.toISOString().split("T")[0],
      },
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
          name: "importFromCalendar" as const,
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

  const handleConnectCalendar = () => {
    // MVP: Show that calendar integration is not yet available
    setErrorMessage(
      "Calendar integration is coming soon. Please use Manual Entry or Auto from Bookings instead."
    );
  };

  const handleSubmit = async () => {
    if (!isCalendarConnected) {
      setErrorMessage(
        "Please connect your calendar first to import events."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // MVP: Complete with empty events since calendar integration not available
      await completeWorkItem({
        workItemId,
        args: {
          name: "importFromCalendar" as const,
          payload: {
            calendarSource: form.getValues("calendarSource"),
            dateRange: {
              startDate: new Date(
                form.getValues("dateRange.startDate")
              ).getTime(),
              endDate: new Date(form.getValues("dateRange.endDate")).getTime(),
            },
            selectedEvents: [],
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to import calendar events."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Calendar className="h-8 w-8 text-orange-500" />}
      title="Import from Calendar"
      description="Create time entries from your calendar events"
      formTitle="Calendar Import"
      formDescription="Connect your calendar to automatically import events as time entries."
      onSubmit={handleSubmit}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={isCalendarConnected ? "Import Events" : "Connect First"}
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-6">
          {/* MVP Notice */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Coming Soon:</strong> Calendar integration is not yet
              available. Please use{" "}
              <span className="font-medium">Manual Entry</span> or{" "}
              <span className="font-medium">Auto from Bookings</span> to track
              your time.
            </AlertDescription>
          </Alert>

          {/* Calendar Source */}
          <div className="space-y-2">
            <Label htmlFor="calendarSource">Calendar Source</Label>
            <Select
              value={form.watch("calendarSource")}
              onValueChange={(v) =>
                form.setValue("calendarSource", v as "google" | "outlook")
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="calendarSource">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google">Google Calendar</SelectItem>
                <SelectItem value="outlook">Outlook Calendar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                {...form.register("dateRange.startDate")}
                disabled={!isStarted}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                {...form.register("dateRange.endDate")}
                disabled={!isStarted}
                max={new Date().toISOString().split("T")[0]}
              />
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex flex-col items-center justify-center py-12 border rounded-lg bg-muted/30">
            <Link2Off className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Calendar Not Connected</h3>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
              Connect your calendar to import events and automatically create
              time entries.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleConnectCalendar}
              disabled={!isStarted}
            >
              Connect Calendar
            </Button>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
