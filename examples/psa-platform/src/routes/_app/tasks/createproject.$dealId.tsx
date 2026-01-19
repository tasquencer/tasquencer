/**
 * Create Project Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses dealId (domain ID) for navigation.
 * The workItemId is looked up from the deal for workflow execution.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Checkbox } from "@repo/ui/components/checkbox";
import { FolderPlus } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  confirmed: z.boolean().refine((val) => val === true, {
    message: "You must confirm the project creation to proceed",
  }),
});

const CreateProjectTaskComponent = createPsaTaskComponent({
  workflowTaskName: "createProject",
  schema,
  getDefaultValues: () => ({
    confirmed: false,
  }),
  mapSubmit: ({ task }) => ({
    payload: {
      dealId: task.aggregateTableId,
    },
  }),
  renderForm: ({ form, deal, isStarted }) => (
    <>
      <div className="rounded-lg border bg-muted/50 p-4 mb-4 space-y-2">
        <h4 className="text-sm font-medium">Project Setup Summary</h4>
        <p className="text-sm text-muted-foreground">
          This will create a new project from the won deal and initialize the
          project budget from the approved estimate.
        </p>
        {deal && (
          <p className="text-sm text-muted-foreground">
            Deal: <span className="font-medium text-foreground">{deal.name}</span>
          </p>
        )}
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="confirmed"
          checked={form.watch("confirmed") === true}
          onCheckedChange={(checked) =>
            form.setValue("confirmed", checked === true)
          }
          disabled={!isStarted}
        />
        <div className="space-y-1">
          <Label htmlFor="confirmed" className="font-medium">
            I confirm creating a project for this deal
          </Label>
          <p className="text-sm text-muted-foreground">
            The project will start in Planning status and can be adjusted later.
          </p>
        </div>
      </div>
      {form.formState.errors.confirmed && (
        <p className="text-sm text-destructive">
          {form.formState.errors.confirmed.message}
        </p>
      )}
    </>
  ),
  icon: <FolderPlus className="h-8 w-8 text-purple-500" />,
  title: "Create Project",
  description: "Initialize a project from the won deal",
  formTitle: "Project Initialization",
  formDescription:
    "Confirm creation of a new project using the deal and estimate details.",
  submitButtonText: "Create Project",
  onSuccess: ({ navigate }) => {
    navigate({ to: "/projects" });
  },
});

export const Route = createFileRoute("/_app/tasks/createproject/$dealId")({
  component: CreateProjectTask,
});

/**
 * Route component that looks up workItemId from dealId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (dealId) for routing, looks up workItemId for execution.
 */
function CreateProjectTask() {
  const { dealId } = Route.useParams() as { dealId: Id<"deals"> };

  // Look up the work item from the deal ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByDealAndType,
    { dealId, taskType: "createProject" }
  );

  // Loading state
  if (workItem === undefined) {
    return <SpinningLoader />;
  }

  // No active work item for this task - redirect to projects page
  if (workItem === null) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          This task is not currently available for this deal.
        </p>
        <Navigate to="/projects" />
      </div>
    );
  }

  return (
    <Suspense fallback={<SpinningLoader />}>
      <CreateProjectTaskComponent workItemId={workItem.workItemId} />
    </Suspense>
  );
}
