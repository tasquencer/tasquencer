/**
 * Invoice Fixed Fee Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-invoicefixedfee.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Card, CardContent } from "@repo/ui/components/card";
import { DollarSign, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const invoiceFixedFeeSchema = z.object({
  description: z.string().min(1, "Description is required"),
  invoiceAmount: z.number().positive("Amount must be positive").optional(),
  percentageOfBudget: z.number().min(1).max(100).optional(),
  includeExpenses: z.boolean(),
});

type InvoiceFixedFeeFormValues = z.infer<typeof invoiceFixedFeeSchema>;

export const Route = createFileRoute("/_app/tasks/invoicefixedfee/$projectId")({
  component: InvoiceFixedFeeTask,
});

function InvoiceFixedFeeTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "invoiceFixedFee" }
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
      <InvoiceFixedFeeTaskForm
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

function InvoiceFixedFeeTaskForm({
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
  const [usePercentage, setUsePercentage] = useState(false);

  const budget = project.budget;
  const remainingBudget = budget
    ? budget.totalAmount - (project.metrics?.budgetUsed ?? 0)
    : 0;

  const form = useForm<InvoiceFixedFeeFormValues>({
    resolver: zodResolver(invoiceFixedFeeSchema),
    defaultValues: {
      description: "",
      includeExpenses: false,
    },
  });

  const calculatedAmount = useMemo(() => {
    if (usePercentage && budget) {
      const percentage = form.watch("percentageOfBudget") ?? 0;
      return Math.round((budget.totalAmount * percentage) / 100);
    }
    return (form.watch("invoiceAmount") ?? 0) * 100;
  }, [usePercentage, form.watch("percentageOfBudget"), form.watch("invoiceAmount"), budget]);

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
        args: { name: "invoiceFixedFee" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: InvoiceFixedFeeFormValues) => {
    if (!values.description) {
      setErrorMessage("Description is required.");
      return;
    }

    const amount = usePercentage
      ? undefined
      : Math.round((values.invoiceAmount ?? 0) * 100);
    const percentage = usePercentage ? values.percentageOfBudget : undefined;

    if (!amount && !percentage) {
      setErrorMessage("Please enter an amount or percentage.");
      return;
    }

    if (amount && amount > remainingBudget) {
      setErrorMessage("Amount exceeds remaining budget.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "invoiceFixedFee" as const,
          payload: {
            projectId,
            description: values.description,
            invoiceAmount: amount,
            percentageOfBudget: percentage,
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
      icon={<DollarSign className="h-8 w-8 text-green-500" />}
      title="Invoice Fixed Fee"
      description="Create a fixed fee invoice"
      formTitle="Fixed Fee Invoice"
      formDescription="Enter the amount or percentage of budget to invoice."
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
          {/* Budget Context */}
          {budget && (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Budget:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(budget.totalAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Remaining:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(remainingBudget)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="description"
              {...form.register("description")}
              placeholder="Describe what this invoice is for..."
              disabled={!isStarted}
              rows={3}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          {/* Amount Type Toggle */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="usePercentage"
              checked={usePercentage}
              onCheckedChange={(checked: boolean) => setUsePercentage(checked)}
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="usePercentage">Use Percentage of Budget</Label>
              <p className="text-xs text-muted-foreground">
                Calculate amount as a percentage of total budget
              </p>
            </div>
          </div>

          {/* Amount Input */}
          {!usePercentage ? (
            <div className="space-y-2">
              <Label htmlFor="invoiceAmount">Invoice Amount ($)</Label>
              <Input
                id="invoiceAmount"
                type="number"
                step="0.01"
                min="0.01"
                {...form.register("invoiceAmount", { valueAsNumber: true })}
                disabled={!isStarted}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Maximum: {formatCurrency(remainingBudget)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="percentageOfBudget">Percentage of Budget (%)</Label>
              <Input
                id="percentageOfBudget"
                type="number"
                min="1"
                max="100"
                {...form.register("percentageOfBudget", { valueAsNumber: true })}
                disabled={!isStarted}
                placeholder="e.g., 25"
              />
              {calculatedAmount > 0 && (
                <p className="text-sm text-muted-foreground">
                  = {formatCurrency(calculatedAmount)}
                </p>
              )}
            </div>
          )}

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
