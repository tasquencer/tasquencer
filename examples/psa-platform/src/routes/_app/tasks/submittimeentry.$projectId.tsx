/**
 * Submit Time Entry Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-submittimeentry.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Badge } from "@repo/ui/components/badge";
import { Send, Loader2, AlertTriangle, Info, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/utils";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const Route = createFileRoute("/_app/tasks/submittimeentry/$projectId")({
  component: SubmitTimeEntryTask,
});

function SubmitTimeEntryTask() {
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
    { projectId, taskType: "submitTimeEntry" }
  );

  // Get current user
  const currentUser = useQuery(
    api.workflows.dealToDelivery.api.organizations.getCurrentUser,
    {}
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Time entry submitted</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (
    project === undefined ||
    workItem === undefined ||
    currentUser === undefined
  ) {
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

  if (currentUser === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">User not found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            Unable to identify current user.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Suspense fallback={<SpinningLoader />}>
      <SubmitTimeEntryTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        userId={currentUser._id}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function SubmitTimeEntryTaskForm({
  workItemId,
  projectId,
  userId,
  onRedirect,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  projectId: Id<"projects">;
  userId: Id<"users">;
  onRedirect: () => void;
}) {
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<Id<"timeEntries"> | null>(null);

  // Get draft time entries for this project
  const timeEntries = useQuery(
    api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
    {
      projectId,
      status: "Draft",
    }
  );

  // Filter to only current user's entries and check age
  const { userEntries, blockedEntries } = useMemo(() => {
    if (!timeEntries?.entries) return { userEntries: [], blockedEntries: [] };

    const now = Date.now();
    const nintyDaysAgo = now - NINETY_DAYS_MS;

    const userOwnedEntries = timeEntries.entries.filter(
      (e) => e.userId === userId
    );

    return {
      userEntries: userOwnedEntries.filter((e) => e.date >= nintyDaysAgo),
      blockedEntries: userOwnedEntries.filter((e) => e.date < nintyDaysAgo),
    };
  }, [timeEntries?.entries, userId]);

  // Calculate totals for selected entry
  const selectedEntry = useMemo(() => {
    return userEntries.find((e) => e._id === selectedEntryId) ?? null;
  }, [userEntries, selectedEntryId]);

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
          name: "submitTimeEntry" as const,
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

  const handleSubmit = async () => {
    if (!selectedEntryId) {
      setErrorMessage("Please select a time entry to submit.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "submitTimeEntry" as const,
          payload: {
            timeEntryId: selectedEntryId,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit time entry."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Send className="h-8 w-8 text-blue-500" />}
      title="Submit Time Entry"
      description="Submit your draft time entries for approval"
      formTitle="Select Time Entry"
      formDescription="Choose a draft time entry to submit for manager approval."
      onSubmit={handleSubmit}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={selectedEntryId ? "Submit Entry" : "Select Entry First"}
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-6">
          {/* Loading State */}
          {timeEntries === undefined && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* No Draft Entries */}
          {timeEntries !== undefined && userEntries.length === 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No draft time entries found for this project. Create a time
                entry first using Manual Entry, Timer, or Auto from Bookings.
              </AlertDescription>
            </Alert>
          )}

          {/* Blocked Entries Warning */}
          {blockedEntries.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {blockedEntries.length} time{" "}
                {blockedEntries.length === 1 ? "entry is" : "entries are"} older
                than 90 days and cannot be submitted.
              </AlertDescription>
            </Alert>
          )}

          {/* Time Entry List */}
          {userEntries.length > 0 && (
            <div className="border rounded-lg divide-y">
              {userEntries.map((entry) => {
                const isSelected = selectedEntryId === entry._id;
                return (
                  <label
                    key={entry._id}
                    className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        setSelectedEntryId(checked ? entry._id : null);
                      }}
                      disabled={!isStarted}
                    />
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {formatDate(entry.date)}
                        </span>
                        <Badge
                          variant={entry.billable ? "default" : "secondary"}
                        >
                          {entry.billable ? "Billable" : "Non-billable"}
                        </Badge>
                      </div>
                      {entry.notes && (
                        <div className="text-sm text-muted-foreground truncate">
                          {entry.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{entry.hours}h</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Selected Entry Summary */}
          {selectedEntry && (
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <span className="text-sm text-muted-foreground">
                Selected entry
              </span>
              <div className="text-right">
                <div className="font-medium">{selectedEntry.hours}h</div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(selectedEntry.date)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
