/**
 * Check More Billing Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-checkmorebilling.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@repo/ui/components/card";
import {
  RotateCcw,
  Loader2,
  AlertTriangle,
  Clock,
  Receipt,
  Flag,
  RefreshCw,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export const Route = createFileRoute("/_app/tasks/checkmorebilling/$projectId")(
  {
    component: CheckMoreBillingTask,
  }
);

function CheckMoreBillingTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "checkMoreBilling" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Billing check complete</h3>
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
      <CheckMoreBillingTaskForm
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

function CheckMoreBillingTaskForm({
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

  // Get uninvoiced items
  const uninvoicedItems = useQuery(
    api.workflows.dealToDelivery.api.invoices.getUninvoicedItems,
    { projectId }
  );

  // Get project for budget info
  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  // Get uninvoiced milestones
  const uninvoicedMilestones = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjectUninvoicedMilestones,
    { projectId }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        args: { name: "checkMoreBilling" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "checkMoreBilling" as const,
          payload: {
            projectId,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to complete check."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const timeCount = uninvoicedItems?.timeEntries?.length ?? 0;
  const expenseCount = uninvoicedItems?.expenses?.length ?? 0;
  const milestoneCount = uninvoicedMilestones?.length ?? 0;
  const hasRetainer = project?.budget?.type === "Retainer";

  const hasUninvoicedItems =
    timeCount > 0 || expenseCount > 0 || milestoneCount > 0;

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<RotateCcw className="h-8 w-8 text-blue-500" />}
      title="Check More Billing"
      description="Review uninvoiced items and continue billing"
      formTitle="Billing Status"
      formDescription="Review what items remain to be invoiced."
      onSubmit={handleSubmit}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Continue"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(_isStarted) => (
        <div className="space-y-4">
          {/* Uninvoiced Items Summary */}
          <div className="grid grid-cols-2 gap-4">
            <Card className={timeCount > 0 ? "border-amber-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      timeCount > 0 ? "bg-amber-100" : "bg-muted"
                    }`}
                  >
                    <Clock
                      className={`h-5 w-5 ${
                        timeCount > 0 ? "text-amber-600" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{timeCount}</p>
                    <p className="text-sm text-muted-foreground">Time Entries</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={expenseCount > 0 ? "border-amber-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      expenseCount > 0 ? "bg-amber-100" : "bg-muted"
                    }`}
                  >
                    <Receipt
                      className={`h-5 w-5 ${
                        expenseCount > 0
                          ? "text-amber-600"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{expenseCount}</p>
                    <p className="text-sm text-muted-foreground">Expenses</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={milestoneCount > 0 ? "border-amber-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      milestoneCount > 0 ? "bg-amber-100" : "bg-muted"
                    }`}
                  >
                    <Flag
                      className={`h-5 w-5 ${
                        milestoneCount > 0
                          ? "text-amber-600"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{milestoneCount}</p>
                    <p className="text-sm text-muted-foreground">Milestones</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={hasRetainer ? "border-teal-200" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      hasRetainer ? "bg-teal-100" : "bg-muted"
                    }`}
                  >
                    <RefreshCw
                      className={`h-5 w-5 ${
                        hasRetainer ? "text-teal-600" : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-lg font-bold">
                      {hasRetainer ? "Active" : "None"}
                    </p>
                    <p className="text-sm text-muted-foreground">Retainer</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status Message */}
          {hasUninvoicedItems ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                <strong>Uninvoiced items found.</strong> The workflow will route
                to the appropriate invoicing task based on project configuration.
              </p>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800">
                <strong>All caught up!</strong> No uninvoiced items remain for
                this billing cycle.
              </p>
            </div>
          )}

          {/* Help Text */}
          <p className="text-sm text-muted-foreground">
            Click "Continue" to proceed. The workflow will automatically determine
            the next step based on what needs to be billed.
          </p>
        </div>
      )}
    </TaskFormLayout>
  );
}
