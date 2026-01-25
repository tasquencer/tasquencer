/**
 * Submit Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-submitexpense.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import {
  Send,
  Loader2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  FileImage,
  DollarSign,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/lib/utils";

// Receipt is required for expenses > $25 (2500 cents) or subcontractor expenses
const RECEIPT_THRESHOLD = 2500;

// Expenses older than 90 days are blocked
const MAX_AGE_DAYS = 90;

const submitExpenseSchema = z.object({
  expenseId: z.string().min(1, "Expense selection is required"),
});

type SubmitExpenseFormValues = z.infer<typeof submitExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/submitexpense/$projectId")({
  component: SubmitExpenseTask,
});

function SubmitExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "submitExpense" }
  );

  const currentUser = useQuery(
    api.workflows.dealToDelivery.api.organizations.getCurrentUser
  );

  // Get draft expenses for current user
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

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense submitted</h3>
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
      <SubmitExpenseTaskForm
        workItemId={workItem.workItemId}
        projectId={projectId}
        expenses={expenses}
        onRedirect={() => {
          setIsRedirecting(true);
          navigate({ to: `/projects/${projectId}` });
        }}
      />
    </Suspense>
  );
}

function SubmitExpenseTaskForm({
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

  const form = useForm<SubmitExpenseFormValues>({
    resolver: zodResolver(submitExpenseSchema),
    defaultValues: {
      expenseId: defaultExpenseId,
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

  // Check expense requirements
  const requiresReceipt = selectedExpense
    ? selectedExpense.amount > RECEIPT_THRESHOLD ||
      selectedExpense.type === "Subcontractor"
    : false;

  const hasReceipt = !!selectedExpense?.receiptUrl;
  const hasNoReceiptReason = !!selectedExpense?.noReceiptReason;
  const receiptSatisfied = hasReceipt || hasNoReceiptReason || !requiresReceipt;

  // Check age limit
  const expenseAge = selectedExpense
    ? Math.floor((Date.now() - selectedExpense.date) / (1000 * 60 * 60 * 24))
    : 0;
  const isTooOld = expenseAge > MAX_AGE_DAYS;

  const canSubmit = receiptSatisfied && !isTooOld;

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "submitExpense" as const,
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

  const handleSubmit = async (values: SubmitExpenseFormValues) => {
    const expense = expenses.find((e) => e._id === values.expenseId);

    if (!expense) {
      setErrorMessage("Expense not found.");
      return;
    }

    // Validate receipt requirement
    const needsReceipt =
      expense.amount > RECEIPT_THRESHOLD ||
      expense.type === "Subcontractor";
    if (
      needsReceipt &&
      !expense.receiptUrl &&
      !expense.noReceiptReason
    ) {
      setErrorMessage(
        "Receipt or reason is required for expenses over $25 or subcontractor expenses."
      );
      return;
    }

    // Validate age limit
    const age = Math.floor(
      (Date.now() - expense.date) / (1000 * 60 * 60 * 24)
    );
    if (age > MAX_AGE_DAYS) {
      setErrorMessage(
        `Expenses older than ${MAX_AGE_DAYS} days cannot be submitted.`
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "submitExpense" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
          },
        },
      });

      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit expense."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Send className="h-8 w-8 text-blue-500" />}
      title="Submit Expense"
      description="Submit an expense for approval"
      formTitle="Submit for Approval"
      formDescription="Review and submit your expense for manager approval."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={canSubmit ? "Submit Expense" : "Cannot Submit"}
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Expense *</Label>
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
                No draft expenses available.
              </p>
            )}
          </div>

          {selectedExpense && (
            <>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">{selectedExpense.description}</h4>
                  <Badge variant="outline">{selectedExpense.type}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Amount</span>
                    <p className="font-medium">
                      {formatCurrency(selectedExpense.amount)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date</span>
                    <p>
                      {new Date(selectedExpense.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t space-y-2">
                  <h5 className="text-sm font-medium">Status Checks</h5>

                  <div className="flex items-center gap-2 text-sm">
                    {receiptSatisfied ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    <FileImage className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {hasReceipt
                        ? "Receipt attached"
                        : hasNoReceiptReason
                          ? "No-receipt reason provided"
                          : requiresReceipt
                            ? "Receipt required"
                            : "Receipt not required"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    {!isTooOld ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span>
                      {isTooOld
                        ? `Expense is ${expenseAge} days old (max ${MAX_AGE_DAYS})`
                        : `Expense is ${expenseAge} days old`}
                    </span>
                  </div>

                  {selectedExpense.billable !== undefined && (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {selectedExpense.billable
                          ? "Marked as billable"
                          : "Marked as non-billable"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {!canSubmit && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-red-800 dark:text-red-200">
                        Cannot Submit
                      </h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {isTooOld
                          ? `This expense is older than ${MAX_AGE_DAYS} days and cannot be submitted.`
                          : "Please attach a receipt or provide a reason before submitting."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to submit the expense.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
