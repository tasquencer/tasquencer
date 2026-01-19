/**
 * Filter By Skills/Role Task Route - Domain-First Routing
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
import { Filter } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const filterSchema = z
  .object({
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    skills: z.string().optional(),
    roles: z.string().optional(),
    departments: z.string().optional(),
    locations: z.string().optional(),
    minAvailability: z.string().optional(),
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

const parseCsv = (value?: string) =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

function FilterBySkillsRoleTaskComponentFactory(projectId: Id<"projects">) {
  return createPsaTaskComponent({
    workflowTaskName: "filterBySkillsRole",
    schema: filterSchema,
    getDefaultValues: () => ({
      startDate: getDefaultDate(0),
      endDate: getDefaultDate(14),
      skills: "",
      roles: "",
      departments: "",
      locations: "",
      minAvailability: "",
    }),
    mapSubmit: ({ values }) => {
      const filters: {
        skills?: string[];
        roles?: string[];
        departments?: string[];
        locations?: string[];
        minAvailability?: number;
      } = {};

      const skills = parseCsv(values.skills);
      const roles = parseCsv(values.roles);
      const departments = parseCsv(values.departments);
      const locations = parseCsv(values.locations);
      const minAvailabilityValue = values.minAvailability?.trim();
      const minAvailability = minAvailabilityValue
        ? Number(minAvailabilityValue)
        : undefined;

      if (skills?.length) filters.skills = skills;
      if (roles?.length) filters.roles = roles;
      if (departments?.length) filters.departments = departments;
      if (locations?.length) filters.locations = locations;
      if (minAvailabilityValue && Number.isFinite(minAvailability)) {
        filters.minAvailability = minAvailability;
      }

      return {
        payload: {
          projectId,
          startDate: new Date(values.startDate).getTime(),
          endDate: new Date(values.endDate).getTime(),
          filters,
        },
      };
    },
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

        <div className="grid gap-2">
          <Label htmlFor="skills">Skills (comma-separated)</Label>
          <Input
            id="skills"
            placeholder="React, TypeScript, UX"
            {...form.register("skills")}
            disabled={!isStarted}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="roles">Roles (comma-separated)</Label>
          <Input
            id="roles"
            placeholder="Designer, Engineer, PM"
            {...form.register("roles")}
            disabled={!isStarted}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="departments">Departments (comma-separated)</Label>
          <Input
            id="departments"
            placeholder="Engineering, Product"
            {...form.register("departments")}
            disabled={!isStarted}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="locations">Locations (comma-separated)</Label>
          <Input
            id="locations"
            placeholder="NYC, Remote"
            {...form.register("locations")}
            disabled={!isStarted}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="minAvailability">Minimum Availability (hours)</Label>
          <Input
            id="minAvailability"
            type="number"
            min="0"
            step="1"
            placeholder="8"
            {...form.register("minAvailability")}
            disabled={!isStarted}
          />
        </div>
      </>
    ),
    icon: <Filter className="h-8 w-8 text-cyan-500" />,
    title: "Filter by Skills/Role",
    description: "Narrow the team list for resource planning",
    formTitle: "Filter Criteria",
    formDescription: "Provide any filters you want applied to availability.",
    submitButtonText: "Apply Filters",
    onSuccess: ({ navigate }) => {
      navigate({ to: "/resources" });
    },
  });
}

export const Route = createFileRoute(
  "/_app/tasks/filterbyskillsrole/$projectId"
)({
  component: FilterBySkillsRoleTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function FilterBySkillsRoleTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "filterBySkillsRole" }
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

  const Component = FilterBySkillsRoleTaskComponentFactory(projectId);

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
