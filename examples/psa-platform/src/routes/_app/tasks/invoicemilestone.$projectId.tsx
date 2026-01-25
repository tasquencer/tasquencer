/**
 * Invoice Milestone Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-invoicemilestone.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { Flag, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const invoiceMilestoneSchema = z.object({
  milestoneId: z.string().min(1, "Select a milestone"),
  completionDate: z.string().optional(),
  includeExpenses: z.boolean(),
});

type InvoiceMilestoneFormValues = z.infer<typeof invoiceMilestoneSchema>;

export const Route = createFileRoute("/_app/tasks/invoicemilestone/$projectId")(
  {
    component: InvoiceMilestoneTask,
  }
);

function InvoiceMilestoneTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "invoiceMilestone" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Invoice draft created</h3>
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
      <InvoiceMilestoneTaskForm
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

function InvoiceMilestoneTaskForm({
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

  // Get uninvoiced milestones for this project
  const uninvoicedMilestones = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjectUninvoicedMilestones,
    { projectId }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const milestones = uninvoicedMilestones ?? [];

  const form = useForm<InvoiceMilestoneFormValues>({
    resolver: zodResolver(invoiceMilestoneSchema),
    defaultValues: {
      milestoneId: "",
      completionDate: new Date().toISOString().split("T")[0],
      includeExpenses: false,
    },
  });

  const selectedMilestoneId = form.watch("milestoneId");
  const selectedMilestone = milestones.find((m: { _id: string }) => m._id === selectedMilestoneId);

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
        args: { name: "invoiceMilestone" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: InvoiceMilestoneFormValues) => {
    if (!values.milestoneId) {
      setErrorMessage("Please select a milestone.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "invoiceMilestone" as const,
          payload: {
            projectId,
            milestoneId: values.milestoneId as Id<"milestones">,
            completionDate: values.completionDate
              ? new Date(values.completionDate).getTime()
              : undefined,
            includeExpenses: values.includeExpenses,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create invoice."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount / 100);
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Flag className="h-8 w-8 text-purple-500" />}
      title="Invoice Milestone"
      description="Create an invoice for a completed milestone"
      formTitle="Milestone Invoice"
      formDescription="Select a milestone to invoice upon completion."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Create Invoice Draft"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Milestone Selector */}
          <div className="space-y-2">
            <Label htmlFor="milestoneId">Select Milestone</Label>
            {milestones.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
                No uninvoiced milestones available.
              </p>
            ) : (
              <Select
                value={form.watch("milestoneId")}
                onValueChange={(v) => form.setValue("milestoneId", v)}
                disabled={!isStarted}
              >
                <SelectTrigger id="milestoneId">
                  <SelectValue placeholder="Select a milestone..." />
                </SelectTrigger>
                <SelectContent>
                  {milestones.map((milestone) => (
                    <SelectItem key={milestone._id} value={milestone._id}>
                      {milestone.name} - {formatCurrency(milestone.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Selected Milestone Details */}
          {selectedMilestone && (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Flag className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selectedMilestone.name}</span>
                  <Badge variant="outline">Uninvoiced</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(selectedMilestone.amount)}
                    </span>
                  </div>
                  {selectedMilestone.dueDate && (
                    <div>
                      <span className="text-muted-foreground">Due Date:</span>{" "}
                      {new Date(selectedMilestone.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completion Date */}
          <div className="space-y-2">
            <Label htmlFor="completionDate">Completion Date (optional)</Label>
            <Input
              id="completionDate"
              type="date"
              {...form.register("completionDate")}
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              Date the milestone was completed. Defaults to today if not provided.
            </p>
          </div>

          {/* Include Expenses */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="includeExpenses"
              checked={form.watch("includeExpenses")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("includeExpenses", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="includeExpenses">Include Expenses</Label>
              <p className="text-xs text-muted-foreground">
                Add approved expenses to the invoice
              </p>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
