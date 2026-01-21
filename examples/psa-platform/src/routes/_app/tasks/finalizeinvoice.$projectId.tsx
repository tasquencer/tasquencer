/**
 * Finalize Invoice Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-finalizeinvoice.md
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
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const finalizeInvoiceSchema = z.object({
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

type FinalizeInvoiceFormValues = z.infer<typeof finalizeInvoiceSchema>;

export const Route = createFileRoute("/_app/tasks/finalizeinvoice/$projectId")({
  component: FinalizeInvoiceTask,
});

function FinalizeInvoiceTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "finalizeInvoice" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Invoice finalized</h3>
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
      <FinalizeInvoiceTaskForm
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

function FinalizeInvoiceTaskForm({
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

  // Get draft invoices for this project (first find the ID)
  const draftInvoices = useQuery(
    api.workflows.dealToDelivery.api.invoices.listInvoices,
    { projectId, status: "Draft" }
  );
  const draftInvoiceId = draftInvoices?.[0]?._id ?? null;

  // Then get full invoice with line items
  const draftInvoice = useQuery(
    api.workflows.dealToDelivery.api.invoices.getInvoice,
    draftInvoiceId ? { invoiceId: draftInvoiceId } : "skip"
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Default due date to 30 days from now
  const defaultDueDate = new Date();
  defaultDueDate.setDate(defaultDueDate.getDate() + 30);

  const form = useForm<FinalizeInvoiceFormValues>({
    resolver: zodResolver(finalizeInvoiceSchema),
    defaultValues: {
      dueDate: draftInvoice?.dueDate
        ? new Date(draftInvoice.dueDate).toISOString().split("T")[0]
        : defaultDueDate.toISOString().split("T")[0],
      notes: draftInvoice?.notes ?? "",
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
        args: { name: "finalizeInvoice" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: FinalizeInvoiceFormValues) => {
    if (!draftInvoice) {
      setErrorMessage("No draft invoice found.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "finalizeInvoice" as const,
          payload: {
            invoiceId: draftInvoice._id,
            dueDate: values.dueDate
              ? new Date(values.dueDate).getTime()
              : undefined,
            notes: values.notes || undefined,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to finalize invoice."
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
      title="Finalize Invoice"
      description="Complete and lock the invoice for sending"
      formTitle="Finalization"
      formDescription="Confirm the final details before locking the invoice."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Finalize Invoice"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Invoice Summary */}
          {draftInvoice ? (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Invoice #{draftInvoice.number ?? "Draft"}
                  </span>
                  <Badge variant="outline">Draft</Badge>
                </div>

                {/* Line Items Summary */}
                {draftInvoice.lineItems && draftInvoice.lineItems.length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    {draftInvoice.lineItems.map((item: { description: string; quantity: number; rate: number }, index: number) => (
                      <div
                        key={index}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {item.description}
                        </span>
                        <span>
                          {item.quantity} x {formatCurrency(item.rate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Totals */}
                <div className="border-t pt-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(draftInvoice.subtotal ?? draftInvoice.total)}</span>
                  </div>
                  {draftInvoice.discount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="text-green-600">
                        -{formatCurrency(draftInvoice.discount)}
                      </span>
                    </div>
                  )}
                  {draftInvoice.tax && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(draftInvoice.tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium pt-2 border-t">
                    <span>Total</span>
                    <span>{formatCurrency(draftInvoice.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No draft invoice found for this project.
            </p>
          )}

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> Once finalized, the invoice cannot be edited.
              Please review all details before proceeding.
            </p>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label htmlFor="dueDate">Due Date</Label>
            <Input
              id="dueDate"
              type="date"
              {...form.register("dueDate")}
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              When payment is expected
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Final Notes (optional)</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Any final notes to include on the invoice..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
