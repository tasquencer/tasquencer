/**
 * Log Subcontractor Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-logsubcontractorexpense.md
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
import { Users, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Tax ID is required for subcontractor expenses over $600
const TAX_ID_THRESHOLD = 60000; // $600 in cents

const logSubcontractorExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().optional(),
  date: z.number(),
  vendorName: z.string().min(1, "Vendor name is required"),
  vendorCompany: z.string().optional(),
  vendorEmail: z.string().email().optional().or(z.literal("")),
  vendorTaxId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  workPeriodStart: z.number().optional(),
  workPeriodEnd: z.number().optional(),
  deliverables: z.string().optional(),
  notes: z.string().optional(),
});

type LogSubcontractorExpenseFormValues = z.infer<
  typeof logSubcontractorExpenseSchema
>;

export const Route = createFileRoute(
  "/_app/tasks/logsubcontractorexpense/$projectId"
)({
  component: LogSubcontractorExpenseTask,
});

function LogSubcontractorExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "logSubcontractorExpense" }
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
      <LogSubcontractorExpenseTaskForm
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

function LogSubcontractorExpenseTaskForm({
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

  const form = useForm<LogSubcontractorExpenseFormValues>({
    resolver: zodResolver(logSubcontractorExpenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      currency: "USD",
      date: Date.now(),
      vendorName: "",
      vendorCompany: "",
      vendorEmail: "",
      vendorTaxId: "",
      invoiceNumber: "",
      deliverables: "",
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
  const requiresTaxId = amountInCents > TAX_ID_THRESHOLD;
  const vendorTaxId = form.watch("vendorTaxId");
  const missingTaxId = requiresTaxId && !vendorTaxId;

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "logSubcontractorExpense" as const,
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

  const handleSubmit = async (values: LogSubcontractorExpenseFormValues) => {
    // Validate Tax ID requirement
    const amountCents = Math.round(values.amount * 100);
    if (amountCents > TAX_ID_THRESHOLD && !values.vendorTaxId) {
      setErrorMessage(
        "Tax ID is required for subcontractor expenses over $600."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "logSubcontractorExpense" as const,
          payload: {
            projectId,
            description: values.description,
            amount: Math.round(values.amount * 100), // Convert to cents
            currency: values.currency ?? "USD",
            date: values.date,
            vendorName: values.vendorName,
            vendorCompany: values.vendorCompany || undefined,
            vendorEmail: values.vendorEmail || undefined,
            vendorTaxId: values.vendorTaxId || undefined,
            invoiceNumber: values.invoiceNumber || undefined,
            workPeriodStart: values.workPeriodStart,
            workPeriodEnd: values.workPeriodEnd,
            deliverables: values.deliverables || undefined,
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
      icon={<Users className="h-8 w-8 text-purple-500" />}
      title="Log Subcontractor Expense"
      description="Record a subcontractor or freelancer invoice"
      formTitle="Subcontractor Expense Details"
      formDescription="Enter the details of the subcontractor invoice."
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
              placeholder="e.g., UI/UX Design Services - January 2024"
              {...form.register("description")}
              disabled={!isStarted}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-500">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <h4 className="font-medium">Vendor Information</h4>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorName">Vendor Name *</Label>
                <Input
                  id="vendorName"
                  placeholder="e.g., John Smith"
                  {...form.register("vendorName")}
                  disabled={!isStarted}
                />
                {form.formState.errors.vendorName && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.vendorName.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorCompany">Company</Label>
                <Input
                  id="vendorCompany"
                  placeholder="e.g., Smith Design LLC"
                  {...form.register("vendorCompany")}
                  disabled={!isStarted}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorEmail">Email</Label>
                <Input
                  id="vendorEmail"
                  type="email"
                  placeholder="vendor@example.com"
                  {...form.register("vendorEmail")}
                  disabled={!isStarted}
                />
                {form.formState.errors.vendorEmail && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.vendorEmail.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorTaxId">
                  Tax ID (EIN/SSN) {requiresTaxId && "*"}
                </Label>
                <Input
                  id="vendorTaxId"
                  placeholder="XX-XXXXXXX"
                  {...form.register("vendorTaxId")}
                  disabled={!isStarted}
                />
              </div>
            </div>
          </div>

          {missingTaxId && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-amber-800 dark:text-amber-200">
                    Tax ID Required
                  </h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    IRS requires a W-9 / Tax ID for subcontractor payments over
                    $600.
                  </p>
                </div>
              </div>
            </div>
          )}

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
              <Label htmlFor="invoiceNumber">Invoice Number</Label>
              <Input
                id="invoiceNumber"
                placeholder="e.g., INV-2024-001"
                {...form.register("invoiceNumber")}
                disabled={!isStarted}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Invoice Date *</Label>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workPeriodStart">Work Period Start</Label>
              <Input
                id="workPeriodStart"
                type="date"
                value={
                  form.watch("workPeriodStart")
                    ? new Date(form.watch("workPeriodStart")!)
                        .toISOString()
                        .split("T")[0]
                    : ""
                }
                onChange={(e) =>
                  form.setValue(
                    "workPeriodStart",
                    e.target.value
                      ? new Date(e.target.value).getTime()
                      : undefined
                  )
                }
                disabled={!isStarted}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workPeriodEnd">Work Period End</Label>
              <Input
                id="workPeriodEnd"
                type="date"
                value={
                  form.watch("workPeriodEnd")
                    ? new Date(form.watch("workPeriodEnd")!)
                        .toISOString()
                        .split("T")[0]
                    : ""
                }
                onChange={(e) =>
                  form.setValue(
                    "workPeriodEnd",
                    e.target.value
                      ? new Date(e.target.value).getTime()
                      : undefined
                  )
                }
                disabled={!isStarted}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deliverables">Deliverables</Label>
            <Textarea
              id="deliverables"
              placeholder="Describe the work or deliverables provided..."
              {...form.register("deliverables")}
              disabled={!isStarted}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes..."
              {...form.register("notes")}
              disabled={!isStarted}
              rows={2}
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
