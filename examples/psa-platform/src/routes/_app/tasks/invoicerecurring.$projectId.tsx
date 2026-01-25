/**
 * Invoice Recurring Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-invoicerecurring.md
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
import { Card, CardContent } from "@repo/ui/components/card";
import { RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const invoiceRecurringSchema = z.object({
  billingPeriodStart: z.string().min(1, "Start date is required"),
  billingPeriodEnd: z.string().min(1, "End date is required"),
  retainerAmount: z.number().positive("Retainer amount must be positive"),
  includedHours: z.number().min(0).optional(),
  includeOverage: z.boolean(),
  overageRate: z.number().positive().optional(),
  rolloverUnused: z.boolean(),
});

type InvoiceRecurringFormValues = z.infer<typeof invoiceRecurringSchema>;

export const Route = createFileRoute("/_app/tasks/invoicerecurring/$projectId")(
  {
    component: InvoiceRecurringTask,
  }
);

function InvoiceRecurringTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "invoiceRecurring" }
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
      <InvoiceRecurringTaskForm
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

function InvoiceRecurringTaskForm({
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Default to first of current month to end of current month
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const form = useForm<InvoiceRecurringFormValues>({
    resolver: zodResolver(invoiceRecurringSchema),
    defaultValues: {
      billingPeriodStart: firstOfMonth.toISOString().split("T")[0],
      billingPeriodEnd: lastOfMonth.toISOString().split("T")[0],
      retainerAmount: 0,
      includeOverage: false,
      rolloverUnused: false,
    },
  });

  const includeOverage = form.watch("includeOverage");

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
        args: { name: "invoiceRecurring" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: InvoiceRecurringFormValues) => {
    if (values.retainerAmount <= 0) {
      setErrorMessage("Retainer amount is required.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "invoiceRecurring" as const,
          payload: {
            projectId,
            billingPeriod: {
              startDate: new Date(values.billingPeriodStart).getTime(),
              endDate: new Date(values.billingPeriodEnd).getTime(),
            },
            retainerAmount: Math.round(values.retainerAmount * 100),
            includedHours: values.includedHours,
            includeOverage: values.includeOverage,
            overageRate: values.overageRate
              ? Math.round(values.overageRate * 100)
              : undefined,
            rolloverUnused: values.rolloverUnused,
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

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<RefreshCw className="h-8 w-8 text-teal-500" />}
      title="Invoice Recurring"
      description="Create a recurring retainer invoice"
      formTitle="Retainer Invoice"
      formDescription="Configure the retainer billing period and amount."
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
          {/* Billing Period */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="billingPeriodStart">
                Period Start <span className="text-red-500">*</span>
              </Label>
              <Input
                id="billingPeriodStart"
                type="date"
                {...form.register("billingPeriodStart")}
                disabled={!isStarted}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billingPeriodEnd">
                Period End <span className="text-red-500">*</span>
              </Label>
              <Input
                id="billingPeriodEnd"
                type="date"
                {...form.register("billingPeriodEnd")}
                disabled={!isStarted}
              />
            </div>
          </div>

          {/* Retainer Amount */}
          <div className="space-y-2">
            <Label htmlFor="retainerAmount">
              Retainer Amount ($) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="retainerAmount"
              type="number"
              step="0.01"
              min="0.01"
              {...form.register("retainerAmount", { valueAsNumber: true })}
              disabled={!isStarted}
              placeholder="0.00"
            />
          </div>

          {/* Included Hours */}
          <div className="space-y-2">
            <Label htmlFor="includedHours">Included Hours (optional)</Label>
            <Input
              id="includedHours"
              type="number"
              step="0.25"
              min="0"
              {...form.register("includedHours", { valueAsNumber: true })}
              disabled={!isStarted}
              placeholder="e.g., 40"
            />
            <p className="text-xs text-muted-foreground">
              Number of hours included in the retainer
            </p>
          </div>

          {/* Include Overage */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="includeOverage"
              checked={form.watch("includeOverage")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("includeOverage", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="includeOverage">Include Overage Charges</Label>
              <p className="text-xs text-muted-foreground">
                Bill additional hours beyond the included amount
              </p>
            </div>
          </div>

          {/* Overage Rate (conditional) */}
          {includeOverage && (
            <div className="space-y-2 ml-6">
              <Label htmlFor="overageRate">Overage Rate ($/hr)</Label>
              <Input
                id="overageRate"
                type="number"
                step="0.01"
                min="0.01"
                {...form.register("overageRate", { valueAsNumber: true })}
                disabled={!isStarted}
                placeholder="e.g., 150.00"
              />
            </div>
          )}

          {/* Rollover Unused */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="rolloverUnused"
              checked={form.watch("rolloverUnused")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("rolloverUnused", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="rolloverUnused">Rollover Unused Hours</Label>
              <p className="text-xs text-muted-foreground">
                Carry forward unused hours to the next billing period
              </p>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
