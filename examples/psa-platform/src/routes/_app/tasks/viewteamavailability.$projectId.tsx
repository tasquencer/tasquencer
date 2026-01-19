/**
 * View Team Availability Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Users } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const dateRangeSchema = z
  .object({
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
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

function ViewTeamAvailabilityTaskComponentFactory(projectId: Id<"projects">) {
  return createPsaTaskComponent({
    workflowTaskName: "viewTeamAvailability",
    schema: dateRangeSchema,
    getDefaultValues: () => ({
      startDate: getDefaultDate(0),
      endDate: getDefaultDate(14),
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        startDate: new Date(values.startDate).getTime(),
        endDate: new Date(values.endDate).getTime(),
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <>
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
        <p className="text-sm text-muted-foreground">
          This will calculate availability for all active team members in the
          selected date range.
        </p>
      </>
    ),
    icon: <Users className="h-8 w-8 text-cyan-500" />,
    title: "View Team Availability",
    description: "Review availability across your team for planning",
    formTitle: "Availability Date Range",
    formDescription:
      "Select the time window for availability calculations.",
    submitButtonText: "View Availability",
    onSuccess: ({ navigate }) => {
      navigate({ to: "/resources" });
    },
  });
}

export const Route = createFileRoute("/_app/tasks/viewteamavailability/$projectId")({
  component: ViewTeamAvailabilityTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function ViewTeamAvailabilityTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "viewTeamAvailability" }
  );

  if (workItem === undefined) {
    return <SpinningLoader />;
  }

  // No active work item for this task - redirect to projects page
  if (workItem === null) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          This task is not currently available for this project.
        </p>
        <Navigate to="/projects" />
      </div>
    );
  }

  const Component = ViewTeamAvailabilityTaskComponentFactory(projectId);

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
