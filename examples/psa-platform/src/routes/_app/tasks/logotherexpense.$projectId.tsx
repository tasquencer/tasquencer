/**
 * Log Other Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-logotherexpense.md
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
import { Card, CardContent } from "@repo/ui/components/card";
import { MoreHorizontal, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const logOtherExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().optional(),
  date: z.number(),
  category: z.string().optional(),
  vendor: z.string().optional(),
  notes: z.string().optional(),
});

type LogOtherExpenseFormValues = z.infer<typeof logOtherExpenseSchema>;

export const Route = createFileRoute("/_app/tasks/logotherexpense/$projectId")({
  component: LogOtherExpenseTask,
});

function LogOtherExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "logOtherExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense logged</h3>
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
      <LogOtherExpenseTaskForm
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

function LogOtherExpenseTaskForm({
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

  const form = useForm<LogOtherExpenseFormValues>({
    resolver: zodResolver(logOtherExpenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      currency: "USD",
      date: Date.now(),
      category: "",
      vendor: "",
      notes: "",
    },
  });

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
        args: {
          name: "logOtherExpense" as const,
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

  const handleSubmit = async (values: LogOtherExpenseFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "logOtherExpense" as const,
          payload: {
            projectId,
            description: values.description,
            amount: Math.round(values.amount * 100), // Convert to cents
            currency: values.currency ?? "USD",
            date: values.date,
            category: values.category || undefined,
            vendor: values.vendor || undefined,
            notes: values.notes || undefined,
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
      icon={<MoreHorizontal className="h-8 w-8 text-gray-500" />}
      title="Log Other Expense"
      description="Record a miscellaneous expense"
      formTitle="Expense Details"
      formDescription="Enter the details of your expense."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Log Expense"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              placeholder="e.g., Conference registration fee"
              {...form.register("description")}
              disabled={!isStarted}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-500">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (USD) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...form.register("amount", { valueAsNumber: true })}
                disabled={!isStarted}
              />
              {form.formState.errors.amount && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.amount.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={new Date(form.watch("date")).toISOString().split("T")[0]}
                onChange={(e) =>
                  form.setValue("date", new Date(e.target.value).getTime())
                }
                disabled={!isStarted}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              placeholder="e.g., Training, Events, Subscriptions"
              {...form.register("category")}
              disabled={!isStarted}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Input
              id="vendor"
              placeholder="e.g., Company name or merchant"
              {...form.register("vendor")}
              disabled={!isStarted}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional details about this expense..."
              {...form.register("notes")}
              disabled={!isStarted}
              rows={3}
            />
          </div>

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to log the expense.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
