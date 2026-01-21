/**
 * Confirm Bookings Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Checkbox } from "@repo/ui/components/checkbox";
import { CalendarCheck, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  confirmAll: z.boolean().refine((val) => val === true, {
    message: "You must confirm the bookings to proceed",
  }),
});

type BookingSummary = {
  _id: Id<"bookings">;
  userName: string;
  type: "Tentative" | "Confirmed" | "TimeOff";
  startDate: number;
  endDate: number;
  hoursPerDay: number;
};

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString();

function ConfirmBookingsTaskComponentFactory(
  bookingIds: Id<"bookings">[],
  bookings: BookingSummary[],
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "confirmBookings",
    schema,
    getDefaultValues: () => ({
      confirmAll: false,
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        bookingIds,
        confirmAll: values.confirmAll,
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <>
        <div className="rounded-lg border bg-muted/50 p-4 mb-4">
          <h4 className="text-sm font-medium mb-2">Confirmation Summary</h4>
          <p className="text-sm text-muted-foreground">
            You are about to confirm the tentative resource bookings for this
            project. Once confirmed, the allocated team members will be notified
            and the project status will be updated to Active.
          </p>
        </div>

        <div className="space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking._id}
              className="flex items-start justify-between gap-4 rounded-lg border p-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{booking.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(booking.startDate)} -{" "}
                  {formatDate(booking.endDate)} • {booking.hoursPerDay}h/day
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {booking.type}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-start space-x-3">
          <Checkbox
            id="confirmAll"
            checked={form.watch("confirmAll") === true}
            onCheckedChange={(checked) =>
              form.setValue("confirmAll", checked === true)
            }
            disabled={!isStarted}
          />
          <div className="space-y-1">
            <Label htmlFor="confirmAll" className="font-medium">
              I confirm these resource allocations
            </Label>
            <p className="text-sm text-muted-foreground">
              By checking this box, you confirm that the tentative bookings are
              approved and should be converted to confirmed status.
            </p>
          </div>
        </div>
        {form.formState.errors.confirmAll && (
          <p className="text-sm text-destructive">
            {form.formState.errors.confirmAll.message}
          </p>
        )}
      </>
    ),
    icon: <CalendarCheck className="h-8 w-8 text-cyan-500" />,
    title: "Confirm Resource Bookings",
    description: "Finalize the tentative resource allocations for this project",
    formTitle: "Resource Confirmation",
    formDescription:
      "Review and confirm the tentative bookings to activate the project team.",
    submitButtonText: "Confirm Bookings",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: "/projects" });
    },
  });
}

export const Route = createFileRoute(
  "/_app/tasks/confirmbookings/$projectId"
)({
  component: ConfirmBookingsTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function ConfirmBookingsTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "confirmBookings" }
  );
  const bookings = useQuery(
    api.workflows.dealToDelivery.api.resources.listProjectBookings,
    { projectId }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Bookings confirmed</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to projects...
          </p>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (workItem === undefined || bookings === undefined) {
    return <SpinningLoader />;
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

  if (bookings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No bookings</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            No project bookings were found to confirm.
          </p>
        </CardContent>
      </Card>
    );
  }

  const bookingIds = bookings.map((booking) => booking._id);
  const bookingSummaries = bookings.map((booking) => ({
    _id: booking._id,
    userName: booking.userName ?? "Unknown",
    type: booking.type,
    startDate: booking.startDate,
    endDate: booking.endDate,
    hoursPerDay: booking.hoursPerDay,
  }));

  const Component = ConfirmBookingsTaskComponentFactory(
    bookingIds,
    bookingSummaries,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
