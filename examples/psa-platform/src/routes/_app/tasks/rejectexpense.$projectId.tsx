/**
 * Reject Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-rejectexpense.md
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { XCircle, Loader2, AlertTriangle, Receipt, Plus, X } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const ISSUE_TYPES = [
  { value: "missing_receipt", label: "Missing Receipt" },
  { value: "wrong_category", label: "Wrong Category" },
  { value: "invalid_amount", label: "Invalid Amount" },
  { value: "missing_vendor_info", label: "Missing Vendor Info" },
  { value: "not_project_related", label: "Not Project Related" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
] as const;

type IssueType = typeof ISSUE_TYPES[number]["value"];

const issueSchema = z.object({
  type: z.enum(["missing_receipt", "wrong_category", "invalid_amount", "missing_vendor_info", "not_project_related", "duplicate", "other"]),
  details: z.string().min(1, "Details required"),
});

const rejectExpenseSchema = z.object({
  expenseId: z.string().min(1, "Select an expense to reject"),
  rejectionReason: z.string().min(1, "Rejection reason is required"),
  issues: z.array(issueSchema).optional(),
});

type RejectExpenseFormValues = z.infer<typeof rejectExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/rejectexpense/$projectId")({
  component: RejectExpenseTask,
});

function RejectExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "rejectExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense rejected</h3>
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
      <RejectExpenseTaskForm
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

function RejectExpenseTaskForm({
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
  const [issues, setIssues] = useState<{ type: IssueType; details: string }[]>([]);
  const [newIssueType, setNewIssueType] = useState<IssueType>("other");
  const [newIssueDetails, setNewIssueDetails] = useState("");

  const form = useForm<RejectExpenseFormValues>({
    resolver: zodResolver(rejectExpenseSchema),
    defaultValues: {
      expenseId: "",
      rejectionReason: "",
      issues: [],
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
        args: { name: "rejectExpense" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const addIssue = () => {
    if (newIssueDetails.trim()) {
      setIssues([...issues, { type: newIssueType, details: newIssueDetails.trim() }]);
      setNewIssueDetails("");
    }
  };

  const removeIssue = (index: number) => {
    setIssues(issues.filter((_, i) => i !== index));
  };

  const handleSubmit = async (values: RejectExpenseFormValues) => {
    if (!values.expenseId) {
      setErrorMessage("Please select an expense to reject.");
      return;
    }

    if (!values.rejectionReason || values.rejectionReason.trim() === "") {
      setErrorMessage("Rejection reason is required.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "rejectExpense" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            rejectionReason: values.rejectionReason.trim(),
            issues: issues,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to reject expense."
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
      icon={<XCircle className="h-8 w-8 text-red-500" />}
      title="Reject Expense"
      description="Reject expense with reason and issue tags"
      formTitle="Expense Rejection"
      formDescription="Select an expense, provide a reason, and tag specific issues."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Reject Expense"
      submitButtonVariant="destructive"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Expense Selector */}
          <div className="space-y-2">
            <Label htmlFor="expenseId">Select Expense to Reject</Label>
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
                </div>
                {selectedExpense.description && (
                  <p className="text-sm">{selectedExpense.description}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Rejection Reason */}
          <div className="space-y-2">
            <Label htmlFor="rejectionReason">
              Rejection Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="rejectionReason"
              {...form.register("rejectionReason")}
              placeholder="Explain why this expense is being rejected..."
              disabled={!isStarted}
              rows={3}
            />
            {form.formState.errors.rejectionReason && (
              <p className="text-sm text-destructive">
                {form.formState.errors.rejectionReason.message}
              </p>
            )}
          </div>

          {/* Issue Tags */}
          <div className="space-y-2 border-t pt-4">
            <Label>Issue Tags (optional)</Label>

            {/* Current Issues */}
            {issues.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {issues.map((issue, index) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1">
                    {ISSUE_TYPES.find(t => t.value === issue.type)?.label}: {issue.details}
                    <button
                      type="button"
                      onClick={() => removeIssue(index)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Add Issue Form */}
            {isStarted && (
              <div className="flex gap-2">
                <Select
                  value={newIssueType}
                  onValueChange={(v) => setNewIssueType(v as IssueType)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Issue details..."
                  value={newIssueDetails}
                  onChange={(e) => setNewIssueDetails(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="icon" onClick={addIssue}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
