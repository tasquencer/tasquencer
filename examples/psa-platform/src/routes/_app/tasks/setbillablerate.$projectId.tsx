/**
 * Set Billable Rate Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-setbillablerate.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id, Doc } from "@/convex/_generated/dataModel";
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
import { Badge } from "@repo/ui/components/badge";
import { Percent, Loader2, AlertTriangle, AlertCircle, Shield } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/lib/utils";

// Markup limits per spec
const STANDARD_MARKUP_LIMIT = 1.5; // 50% markup (1.5x cost)
const MAX_MARKUP_LIMIT = 2.0; // 100% markup (2.0x cost)

const setBillableRateSchema = z.object({
  expenseId: z.string().min(1, "Expense selection is required"),
  markupRate: z.number().min(1.0, "Markup must be at least 1.0 (no markup)"),
  hasManagerOverride: z.boolean().optional(),
});

type SetBillableRateFormValues = z.infer<typeof setBillableRateSchema>;

export const Route = createFileRoute("/_app/tasks/setbillablerate/$projectId")({
  component: SetBillableRateTask,
});

function SetBillableRateTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "setBillableRate" }
  );

  const currentUser = useQuery(
    api.workflows.dealToDelivery.api.organizations.getCurrentUser
  );

  // Get billable draft expenses for current user
  const expenses = useQuery(
    api.workflows.dealToDelivery.api.expenses.listExpenses,
    currentUser
      ? {
          projectId,
          userId: currentUser._id,
          status: "Draft",
        }
      : "skip"
  );

  // Filter to only billable expenses
  const billableExpenses = expenses?.filter((e) => e.billable === true) ?? [];

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Billable rate set</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (
    project === undefined ||
    workItem === undefined ||
    currentUser === undefined ||
    expenses === undefined
  ) {
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
      <SetBillableRateTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        expenses={billableExpenses}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function SetBillableRateTaskForm({
  workItemId,
  projectId,
  expenses,
  onRedirect,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  projectId: Id<"projects">;
  expenses: Doc<"expenses">[];
  onRedirect: () => void;
}) {
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Default to most recent expense
  const defaultExpenseId = expenses[0]?._id ?? "";

  const form = useForm<SetBillableRateFormValues>({
    resolver: zodResolver(setBillableRateSchema),
    defaultValues: {
      expenseId: defaultExpenseId,
      markupRate: 1.0, // No markup by default
      hasManagerOverride: false,
    },
  });

  if (!task) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Task details unavailable.
      </div>
    );
  }

  const selectedExpenseId = form.watch("expenseId");
  const selectedExpense = expenses.find((e) => e._id === selectedExpenseId);
  const markupRate = form.watch("markupRate");

  // Check if user has manager approval scope (users don't have scopes field directly, simplified check)
  const hasApproveScope = false; // TODO: Check user's role/scopes via API

  // Calculate markup percentage and amount
  const markupPercentage = ((markupRate - 1) * 100).toFixed(0);
  const originalAmount = selectedExpense?.amount ?? 0;
  const billableAmount = Math.round(originalAmount * markupRate);

  // Check if markup exceeds limits
  const exceedsStandardLimit = markupRate > STANDARD_MARKUP_LIMIT;
  const exceedsMaxLimit = markupRate > MAX_MARKUP_LIMIT;
  const requiresOverride = exceedsStandardLimit && !exceedsMaxLimit;

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "setBillableRate" as const,
        },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: SetBillableRateFormValues) => {
    // Validate markup limits
    if (values.markupRate > MAX_MARKUP_LIMIT) {
      setErrorMessage("Markup cannot exceed 100% (rate of 2.0).");
      return;
    }

    if (
      values.markupRate > STANDARD_MARKUP_LIMIT &&
      !values.hasManagerOverride
    ) {
      setErrorMessage(
        "Markup over 50% requires manager override to be checked."
      );
      return;
    }

    if (
      values.markupRate > STANDARD_MARKUP_LIMIT &&
      values.hasManagerOverride &&
      !hasApproveScope
    ) {
      setErrorMessage(
        "You need expense approval permissions to apply manager override."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "setBillableRate" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            markupRate: values.markupRate,
            hasManagerOverride: values.hasManagerOverride ?? false,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit task."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Percent className="h-8 w-8 text-indigo-500" />}
      title="Set Billable Rate"
      description="Set the markup rate for billable expenses"
      formTitle="Markup Rate"
      formDescription="Configure the markup to apply to this expense when billing."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Save Rate"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Billable Expense *</Label>
            <Select
              value={form.watch("expenseId")}
              onValueChange={(v) => form.setValue("expenseId", v)}
              disabled={!isStarted}
            >
              <SelectTrigger id="expenseId">
                <SelectValue placeholder="Select an expense..." />
              </SelectTrigger>
              <SelectContent>
                {expenses.map((expense) => (
                  <SelectItem key={expense._id} value={expense._id}>
                    {expense.description} - {formatCurrency(expense.amount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {expenses.length === 0 && (
              <p className="text-sm text-amber-600">
                No billable draft expenses available.
              </p>
            )}
          </div>

          {selectedExpense && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{selectedExpense.description}</h4>
                <Badge variant="outline">{selectedExpense.type}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cost Amount</span>
                <span className="font-medium">
                  {formatCurrency(selectedExpense.amount)}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="markupRate">Markup Rate *</Label>
            <Input
              id="markupRate"
              type="number"
              step="0.05"
              min="1.0"
              max="2.0"
              {...form.register("markupRate", { valueAsNumber: true })}
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              1.0 = no markup, 1.25 = 25% markup, 1.5 = 50% markup, 2.0 = 100%
              markup (max)
            </p>
            {form.formState.errors.markupRate && (
              <p className="text-sm text-red-500">
                {form.formState.errors.markupRate.message}
              </p>
            )}
          </div>

          {selectedExpense && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <h4 className="font-medium">Billing Preview</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Cost</span>
                  <p className="font-medium">
                    {formatCurrency(originalAmount)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Markup</span>
                  <p className="font-medium">{markupPercentage}%</p>
                </div>
                <div className="col-span-2 pt-2 border-t">
                  <span className="text-muted-foreground">
                    Billable Amount
                  </span>
                  <p className="text-lg font-semibold">
                    {formatCurrency(billableAmount)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {exceedsMaxLimit && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-red-800 dark:text-red-200">
                    Exceeds Maximum
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Markup cannot exceed 100% (rate of 2.0).
                  </p>
                </div>
              </div>
            </div>
          )}

          {requiresOverride && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800 dark:text-amber-200">
                      Exceeds Standard Limit
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Markup over 50% requires manager approval.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-3 rounded-lg border p-4">
                <Checkbox
                  id="hasManagerOverride"
                  checked={form.watch("hasManagerOverride")}
                  onCheckedChange={(checked) =>
                    form.setValue("hasManagerOverride", checked === true)
                  }
                  disabled={!isStarted || !hasApproveScope}
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="hasManagerOverride"
                    className="font-medium cursor-pointer flex items-center gap-2"
                  >
                    <Shield className="h-4 w-4 text-blue-500" />
                    Manager Override
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {hasApproveScope
                      ? "I have approval authority for this markup."
                      : "You do not have expense approval permissions."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to set the billable rate.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
