/**
 * Auto From Bookings Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-autofrombookings.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Card, CardContent } from "@repo/ui/components/card";
import { CalendarClock, Loader2, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/utils";

const autoFromBookingsSchema = z.object({
  dateRange: z.object({
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  }),
  includeBookings: z.array(z.string()),
  overrideHours: z.number().min(0.25).max(24).optional(),
});

type AutoFromBookingsFormValues = z.infer<typeof autoFromBookingsSchema>;

export const Route = createFileRoute("/_app/tasks/autofrombookings/$projectId")(
  {
    component: AutoFromBookingsTask,
  }
);

function AutoFromBookingsTask() {
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
    { projectId, taskType: "autoFromBookings" }
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
          <h3 className="text-lg font-medium">Time entries created</h3>
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
      <AutoFromBookingsTaskForm
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

function AutoFromBookingsTaskForm({
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

  // Get today and last week for default range
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const form = useForm<AutoFromBookingsFormValues>({
    resolver: zodResolver(autoFromBookingsSchema),
    defaultValues: {
      dateRange: {
        startDate: lastWeek.toISOString().split("T")[0],
        endDate: today.toISOString().split("T")[0],
      },
      includeBookings: [],
      overrideHours: undefined,
    },
  });

  // Watch date range to fetch bookings
  const dateRange = form.watch("dateRange");

  // Fetch user bookings for the date range
  const allBookings = useQuery(
    api.workflows.dealToDelivery.api.resources.getUserBookings,
    {
      userId,
      startDate: new Date(dateRange.startDate).getTime(),
      endDate: new Date(dateRange.endDate).getTime(),
    }
  );

  // Filter bookings for this project
  const bookings = useMemo(() => {
    if (!allBookings) return undefined;
    return allBookings.filter((b) => b.projectId === projectId);
  }, [allBookings, projectId]);

  // Get selected bookings
  const selectedBookings = form.watch("includeBookings");

  // Calculate total hours from selected bookings
  const totalHours = useMemo(() => {
    if (!bookings) return 0;
    return bookings
      .filter((b) => selectedBookings.includes(b._id))
      .reduce((sum, b) => sum + b.hoursPerDay, 0);
  }, [bookings, selectedBookings]);

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
          name: "autoFromBookings" as const,
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

  const handleSelectAll = () => {
    if (bookings) {
      form.setValue(
        "includeBookings",
        bookings.map((b) => b._id)
      );
    }
  };

  const handleDeselectAll = () => {
    form.setValue("includeBookings", []);
  };

  const handleSubmit = async (values: AutoFromBookingsFormValues) => {
    if (values.includeBookings.length === 0) {
      setErrorMessage("Please select at least one booking to include.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "autoFromBookings" as const,
          payload: {
            userId,
            dateRange: {
              startDate: new Date(values.dateRange.startDate).getTime(),
              endDate: new Date(values.dateRange.endDate).getTime(),
            },
            includeBookings: values.includeBookings as Id<"bookings">[],
            overrideHours: values.overrideHours,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to create time entries."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<CalendarClock className="h-8 w-8 text-purple-500" />}
      title="Auto from Bookings"
      description="Generate time entries from your resource bookings"
      formTitle="Booking Selection"
      formDescription="Select bookings to automatically create time entries."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Create Time Entries"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-6">
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
              {form.formState.errors.dateRange?.startDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.dateRange.startDate.message}
                </p>
              )}
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
              {form.formState.errors.dateRange?.endDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.dateRange.endDate.message}
                </p>
              )}
            </div>
          </div>

          {/* Override Hours */}
          <div className="space-y-2">
            <Label htmlFor="overrideHours">Override Hours (optional)</Label>
            <Input
              id="overrideHours"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              placeholder="Use booking hours"
              {...form.register("overrideHours", { valueAsNumber: true })}
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              Override the hours per day from bookings. Leave empty to use
              booking hours.
            </p>
          </div>

          {/* Bookings List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Bookings</Label>
              {bookings && bookings.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={handleSelectAll}
                    disabled={!isStarted}
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground">|</span>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={handleDeselectAll}
                    disabled={!isStarted}
                  >
                    Deselect All
                  </button>
                </div>
              )}
            </div>

            {bookings === undefined && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {bookings && bookings.length === 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No bookings found for this date range.
                </AlertDescription>
              </Alert>
            )}

            {bookings && bookings.length > 0 && (
              <div className="border rounded-lg divide-y">
                {bookings.map((booking) => {
                  const isSelected = selectedBookings.includes(booking._id);
                  return (
                    <label
                      key={booking._id}
                      className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          const current = form.getValues("includeBookings");
                          if (checked) {
                            form.setValue("includeBookings", [
                              ...current,
                              booking._id,
                            ]);
                          } else {
                            form.setValue(
                              "includeBookings",
                              current.filter((id) => id !== booking._id)
                            );
                          }
                        }}
                        disabled={!isStarted}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {formatDate(booking.startDate)} -{" "}
                          {formatDate(booking.endDate)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {booking.hoursPerDay}h/day
                          {booking.type === "Tentative" && " (Tentative)"}
                        </div>
                      </div>
                      <div className="text-sm font-medium">
                        {booking.hoursPerDay}h
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Summary */}
            {selectedBookings.length > 0 && (
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">
                  {selectedBookings.length} booking(s) selected
                </span>
                <span className="font-medium">{totalHours}h total</span>
              </div>
            )}
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
