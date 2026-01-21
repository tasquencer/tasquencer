/**
 * Revise Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-reviseexpense.md
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
import { Edit3, Loader2, AlertTriangle, Receipt } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const EXPENSE_TYPES = ["Software", "Travel", "Materials", "Subcontractor", "Other"] as const;

const reviseExpenseSchema = z.object({
  expenseId: z.string().min(1, "Select an expense to revise"),
  resubmit: z.boolean(),
  revisions: z.object({
    amount: z.number().positive().optional(),
    billable: z.boolean().optional(),
    date: z.number().optional(),
    description: z.string().optional(),
    markupRate: z.number().min(1).max(2).optional(),
    notes: z.string().optional(),
    receiptUrl: z.string().optional(),
    type: z.enum(EXPENSE_TYPES).optional(),
  }),
});

type ReviseExpenseFormValues = z.infer<typeof reviseExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/reviseexpense/$projectId")({
  component: ReviseExpenseTask,
});

function ReviseExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviseExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Revisions submitted</h3>
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
      <ReviseExpenseTaskForm
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

function ReviseExpenseTaskForm({
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

  // Get rejected expenses for this project
  const expenses = useQuery(api.workflows.dealToDelivery.api.expenses.listExpenses, {
    projectId,
    status: "Rejected",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ReviseExpenseFormValues>({
    resolver: zodResolver(reviseExpenseSchema),
    defaultValues: {
      expenseId: "",
      resubmit: true,
      revisions: {},
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
        args: { name: "reviseExpense" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: ReviseExpenseFormValues) => {
    if (!values.expenseId) {
      setErrorMessage("Please select an expense to revise.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Filter out undefined values from revisions
      const filteredRevisions: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values.revisions)) {
        if (value !== undefined && value !== "") {
          filteredRevisions[key] = value;
        }
      }

      await completeWorkItem({
        workItemId,
        args: {
          name: "reviseExpense" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            resubmit: values.resubmit,
            revisions: filteredRevisions,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit revisions."
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
      icon={<Edit3 className="h-8 w-8 text-orange-500" />}
      title="Revise Expense"
      description="Edit rejected expense and optionally resubmit"
      formTitle="Expense Revision"
      formDescription="Make corrections to the rejected expense."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Submit Revisions"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Expense Selector */}
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Expense to Revise</Label>
            <Select
              value={form.watch("expenseId")}
              onValueChange={(v) => form.setValue("expenseId", v)}
              disabled={!isStarted}
            >
              <SelectTrigger id="expenseId">
                <SelectValue placeholder="Select a rejected expense..." />
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

          {/* Expense Details and Revision Form */}
          {selectedExpense && (
            <Card className="border-orange-200">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{selectedExpense.type}</span>
                  <Badge variant="destructive">Rejected</Badge>
                </div>

                {selectedExpense.rejectionComments && (
                  <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    <strong>Rejection reason:</strong>{" "}
                    {selectedExpense.rejectionComments}
                  </div>
                )}

                {/* Editable Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      defaultValue={selectedExpense.type}
                      onValueChange={(v) =>
                        form.setValue("revisions.type", v as typeof EXPENSE_TYPES[number])
                      }
                      disabled={!isStarted}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPENSE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={(selectedExpense.amount / 100).toFixed(2)}
                      onChange={(e) =>
                        form.setValue(
                          "revisions.amount",
                          Math.round(parseFloat(e.target.value) * 100) || undefined
                        )
                      }
                      disabled={!isStarted}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      defaultValue={new Date(selectedExpense.date).toISOString().split("T")[0]}
                      onChange={(e) =>
                        form.setValue(
                          "revisions.date",
                          new Date(e.target.value).getTime()
                        )
                      }
                      disabled={!isStarted}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Checkbox
                      id="revisionsBillable"
                      defaultChecked={selectedExpense.billable}
                      onCheckedChange={(checked: boolean) =>
                        form.setValue("revisions.billable", checked)
                      }
                      disabled={!isStarted}
                    />
                    <Label htmlFor="revisionsBillable" className="text-sm">
                      Billable
                    </Label>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    defaultValue={selectedExpense.description || ""}
                    onChange={(e) =>
                      form.setValue("revisions.description", e.target.value)
                    }
                    disabled={!isStarted}
                    rows={2}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Receipt URL</Label>
                  <Input
                    type="url"
                    defaultValue={selectedExpense.receiptUrl || ""}
                    placeholder="https://..."
                    onChange={(e) =>
                      form.setValue("revisions.receiptUrl", e.target.value)
                    }
                    disabled={!isStarted}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    defaultValue={selectedExpense.notes || ""}
                    onChange={(e) =>
                      form.setValue("revisions.notes", e.target.value)
                    }
                    disabled={!isStarted}
                    rows={2}
                    placeholder="Additional notes..."
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resubmit Toggle */}
          <div className="flex items-center gap-3 py-2 border-t pt-4">
            <Checkbox
              id="resubmit"
              checked={form.watch("resubmit")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("resubmit", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="resubmit">Resubmit for Approval</Label>
              <p className="text-xs text-muted-foreground">
                Send revised expense back for manager approval
              </p>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
