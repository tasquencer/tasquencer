/**
 * Review Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-reviewexpense.md
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
import { FileSearch, Loader2, AlertTriangle, Receipt } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const reviewExpenseSchema = z.object({
  expenseId: z.string().min(1, "Select an expense to review"),
  decision: z.enum(["approve", "reject"]),
  comments: z.string().optional(),
  adjustments: z.object({
    billable: z.boolean().optional(),
    category: z.string().optional(),
    markupRate: z.number().min(1).max(2).optional(),
  }).optional(),
});

type ReviewExpenseFormValues = z.infer<typeof reviewExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/reviewexpense/$projectId")({
  component: ReviewExpenseTask,
});

function ReviewExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviewExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Review submitted</h3>
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
      <ReviewExpenseTaskForm
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

function ReviewExpenseTaskForm({
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

  // Get submitted expenses for this project
  const expenses = useQuery(api.workflows.dealToDelivery.api.expenses.listExpenses, {
    projectId,
    status: "Submitted",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ReviewExpenseFormValues>({
    resolver: zodResolver(reviewExpenseSchema),
    defaultValues: {
      expenseId: "",
      decision: "approve",
      comments: "",
      adjustments: {},
    },
  });

  const selectedExpenseId = form.watch("expenseId");
  const selectedExpense = expenses?.find((e) => e._id === selectedExpenseId);
  const decision = form.watch("decision");

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
        args: { name: "reviewExpense" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: ReviewExpenseFormValues) => {
    if (!values.expenseId) {
      setErrorMessage("Please select an expense to review.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "reviewExpense" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            decision: values.decision,
            comments: values.comments || undefined,
            adjustments: values.adjustments,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit review."
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
      icon={<FileSearch className="h-8 w-8 text-blue-500" />}
      title="Review Expense"
      description="Review submitted expense and decide to approve or reject"
      formTitle="Expense Review"
      formDescription="Select an expense and make your decision."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Submit Review"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Expense Selector */}
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Expense to Review</Label>
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
                {selectedExpense.receiptUrl && (
                  <a
                    href={selectedExpense.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View Receipt
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Decision */}
          <div className="space-y-2">
            <Label htmlFor="decision">Decision</Label>
            <Select
              value={form.watch("decision")}
              onValueChange={(v) =>
                form.setValue("decision", v as "approve" | "reject")
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">Approve</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Adjustments (only show for approve) */}
          {decision === "approve" && selectedExpense && (
            <div className="space-y-4 border-t pt-4">
              <Label>Optional Adjustments</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="adjustBillable"
                    checked={form.watch("adjustments.billable") ?? selectedExpense.billable}
                    onCheckedChange={(checked: boolean) =>
                      form.setValue("adjustments.billable", checked)
                    }
                    disabled={!isStarted}
                  />
                  <Label htmlFor="adjustBillable" className="text-sm">
                    Billable
                  </Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Markup Rate</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    max="2"
                    placeholder="1.0 - 2.0"
                    defaultValue={selectedExpense.markupRate || 1}
                    onChange={(e) =>
                      form.setValue(
                        "adjustments.markupRate",
                        parseFloat(e.target.value) || undefined
                      )
                    }
                    disabled={!isStarted}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="space-y-2">
            <Label htmlFor="comments">
              Comments {decision === "reject" && "(recommended)"}
            </Label>
            <Textarea
              id="comments"
              {...form.register("comments")}
              placeholder="Optional review comments..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
