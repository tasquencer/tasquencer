/**
 * Mark Billable Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-markbillable.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
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
import { Badge } from "@repo/ui/components/badge";
import { DollarSign, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/lib/utils";

const markBillableSchema = z.object({
  expenseId: z.string().min(1, "Expense selection is required"),
  billable: z.boolean(),
  billableReason: z.string().optional(),
});

type MarkBillableFormValues = z.infer<typeof markBillableSchema>;

export const Route = createFileRoute("/_app/tasks/markbillable/$projectId")({
  component: MarkBillableTask,
});

function MarkBillableTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "markBillable" }
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
          <h3 className="text-lg font-medium">Billable status updated</h3>
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
      <MarkBillableTaskForm
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

function MarkBillableTaskForm({
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

  const form = useForm<MarkBillableFormValues>({
    resolver: zodResolver(markBillableSchema),
    defaultValues: {
      expenseId: defaultExpenseId,
      billable: true,
      billableReason: "",
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
  const isBillable = form.watch("billable");

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "markBillable" as const,
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

  const handleSubmit = async (values: MarkBillableFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "markBillable" as const,
          payload: {
            expenseId: values.expenseId as Id<"expenses">,
            billable: values.billable,
            billableReason: values.billableReason || undefined,
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
      icon={<DollarSign className="h-8 w-8 text-emerald-500" />}
      title="Mark Billable"
      description="Set whether the expense is billable to the client"
      formTitle="Billable Status"
      formDescription="Choose whether this expense should be billed to the client."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Save Status"
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
              {selectedExpense.billable !== undefined && (
                <div className="pt-2 border-t flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Current Status</span>
                  <Badge
                    variant={selectedExpense.billable ? "default" : "secondary"}
                  >
                    {selectedExpense.billable ? "Billable" : "Non-Billable"}
                  </Badge>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center space-x-3 rounded-lg border p-4">
            <Checkbox
              id="billable"
              checked={form.watch("billable")}
              onCheckedChange={(checked) =>
                form.setValue("billable", checked === true)
              }
              disabled={!isStarted}
            />
            <div className="space-y-1">
              <Label htmlFor="billable" className="font-medium cursor-pointer">
                Bill this expense to the client
              </Label>
              <p className="text-sm text-muted-foreground">
                {isBillable
                  ? "The expense amount will be included on the client invoice."
                  : "The expense will be absorbed as an internal cost."}
              </p>
            </div>
          </div>

          {!isBillable && (
            <div className="space-y-2">
              <Label htmlFor="billableReason">Reason for Non-Billable</Label>
              <Textarea
                id="billableReason"
                placeholder="Explain why this expense is not billable to the client..."
                {...form.register("billableReason")}
                disabled={!isStarted}
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Optional, but helpful for audit trail.
              </p>
            </div>
          )}

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to set billable status.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
