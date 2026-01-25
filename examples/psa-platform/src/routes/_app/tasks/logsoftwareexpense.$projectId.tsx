/**
 * Log Software Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-logsoftwareexpense.md
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
import { Monitor, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const logSoftwareExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().optional(),
  date: z.number(),
  vendor: z.string().min(1, "Vendor is required"),
  licenseType: z.enum(["Perpetual", "Subscription", "OneTime"]),
  licensePeriodStart: z.number().optional(),
  licensePeriodEnd: z.number().optional(),
  users: z.number().optional(),
  notes: z.string().optional(),
});

type LogSoftwareExpenseFormValues = z.infer<typeof logSoftwareExpenseSchema>;

const LICENSE_TYPES = [
  { value: "Perpetual", label: "Perpetual License" },
  { value: "Subscription", label: "Subscription" },
  { value: "OneTime", label: "One-Time Purchase" },
];

// Policy limit for software expenses (in cents) - $5000
const SOFTWARE_POLICY_LIMIT = 500000;

export const Route = createFileRoute(
  "/_app/tasks/logsoftwareexpense/$projectId"
)({
  component: LogSoftwareExpenseTask,
});

function LogSoftwareExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "logSoftwareExpense" }
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
      <LogSoftwareExpenseTaskForm
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

function LogSoftwareExpenseTaskForm({
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

  const form = useForm<LogSoftwareExpenseFormValues>({
    resolver: zodResolver(logSoftwareExpenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      currency: "USD",
      date: Date.now(),
      vendor: "",
      licenseType: "Subscription",
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

  const watchedAmount = form.watch("amount");
  const amountInCents = Math.round(watchedAmount * 100);
  const exceedsPolicyLimit = amountInCents > SOFTWARE_POLICY_LIMIT;

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "logSoftwareExpense" as const,
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

  const handleSubmit = async (values: LogSoftwareExpenseFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "logSoftwareExpense" as const,
          payload: {
            projectId,
            description: values.description,
            amount: Math.round(values.amount * 100), // Convert to cents
            currency: values.currency ?? "USD",
            date: values.date,
            vendor: values.vendor,
            licenseType: values.licenseType,
            licensePeriodStart: values.licensePeriodStart,
            licensePeriodEnd: values.licensePeriodEnd,
            users: values.users,
            notes: values.notes,
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
      icon={<Monitor className="h-8 w-8 text-blue-500" />}
      title="Log Software Expense"
      description="Record a software license or subscription expense"
      formTitle="Software Expense Details"
      formDescription="Enter the details of the software expense."
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
              placeholder="e.g., Adobe Creative Cloud Annual License"
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

          {exceedsPolicyLimit && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-amber-800 dark:text-amber-200">
                    Policy Limit Warning
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    This expense exceeds the $5,000 software policy limit. Additional approval may be required.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor *</Label>
            <Input
              id="vendor"
              placeholder="e.g., Adobe, Microsoft, Atlassian"
              {...form.register("vendor")}
              disabled={!isStarted}
            />
            {form.formState.errors.vendor && (
              <p className="text-sm text-red-500">
                {form.formState.errors.vendor.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="licenseType">License Type *</Label>
            <Select
              value={form.watch("licenseType")}
              onValueChange={(v) =>
                form.setValue(
                  "licenseType",
                  v as "Perpetual" | "Subscription" | "OneTime"
                )
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="licenseType">
                <SelectValue placeholder="Select license type" />
              </SelectTrigger>
              <SelectContent>
                {LICENSE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.watch("licenseType") === "Subscription" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="licensePeriodStart">Period Start</Label>
                <Input
                  id="licensePeriodStart"
                  type="date"
                  value={
                    form.watch("licensePeriodStart")
                      ? new Date(form.watch("licensePeriodStart")!)
                          .toISOString()
                          .split("T")[0]
                      : ""
                  }
                  onChange={(e) =>
                    form.setValue(
                      "licensePeriodStart",
                      e.target.value ? new Date(e.target.value).getTime() : undefined
                    )
                  }
                  disabled={!isStarted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="licensePeriodEnd">Period End</Label>
                <Input
                  id="licensePeriodEnd"
                  type="date"
                  value={
                    form.watch("licensePeriodEnd")
                      ? new Date(form.watch("licensePeriodEnd")!)
                          .toISOString()
                          .split("T")[0]
                      : ""
                  }
                  onChange={(e) =>
                    form.setValue(
                      "licensePeriodEnd",
                      e.target.value ? new Date(e.target.value).getTime() : undefined
                    )
                  }
                  disabled={!isStarted}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="users">Number of Users/Seats</Label>
            <Input
              id="users"
              type="number"
              min="1"
              placeholder="1"
              {...form.register("users", { valueAsNumber: true })}
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
