/**
 * Create Bookings Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Users } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const createBookingsSchema = z
  .object({
    userId: z.string().min(1, "Team member is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    hoursPerDay: z.number().min(0).max(24),
    bookingStatus: z.enum(["Tentative", "Confirmed"]),
    notes: z.string().optional(),
  })
  .refine(
    (values) => {
      const start = new Date(values.startDate).getTime();
      const end = new Date(values.endDate).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= end;
    },
    {
      message: "End date must be on or after start date",
      path: ["endDate"],
    }
  );

const getDefaultDate = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

function CreateBookingsTaskComponentFactory(
  projectId: Id<"projects">,
  users: Doc<"users">[]
) {
  return createPsaTaskComponent({
    workflowTaskName: "createBookings",
    schema: createBookingsSchema,
    getDefaultValues: () => ({
      userId: users[0]?._id ?? "",
      startDate: getDefaultDate(0),
      endDate: getDefaultDate(14),
      hoursPerDay: 8,
      bookingStatus: "Tentative" as const,
      notes: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        bookings: [
          {
            userId: values.userId as Id<"users">,
            startDate: new Date(values.startDate).getTime(),
            endDate: new Date(values.endDate).getTime(),
            hoursPerDay: values.hoursPerDay,
            notes: values.notes?.trim() || undefined,
          },
        ],
        isConfirmed: values.bookingStatus === "Confirmed",
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <>
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Create tentative bookings for early planning, or confirm when the
            deal is ready to staff.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="userId">Team Member *</Label>
          <Select
            value={form.watch("userId")}
            onValueChange={(value) => form.setValue("userId", value)}
            disabled={!isStarted}
          >
            <SelectTrigger id="userId">
              <SelectValue placeholder="Select a team member" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user._id} value={user._id}>
                  {user.name}
                  {user.role ? ` (${user.role})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.userId && (
            <p className="text-sm text-destructive">
              {form.formState.errors.userId.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="startDate">Start Date *</Label>
            <Input
              id="startDate"
              type="date"
              {...form.register("startDate")}
              disabled={!isStarted}
            />
            {form.formState.errors.startDate && (
              <p className="text-sm text-destructive">
                {form.formState.errors.startDate.message}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="endDate">End Date *</Label>
            <Input
              id="endDate"
              type="date"
              {...form.register("endDate")}
              disabled={!isStarted}
            />
            {form.formState.errors.endDate && (
              <p className="text-sm text-destructive">
                {form.formState.errors.endDate.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="hoursPerDay">Hours Per Day *</Label>
            <Input
              id="hoursPerDay"
              type="number"
              min="0"
              max="24"
              step="0.5"
              {...form.register("hoursPerDay", { valueAsNumber: true })}
              disabled={!isStarted}
            />
            {form.formState.errors.hoursPerDay && (
              <p className="text-sm text-destructive">
                {form.formState.errors.hoursPerDay.message}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bookingStatus">Booking Status *</Label>
            <Select
              value={form.watch("bookingStatus")}
              onValueChange={(value) =>
                form.setValue(
                  "bookingStatus",
                  value as "Tentative" | "Confirmed"
                )
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="bookingStatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Tentative">Tentative</SelectItem>
                <SelectItem value="Confirmed">Confirmed</SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.bookingStatus && (
              <p className="text-sm text-destructive">
                {form.formState.errors.bookingStatus.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes">Notes (Optional)</Label>
          <Textarea
            id="notes"
            placeholder="Optional notes about the booking..."
            rows={3}
            {...form.register("notes")}
            disabled={!isStarted}
          />
        </div>
      </>
    ),
    icon: <Users className="h-8 w-8 text-cyan-500" />,
    title: "Create Bookings",
    description: "Allocate team members to this project timeline",
    formTitle: "Booking Details",
    formDescription: "Choose a team member and define the booking window.",
    submitButtonText: "Create Booking",
    onSuccess: ({ navigate }) => {
      navigate({ to: "/resources" });
    },
  });
}

export const Route = createFileRoute("/_app/tasks/createbookings/$projectId")({
  component: CreateBookingsTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function CreateBookingsTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "createBookings" }
  );
  const users = useQuery(
    api.workflows.dealToDelivery.api.organizations.listUsers,
    { activeOnly: true }
  );
  const [hadWorkItem, setHadWorkItem] = useState(false);

  useEffect(() => {
    if (workItem) {
      setHadWorkItem(true);
    }
  }, [workItem]);

  if (workItem === undefined || users === undefined) {
    return <SpinningLoader />;
  }

  // No active work item for this task - redirect to projects page
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

  if (users.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          No active team members are available for booking.
        </p>
        <Navigate to="/resources" />
      </div>
    );
  }

  const Component = CreateBookingsTaskComponentFactory(projectId, users);

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
