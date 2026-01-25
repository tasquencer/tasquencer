/**
 * Close Project Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
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
import { FolderCheck, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  completedSuccessfully: z.boolean(),
  clientSatisfactionRating: z.coerce
    .number()
    .min(1)
    .max(5, "Rating must be between 1 and 5"),
  archiveAfterClose: z.boolean(),
  closureNotes: z.string().min(10, "Closure notes must be at least 10 characters"),
});

function CloseProjectTaskComponentFactory(onRedirectStart?: () => void) {
  return createPsaTaskComponent({
    workflowTaskName: "closeProject",
  schema,
  getDefaultValues: () => ({
    completedSuccessfully: true,
    clientSatisfactionRating: 4,
    archiveAfterClose: false,
    closureNotes: "",
  }),
  mapSubmit: ({ values, task }) => ({
    payload: {
      completedSuccessfully: values.completedSuccessfully,
      clientSatisfactionRating: values.clientSatisfactionRating,
      archiveAfterClose: values.archiveAfterClose,
      closureNotes: values.closureNotes,
      dealId: task.aggregateTableId,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/50 p-4 mb-4">
        <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
          Pre-Closure Checklist
        </h4>
        <p className="text-sm text-yellow-700 dark:text-yellow-300">
          Before closing this project, ensure that:
        </p>
        <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside mt-2 space-y-1">
          <li>All tasks are marked as Done or On Hold</li>
          <li>All time entries are approved</li>
          <li>All expenses are approved</li>
          <li>All billable items have been invoiced (recommended)</li>
          <li>All invoices have been paid (recommended)</li>
        </ul>
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="completedSuccessfully"
          checked={form.watch("completedSuccessfully")}
          onCheckedChange={(checked) =>
            form.setValue("completedSuccessfully", checked === true)
          }
          disabled={!isStarted}
        />
        <div className="space-y-1">
          <Label htmlFor="completedSuccessfully" className="font-medium">
            Project completed successfully
          </Label>
          <p className="text-sm text-muted-foreground">
            Check if the project met its objectives and deliverables
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="clientSatisfactionRating">
          Client Satisfaction Rating
        </Label>
        <Select
          value={String(form.watch("clientSatisfactionRating"))}
          onValueChange={(v) =>
            form.setValue("clientSatisfactionRating", parseInt(v, 10))
          }
          disabled={!isStarted}
        >
          <SelectTrigger id="clientSatisfactionRating">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5 - Exceptional</SelectItem>
            <SelectItem value="4">4 - Very Satisfied</SelectItem>
            <SelectItem value="3">3 - Satisfied</SelectItem>
            <SelectItem value="2">2 - Somewhat Dissatisfied</SelectItem>
            <SelectItem value="1">1 - Very Dissatisfied</SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.clientSatisfactionRating && (
          <p className="text-sm text-destructive">
            {form.formState.errors.clientSatisfactionRating.message}
          </p>
        )}
      </div>

      <div className="flex items-start space-x-3">
        <Checkbox
          id="archiveAfterClose"
          checked={form.watch("archiveAfterClose")}
          onCheckedChange={(checked) =>
            form.setValue("archiveAfterClose", checked === true)
          }
          disabled={!isStarted}
        />
        <div className="space-y-1">
          <Label htmlFor="archiveAfterClose" className="font-medium">
            Archive project after closing
          </Label>
          <p className="text-sm text-muted-foreground">
            Move the project to archived status (can be restored later)
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="closureNotes">Closure Notes</Label>
        <Textarea
          id="closureNotes"
          placeholder="Enter notes about project completion, deliverables, and any final observations..."
          rows={4}
          {...form.register("closureNotes")}
          disabled={!isStarted}
        />
        {form.formState.errors.closureNotes && (
          <p className="text-sm text-destructive">
            {form.formState.errors.closureNotes.message}
          </p>
        )}
      </div>
    </>
  ),
  icon: <FolderCheck className="h-8 w-8 text-gray-500" />,
  title: "Close Project",
  description: "Finalize the project and record closure information",
  formTitle: "Project Closure Form",
  formDescription:
    "Complete the project closure checklist and record final project status.",
    submitButtonText: "Close Project",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: "/projects" });
    },
  });
}

export const Route = createFileRoute(
  "/_app/tasks/closeproject/$projectId"
)({
  component: CloseProjectTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function CloseProjectTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "closeProject" }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Project closed</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to projects...
          </p>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (workItem === undefined) {
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

  const Component = CloseProjectTaskComponentFactory(
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
