/**
 * Select Invoicing Method Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-selectinvoicingmethod.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { FileText, Loader2, AlertTriangle, Clock, DollarSign, Flag, RefreshCw } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type InvoicingMethod = "TimeAndMaterials" | "FixedFee" | "Milestone" | "Recurring";

const INVOICING_METHODS = [
  {
    value: "TimeAndMaterials" as const,
    label: "Time & Materials",
    description: "Bill based on actual hours worked and expenses incurred",
    icon: Clock,
  },
  {
    value: "FixedFee" as const,
    label: "Fixed Fee",
    description: "Bill a predetermined amount or percentage of budget",
    icon: DollarSign,
  },
  {
    value: "Milestone" as const,
    label: "Milestone",
    description: "Bill upon completion of project milestones",
    icon: Flag,
  },
  {
    value: "Recurring" as const,
    label: "Recurring/Retainer",
    description: "Bill recurring retainer amounts with optional overage",
    icon: RefreshCw,
  },
];

export const Route = createFileRoute(
  "/_app/tasks/selectinvoicingmethod/$projectId"
)({
  component: SelectInvoicingMethodTask,
});

function SelectInvoicingMethodTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "selectInvoicingMethod" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Method selected</h3>
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
      <SelectInvoicingMethodTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        project={project}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function SelectInvoicingMethodTaskForm({
  workItemId,
  projectId,
  project,
  onRedirect,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  projectId: Id<"projects">;
  project: NonNullable<
    ReturnType<typeof useQuery<typeof api.workflows.dealToDelivery.api.projects.getProject>>
  >;
  onRedirect: () => void;
}) {
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<InvoicingMethod | null>(null);

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
        args: { name: "selectInvoicingMethod" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSelectMethod = async (method: InvoicingMethod) => {
    setSelectedMethod(method);
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "selectInvoicingMethod" as const,
          payload: {
            projectId,
            method,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to select method."
      );
      setSelectedMethod(null);
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
      icon={<FileText className="h-8 w-8 text-blue-500" />}
      title="Select Invoicing Method"
      description="Choose how to invoice this billing cycle"
      formTitle="Invoicing Method"
      formDescription="Select the invoicing method that best fits this project's billing needs."
      onSubmit={async () => {}}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText=""
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Budget Context */}
          {project.budget && (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Budget Type:</span>{" "}
                    <span className="font-medium">{project.budget.type}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Budget:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(project.budget.totalAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Consumed:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(project.metrics?.budgetUsed ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Remaining:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(project.metrics?.budgetRemaining ?? project.budget.totalAmount)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Method Selection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {INVOICING_METHODS.map((method) => {
              const Icon = method.icon;
              const isSelected = selectedMethod === method.value;
              return (
                <Card
                  key={method.value}
                  className={`cursor-pointer transition-all hover:border-primary ${
                    isSelected ? "border-primary bg-primary/5" : ""
                  } ${!isStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => {
                    if (isStarted && !isSubmitting) {
                      handleSelectMethod(method.value);
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{method.label}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{method.description}</CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {!project.budget && (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              ⚠️ Project must have a budget before invoicing. Please set up the
              budget first.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
