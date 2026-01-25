/**
 * Record Payment Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-recordpayment.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useMemo } from "react";
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
import { CreditCard, Loader2, AlertTriangle, AlertCircle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const PAYMENT_METHODS = [
  { value: "Check", label: "Check" },
  { value: "ACH", label: "ACH / Bank Transfer" },
  { value: "Wire", label: "Wire Transfer" },
  { value: "CreditCard", label: "Credit Card" },
  { value: "Cash", label: "Cash" },
  { value: "Other", label: "Other" },
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

const recordPaymentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  method: z.enum(["Check", "ACH", "Wire", "CreditCard", "Cash", "Other"]),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type RecordPaymentFormValues = z.infer<typeof recordPaymentSchema>;

export const Route = createFileRoute("/_app/tasks/recordpayment/$projectId")({
  component: RecordPaymentTask,
});

function RecordPaymentTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "recordPayment" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Payment recorded</h3>
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
      <RecordPaymentTaskForm
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

function RecordPaymentTaskForm({
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

  // Get sent invoices for this project (Sent or Viewed status) - first find the ID
  const sentInvoices = useQuery(
    api.workflows.dealToDelivery.api.invoices.listInvoices,
    { projectId, status: "Sent" }
  );
  const sentInvoiceId = sentInvoices?.[0]?._id ?? null;

  // Then get full invoice with payments
  const sentInvoice = useQuery(
    api.workflows.dealToDelivery.api.invoices.getInvoice,
    sentInvoiceId ? { invoiceId: sentInvoiceId } : "skip"
  );

  // Calculate total paid from payments array
  const totalPaid = useMemo(() => {
    if (!sentInvoice?.payments) return 0;
    return sentInvoice.payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
  }, [sentInvoice?.payments]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<RecordPaymentFormValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      method: "Check",
      reference: "",
      notes: "",
    },
  });

  const paymentAmount = form.watch("amount");

  // Calculate if this is an overpayment
  const overpaymentAmount = useMemo(() => {
    if (!sentInvoice) return 0;
    const amountInCents = Math.round(paymentAmount * 100);
    const remaining = sentInvoice.total - totalPaid;
    return Math.max(0, amountInCents - remaining);
  }, [paymentAmount, sentInvoice, totalPaid]);

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
        args: { name: "recordPayment" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: RecordPaymentFormValues) => {
    if (!sentInvoice) {
      setErrorMessage("No sent invoice found.");
      return;
    }

    if (values.amount <= 0) {
      setErrorMessage("Payment amount must be greater than zero.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "recordPayment" as const,
          payload: {
            invoiceId: sentInvoice._id,
            amount: Math.round(values.amount * 100),
            date: new Date(values.date).getTime(),
            method: values.method,
            reference: values.reference || undefined,
            notes: values.notes || undefined,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to record payment."
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

  const remainingBalance = sentInvoice
    ? sentInvoice.total - totalPaid
    : 0;

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<CreditCard className="h-8 w-8 text-green-500" />}
      title="Record Payment"
      description="Record a payment against an invoice"
      formTitle="Payment Details"
      formDescription="Enter the payment information."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Record Payment"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Invoice Summary */}
          {sentInvoice ? (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Invoice #{sentInvoice.number ?? "Sent"}
                  </span>
                  <Badge variant="secondary">
                    {sentInvoice.status === "Sent" ? "Sent" : "Viewed"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(sentInvoice.total)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Paid:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(totalPaid)}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Remaining:</span>{" "}
                    <span className="font-medium text-amber-600">
                      {formatCurrency(remainingBalance)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No sent invoice found for this project.
            </p>
          )}

          {/* Payment Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              Payment Amount ($) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              {...form.register("amount", { valueAsNumber: true })}
              disabled={!isStarted}
              placeholder="0.00"
            />
            {remainingBalance > 0 && (
              <p className="text-xs text-muted-foreground">
                Remaining balance: {formatCurrency(remainingBalance)}
              </p>
            )}
          </div>

          {/* Overpayment Warning */}
          {overpaymentAmount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800 font-medium">
                  Overpayment Warning
                </p>
                <p className="text-sm text-amber-700">
                  This payment exceeds the remaining balance by{" "}
                  {formatCurrency(overpaymentAmount)}.
                </p>
              </div>
            </div>
          )}

          {/* Payment Date */}
          <div className="space-y-2">
            <Label htmlFor="date">
              Payment Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="date"
              type="date"
              {...form.register("date")}
              disabled={!isStarted}
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label htmlFor="method">
              Payment Method <span className="text-red-500">*</span>
            </Label>
            <Select
              value={form.watch("method")}
              onValueChange={(v) => form.setValue("method", v as PaymentMethod)}
              disabled={!isStarted}
            >
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reference Number */}
          <div className="space-y-2">
            <Label htmlFor="reference">Reference Number (optional)</Label>
            <Input
              id="reference"
              {...form.register("reference")}
              placeholder="e.g., Check #1234"
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              Check number, transaction ID, or other reference
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Additional notes about this payment..."
              disabled={!isStarted}
              rows={2}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
