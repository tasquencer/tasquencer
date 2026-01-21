/**
 * Review Timesheet Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-reviewtimesheet.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
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
import { ClipboardCheck, Loader2, AlertTriangle, Clock } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const reviewTimesheetSchema = z.object({
  timeEntryIds: z.array(z.string()).min(1, "Select at least one time entry"),
  decision: z.enum(["approve", "reject"]),
  comments: z.string().optional(),
});

type ReviewTimesheetFormValues = z.infer<typeof reviewTimesheetSchema>;

export const Route = createFileRoute("/_app/tasks/reviewtimesheet/$projectId")({
  component: ReviewTimesheetTask,
});

function ReviewTimesheetTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviewTimesheet" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Review submitted</h3>
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
      <ReviewTimesheetTaskForm
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

function ReviewTimesheetTaskForm({
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

  // Get submitted time entries for this project
  const timeEntriesData = useQuery(
    api.workflows.dealToDelivery.api.time.getProjectTimeEntries,
    { projectId, status: "Submitted" }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());

  const timeEntries = timeEntriesData?.entries ?? [];

  const form = useForm<ReviewTimesheetFormValues>({
    resolver: zodResolver(reviewTimesheetSchema),
    defaultValues: {
      timeEntryIds: [],
      decision: "approve",
      comments: "",
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
        args: { name: "reviewTimesheet" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const toggleEntry = (entryId: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      form.setValue("timeEntryIds", Array.from(next));
      return next;
    });
  };

  const selectAll = () => {
    const allIds = timeEntries.map((e) => e._id);
    setSelectedEntries(new Set(allIds));
    form.setValue("timeEntryIds", allIds);
  };

  const handleSubmit = async (values: ReviewTimesheetFormValues) => {
    if (selectedEntries.size === 0) {
      setErrorMessage("Please select at least one time entry to review.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "reviewTimesheet" as const,
          payload: {
            timeEntryIds: Array.from(selectedEntries) as Id<"timeEntries">[],
            decision: values.decision,
            comments: values.comments || undefined,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit review."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<ClipboardCheck className="h-8 w-8 text-blue-500" />}
      title="Review Timesheet"
      description="Review and approve or reject submitted time entries"
      formTitle="Time Entry Review"
      formDescription="Select entries and choose approve or reject."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Submit Review"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Time Entries List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Submitted Time Entries</Label>
              {timeEntries.length > 0 && isStarted && (
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-sm text-primary hover:underline"
                >
                  Select All ({timeEntries.length})
                </button>
              )}
            </div>
            {timeEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No submitted time entries to review.
              </p>
            ) : (
              <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                {timeEntries.map((entry) => (
                  <div
                    key={entry._id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedEntries.has(entry._id)}
                      onCheckedChange={() => toggleEntry(entry._id)}
                      disabled={!isStarted}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{entry.hours}h</span>
                        <span className="text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString()}
                        </span>
                        {entry.billable && (
                          <Badge variant="outline" className="text-xs">
                            Billable
                          </Badge>
                        )}
                      </div>
                      {entry.notes && (
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {entry.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Decision */}
          <div className="space-y-2">
            <Label htmlFor="decision">Decision</Label>
            <Select
              value={form.watch("decision")}
              onValueChange={(v) =>
                form.setValue("decision", v as "approve" | "reject")
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">Approve</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <Label htmlFor="comments">
              Comments {form.watch("decision") === "reject" && "(recommended)"}
            </Label>
            <Textarea
              id="comments"
              {...form.register("comments")}
              placeholder="Optional review comments..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
