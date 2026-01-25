/**
 * Approve Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-approveexpense.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { CheckCircle2, Loader2, AlertTriangle, Receipt } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const approveExpenseSchema = z.object({
  expenseId: z.string().min(1, "Select an expense to approve"),
  approvalNotes: z.string().optional(),
  finalBillable: z.boolean().optional(),
  finalMarkup: z.number().min(1).max(2).optional(),
});

type ApproveExpenseFormValues = z.infer<typeof approveExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/approveexpense/$projectId")({
  component: ApproveExpenseTask,
});

function ApproveExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "approveExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense approved</h3>
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
      <ApproveExpenseTaskForm
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

function ApproveExpenseTaskForm({
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

  const expenses = useQuery(api.workflows.dealToDelivery.api.expenses.listExpenses, {
    projectId,
    status: "Submitted",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ApproveExpenseFormValues>({
    resolver: zodResolver(approveExpenseSchema),
    defaultValues: {
      expenseId: "",
      approvalNotes: "",
    },
  });

  const selectedExpenseId = form.watch("expenseId");
  const selectedExpense = expenses?.find((e) => e._id === selectedExpenseId);

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
        args: { name: "approveExpense" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: ApproveExpenseFormValues) => {
    if (!values.expenseId) {
      setErrorMessage("Please select an expense to approve.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "approveExpense" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            approvalNotes: values.approvalNotes || undefined,
            finalBillable: values.finalBillable,
            finalMarkup: values.finalMarkup,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to approve expense."
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
      icon={<CheckCircle2 className="h-8 w-8 text-green-500" />}
      title="Approve Expense"
      description="Approve expense with optional overrides"
      formTitle="Expense Approval"
      formDescription="Select an expense and apply any overrides."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Approve Expense"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Expense Selector */}
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Expense to Approve</Label>
            <Select
              value={form.watch("expenseId")}
              onValueChange={(v) => form.setValue("expenseId", v)}
              disabled={!isStarted}
            >
              <SelectTrigger id="expenseId">
                <SelectValue placeholder="Select an expense..." />
              </SelectTrigger>
              <SelectContent>
                {expenses?.map((expense) => (
                  <SelectItem key={expense._id} value={expense._id}>
                    {expense.type} - {formatCurrency(expense.amount)} -{" "}
                    {new Date(expense.date).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Expense Details */}
          {selectedExpense && (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{selectedExpense.type}</span>
                  <Badge variant="outline">{selectedExpense.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(selectedExpense.amount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>{" "}
                    {new Date(selectedExpense.date).toLocaleDateString()}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Billable:</span>{" "}
                    {selectedExpense.billable ? "Yes" : "No"}
                  </div>
                  {selectedExpense.markupRate && (
                    <div>
                      <span className="text-muted-foreground">Markup:</span>{" "}
                      {((selectedExpense.markupRate - 1) * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
                {selectedExpense.description && (
                  <p className="text-sm">{selectedExpense.description}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Optional Overrides */}
          {selectedExpense && (
            <div className="space-y-4 border-t pt-4">
              <Label>Optional Overrides</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="finalBillable"
                    checked={form.watch("finalBillable") ?? selectedExpense.billable}
                    onCheckedChange={(checked: boolean) =>
                      form.setValue("finalBillable", checked)
                    }
                    disabled={!isStarted}
                  />
                  <Label htmlFor="finalBillable" className="text-sm">
                    Billable
                  </Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Final Markup Rate</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    max="2"
                    placeholder="1.0 - 2.0"
                    defaultValue={selectedExpense.markupRate || 1}
                    onChange={(e) =>
                      form.setValue(
                        "finalMarkup",
                        parseFloat(e.target.value) || undefined
                      )
                    }
                    disabled={!isStarted}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Approval Notes */}
          <div className="space-y-2">
            <Label htmlFor="approvalNotes">Approval Notes (optional)</Label>
            <Textarea
              id="approvalNotes"
              {...form.register("approvalNotes")}
              placeholder="Add notes about this approval..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
