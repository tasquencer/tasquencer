/**
 * Revise Timesheet Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-revisetimesheet.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Card, CardContent } from "@repo/ui/components/card";
import { Edit3, Loader2, AlertTriangle, Clock } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const reviseTimesheetSchema = z.object({
  resubmit: z.boolean(),
});

type ReviseTimesheetFormValues = z.infer<typeof reviseTimesheetSchema>;

export const Route = createFileRoute("/_app/tasks/revisetimesheet/$projectId")({
  component: ReviseTimesheetTask,
});

function ReviseTimesheetTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviseTimesheet" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Revisions submitted</h3>
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
      <ReviseTimesheetTaskForm
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

function ReviseTimesheetTaskForm({
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

  // Get rejected time entries for this project
  const timeEntriesData = useQuery(
    api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
    { projectId, status: "Rejected" }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<
    Record<
      string,
      { hours?: number; notes?: string; billable?: boolean }
    >
  >({});

  const timeEntries = timeEntriesData?.entries ?? [];

  const form = useForm<ReviseTimesheetFormValues>({
    resolver: zodResolver(reviseTimesheetSchema),
    defaultValues: {
      resubmit: true,
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
        args: { name: "reviseTimesheet" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const updateRevision = (
    entryId: string,
    field: "hours" | "notes" | "billable",
    value: number | string | boolean
  ) => {
    setRevisions((prev) => ({
      ...prev,
      [entryId]: {
        ...prev[entryId],
        [field]: value,
      },
    }));
  };

  const handleSubmit = async (values: ReviseTimesheetFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const revisionsList = Object.entries(revisions)
        .filter(
          ([, rev]) =>
            rev.hours !== undefined ||
            rev.notes !== undefined ||
            rev.billable !== undefined
        )
        .map(([entryId, rev]) => ({
          timeEntryId: entryId as Id<"timeEntries">,
          hours: rev.hours,
          notes: rev.notes,
          billable: rev.billable,
        }));

      await completeWorkItem({
        workItemId,
        args: {
          name: "reviseTimesheet" as const,
          payload: {
            timeEntryIds: timeEntries.map((e) => e._id),
            revisions: revisionsList,
            resubmit: values.resubmit,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit revisions."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Edit3 className="h-8 w-8 text-orange-500" />}
      title="Revise Timesheet"
      description="Edit rejected time entries and resubmit for approval"
      formTitle="Rejected Entries"
      formDescription="Make any necessary corrections to your time entries."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Submit Revisions"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Rejected Time Entries List */}
          <div className="space-y-2">
            <Label>Rejected Time Entries</Label>
            {timeEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No rejected time entries to revise.
              </p>
            ) : (
              <div className="space-y-4">
                {timeEntries.map((entry) => (
                  <Card key={entry._id} className="border-orange-200">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString()}
                        </span>
                        <Badge variant="destructive" className="text-xs">
                          Rejected
                        </Badge>
                      </div>

                      {entry.rejectionComments && (
                        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                          <strong>Rejection reason:</strong>{" "}
                          {entry.rejectionComments}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs">Hours</Label>
                          <Input
                            type="number"
                            step="0.25"
                            min="0.25"
                            max="24"
                            defaultValue={entry.hours}
                            onChange={(e) =>
                              updateRevision(
                                entry._id,
                                "hours",
                                parseFloat(e.target.value) || entry.hours
                              )
                            }
                            disabled={!isStarted}
                          />
                        </div>
                        <div className="flex items-center gap-2 pt-5">
                          <Checkbox
                            id={`billable-${entry._id}`}
                            defaultChecked={entry.billable}
                            onCheckedChange={(checked: boolean) =>
                              updateRevision(entry._id, "billable", checked)
                            }
                            disabled={!isStarted}
                          />
                          <Label
                            htmlFor={`billable-${entry._id}`}
                            className="text-sm"
                          >
                            Billable
                          </Label>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Notes</Label>
                        <Textarea
                          defaultValue={entry.notes || ""}
                          onChange={(e) =>
                            updateRevision(entry._id, "notes", e.target.value)
                          }
                          disabled={!isStarted}
                          rows={2}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Resubmit Toggle */}
          <div className="flex items-center gap-3 py-2 border-t pt-4">
            <Checkbox
              id="resubmit"
              checked={form.watch("resubmit")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("resubmit", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="resubmit">Resubmit for Approval</Label>
              <p className="text-xs text-muted-foreground">
                Send revised entries back for manager approval
              </p>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
