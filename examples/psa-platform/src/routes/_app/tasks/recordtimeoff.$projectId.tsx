/**
 * Record Time Off Task Route - Domain-First Routing
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
import { Calendar } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const timeOffSchema = z
  .object({
    userId: z.string().min(1, "Team member is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    type: z.enum(["Vacation", "Sick", "Personal", "Holiday"]),
    hoursPerDay: z.number().min(0).max(24),
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

function RecordTimeOffTaskComponentFactory(currentUser: Doc<"users">) {
  return createPsaTaskComponent({
    workflowTaskName: "recordPlannedTimeOff",
    schema: timeOffSchema,
    getDefaultValues: () => ({
      userId: currentUser._id,
      startDate: getDefaultDate(0),
      endDate: getDefaultDate(0),
      type: "Vacation" as const,
      hoursPerDay: 8,
      notes: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        userId: values.userId as Id<"users">,
        startDate: new Date(values.startDate).getTime(),
        endDate: new Date(values.endDate).getTime(),
        type: values.type,
        hoursPerDay: values.hoursPerDay,
        notes: values.notes?.trim() || undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <>
        <input type="hidden" {...form.register("userId")} />
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">Recording time off for</p>
          <p className="text-base font-medium">
            {currentUser.name}
            {currentUser.role ? ` • ${currentUser.role}` : ""}
          </p>
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
            <Label htmlFor="type">Time Off Type *</Label>
            <Select
              value={form.watch("type")}
              onValueChange={(value) =>
                form.setValue(
                  "type",
                  value as "Vacation" | "Sick" | "Personal" | "Holiday"
                )
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Vacation">Vacation</SelectItem>
                <SelectItem value="Sick">Sick</SelectItem>
                <SelectItem value="Personal">Personal</SelectItem>
                <SelectItem value="Holiday">Holiday</SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.type && (
              <p className="text-sm text-destructive">
                {form.formState.errors.type.message}
              </p>
            )}
          </div>
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
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes">Notes (Optional)</Label>
          <Textarea
            id="notes"
            placeholder="Add any details about this time off..."
            rows={3}
            {...form.register("notes")}
            disabled={!isStarted}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Set hours per day to 0 to indicate no time off needs to be recorded.
        </p>
      </>
    ),
    icon: <Calendar className="h-8 w-8 text-cyan-500" />,
    title: "Record Time Off",
    description: "Log planned time off for resource planning",
    formTitle: "Time Off Details",
    formDescription:
      "Provide the dates and type of planned time off to block availability.",
    submitButtonText: "Record Time Off",
    onSuccess: ({ navigate }) => {
      navigate({ to: "/resources" });
    },
  });
}

export const Route = createFileRoute("/_app/tasks/recordtimeoff/$projectId")({
  component: RecordTimeOffTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function RecordTimeOffTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "recordPlannedTimeOff" }
  );
  const currentUser = useQuery(
    api.workflows.dealToDelivery.api.organizations.getCurrentUser,
    {}
  );
  const [hadWorkItem, setHadWorkItem] = useState(false);

  useEffect(() => {
    if (workItem) {
      setHadWorkItem(true);
    }
  }, [workItem]);

  // Loading state
  if (workItem === undefined || currentUser === undefined) {
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

  if (!currentUser) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          Unable to load your user profile for time off recording.
        </p>
        <Navigate to="/tasks" />
      </div>
    );
  }

  const Component = RecordTimeOffTaskComponentFactory(currentUser);

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
