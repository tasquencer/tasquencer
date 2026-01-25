/**
 * Attach Receipt Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-attachreceipt.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
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
  FileImage,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Upload,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/lib/utils";

// Receipt is required for expenses > $25 (2500 cents) or subcontractor expenses
const RECEIPT_THRESHOLD = 2500;

const attachReceiptSchema = z.object({
  expenseId: z.string().min(1, "Expense selection is required"),
  receiptUrl: z.string().optional(),
  noReceiptReason: z.string().optional(),
});

type AttachReceiptFormValues = z.infer<typeof attachReceiptSchema>;

export const Route = createFileRoute("/_app/tasks/attachreceipt/$projectId")({
  component: AttachReceiptTask,
});

function AttachReceiptTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "attachReceipt" }
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
          <h3 className="text-lg font-medium">Receipt attached</h3>
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
      <AttachReceiptTaskForm
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

function AttachReceiptTaskForm({
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

  const form = useForm<AttachReceiptFormValues>({
    resolver: zodResolver(attachReceiptSchema),
    defaultValues: {
      expenseId: defaultExpenseId,
      receiptUrl: "",
      noReceiptReason: "",
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
  const receiptUrl = form.watch("receiptUrl");
  const noReceiptReason = form.watch("noReceiptReason");

  // Check if receipt is required
  const requiresReceipt = selectedExpense
    ? selectedExpense.amount > RECEIPT_THRESHOLD ||
      selectedExpense.type === "Subcontractor"
    : false;

  const hasReceipt = !!receiptUrl;
  const hasReason = !!noReceiptReason;
  const canSubmit = hasReceipt || (requiresReceipt ? hasReason : true);

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "attachReceipt" as const,
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

  const handleSubmit = async (values: AttachReceiptFormValues) => {
    // Validate receipt requirement
    const expense = expenses.find((e) => e._id === values.expenseId);
    if (expense) {
      const needsReceipt =
        expense.amount > RECEIPT_THRESHOLD ||
        expense.type === "Subcontractor";
      if (needsReceipt && !values.receiptUrl && !values.noReceiptReason) {
        setErrorMessage(
          "Receipt or reason for no receipt is required for expenses over $25 or subcontractor expenses."
        );
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "attachReceipt" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            receiptUrl: values.receiptUrl || undefined,
            noReceiptReason: values.noReceiptReason || undefined,
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
      icon={<FileImage className="h-8 w-8 text-green-500" />}
      title="Attach Receipt"
      description="Upload receipt evidence for your expense"
      formTitle="Receipt Upload"
      formDescription="Attach a receipt or provide a reason if one is not available."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={canSubmit ? "Save Receipt" : "Receipt Required"}
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
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{selectedExpense.description}</h4>
                <Badge variant="outline">{selectedExpense.type}</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">
                  {formatCurrency(selectedExpense.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span>
                  {new Date(selectedExpense.date).toLocaleDateString()}
                </span>
              </div>
              {selectedExpense.receiptUrl && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-green-600">
                    Receipt already attached
                  </p>
                </div>
              )}
            </div>
          )}

          {requiresReceipt && !hasReceipt && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-amber-800 dark:text-amber-200">
                    Receipt Required
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedExpense?.type === "Subcontractor"
                      ? "Subcontractor expenses require a receipt or invoice."
                      : "Expenses over $25 require a receipt. If unavailable, please provide a reason."}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="receiptUrl">
              Receipt URL {requiresReceipt && !hasReason && "*"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="receiptUrl"
                placeholder="https://storage.example.com/receipts/..."
                {...form.register("receiptUrl")}
                disabled={!isStarted}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Upload your receipt (PDF, PNG, JPG) and paste the URL here.
            </p>
          </div>

          <div className="rounded-lg border border-dashed p-6 text-center">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              File upload coming soon. For now, please upload to your preferred
              storage and paste the URL above.
            </p>
          </div>

          {requiresReceipt && (
            <div className="space-y-2">
              <Label htmlFor="noReceiptReason">
                Reason for No Receipt {!hasReceipt && "*"}
              </Label>
              <Textarea
                id="noReceiptReason"
                placeholder="Explain why a receipt is not available..."
                {...form.register("noReceiptReason")}
                disabled={!isStarted || !!receiptUrl}
                rows={2}
              />
            </div>
          )}

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to attach a receipt.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
