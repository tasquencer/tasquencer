/**
 * Review Bookings Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Checkbox } from "@repo/ui/components/checkbox";
import { ClipboardCheck } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const reviewBookingsSchema = z.object({
  bookingIds: z.array(z.string()),
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

function ReviewBookingsTaskComponentFactory(
  projectId: Id<"projects">,
  bookings: BookingSummary[]
) {
  return createPsaTaskComponent({
    workflowTaskName: "reviewBookings",
    schema: reviewBookingsSchema,
    getDefaultValues: () => ({
      bookingIds: bookings.map((booking) => booking._id as string),
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        bookingIds: values.bookingIds as Id<"bookings">[],
      },
    }),
    renderForm: ({ form, isStarted }) => {
      const selectedIds = form.watch("bookingIds") ?? [];
      const allSelected =
        bookings.length > 0 &&
        bookings.every((booking) => selectedIds.includes(booking._id as string));

      const toggleAll = (checked: boolean) => {
        form.setValue(
          "bookingIds",
          checked ? bookings.map((booking) => booking._id as string) : [],
          { shouldValidate: true }
        );
      };

      const toggleBooking = (bookingId: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) {
          next.add(bookingId);
        } else {
          next.delete(bookingId);
        }
        form.setValue("bookingIds", Array.from(next), { shouldValidate: true });
      };

      return (
        <>
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Review the bookings created for this project before moving to the
              next step.
            </p>
          </div>

          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No project bookings were found to review.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Bookings</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAll"
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      toggleAll(checked === true)
                    }
                    disabled={!isStarted}
                  />
                  <Label htmlFor="selectAll" className="text-sm">
                    Select all
                  </Label>
                </div>
              </div>

              <div className="space-y-3">
                {bookings.map((booking) => {
                  const bookingId = booking._id as string;
                  const isChecked = selectedIds.includes(bookingId);
                  return (
                    <div
                      key={bookingId}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          toggleBooking(bookingId, checked === true)
                        }
                        disabled={!isStarted}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {booking.userName}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {booking.type}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(booking.startDate)} -{" "}
                          {formatDate(booking.endDate)} • {booking.hoursPerDay}
                          h/day
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      );
    },
    icon: <ClipboardCheck className="h-8 w-8 text-cyan-500" />,
    title: "Review Bookings",
    description: "Verify resource bookings before confirming allocations",
    formTitle: "Bookings Review",
    formDescription:
      "Select the bookings you have reviewed to complete this task.",
    submitButtonText: "Complete Review",
    onSuccess: ({ navigate }) => {
      navigate({ to: "/resources" });
    },
  });
}

export const Route = createFileRoute("/_app/tasks/reviewbookings/$projectId")({
  component: ReviewBookingsTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function ReviewBookingsTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviewBookings" }
  );
  const bookings = useQuery(
    api.workflows.dealToDelivery.api.resources.listProjectBookings,
    { projectId }
  );
  const [hadWorkItem, setHadWorkItem] = useState(false);

  useEffect(() => {
    if (workItem) {
      setHadWorkItem(true);
    }
  }, [workItem]);

  if (workItem === undefined || bookings === undefined) {
    return <SpinningLoader />;
  }

  if (workItem === null) {
    if (hadWorkItem) {
      return <Navigate to="/projects" replace />;
    }
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          This task is not currently available for this project.
        </p>
        <Navigate to="/projects" />
      </div>
    );
  }

  const bookingSummaries = useMemo(
    () =>
      bookings.map((booking) => ({
        _id: booking._id,
        userName: booking.userName ?? "Unknown",
        type: booking.type,
        startDate: booking.startDate,
        endDate: booking.endDate,
        hoursPerDay: booking.hoursPerDay,
      })),
    [bookings]
  );

  const Component = ReviewBookingsTaskComponentFactory(
    projectId,
    bookingSummaries
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
