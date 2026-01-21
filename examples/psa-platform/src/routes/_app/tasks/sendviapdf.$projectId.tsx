/**
 * Send Invoice via PDF Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-sendviapdf.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Card, CardContent } from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { FileDown, Loader2, AlertTriangle, Download } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const sendViaPdfSchema = z.object({
  markAsSent: z.boolean(),
});

type SendViaPdfFormValues = z.infer<typeof sendViaPdfSchema>;

export const Route = createFileRoute("/_app/tasks/sendviapdf/$projectId")({
  component: SendViaPdfTask,
});

function SendViaPdfTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "sendViaPdf" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">PDF delivered</h3>
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
      <SendViaPdfTaskForm
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

function SendViaPdfTaskForm({
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

  // Get finalized invoices for this project
  const finalizedInvoices = useQuery(
    api.workflows.dealToDelivery.api.invoices.listInvoices,
    { projectId, status: "Finalized" }
  );
  const finalizedInvoice = finalizedInvoices?.[0] ?? null;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const form = useForm<SendViaPdfFormValues>({
    resolver: zodResolver(sendViaPdfSchema),
    defaultValues: {
      markAsSent: true,
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
        args: { name: "sendViaPdf" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleDownload = async () => {
    if (!finalizedInvoice) return;

    setIsDownloading(true);
    try {
      // In a real implementation, this would generate/download the PDF
      // For now, we simulate a download
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Create a mock PDF download
      const blob = new Blob(
        [`Invoice #${(finalizedInvoice.number ?? "INV")}\nTotal: $${(finalizedInvoice.total / 100).toFixed(2)}`],
        { type: "application/pdf" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${(finalizedInvoice.number ?? "INV")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage("Failed to download PDF.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSubmit = async (values: SendViaPdfFormValues) => {
    if (!finalizedInvoice) {
      setErrorMessage("No finalized invoice found.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "sendViaPdf" as const,
          payload: {
            invoiceId: finalizedInvoice._id,
            markAsSent: values.markAsSent,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to complete task."
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
      icon={<FileDown className="h-8 w-8 text-green-500" />}
      title="Send Invoice via PDF"
      description="Download the invoice PDF for manual delivery"
      formTitle="PDF Download"
      formDescription="Download the PDF and optionally mark as sent."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Complete Delivery"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Invoice Summary */}
          {finalizedInvoice ? (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">
                    Invoice #{(finalizedInvoice.number ?? "INV")}
                  </span>
                  <Badge variant="secondary">Finalized</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(finalizedInvoice.total)}
                    </span>
                  </div>
                  {finalizedInvoice.dueDate && (
                    <div>
                      <span className="text-muted-foreground">Due:</span>{" "}
                      {new Date(finalizedInvoice.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No finalized invoice found for this project.
            </p>
          )}

          {/* Download Button */}
          <div className="space-y-2">
            <Label>Download Invoice</Label>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleDownload}
              disabled={!isStarted || !finalizedInvoice || isDownloading}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Download the invoice PDF to send manually
            </p>
          </div>

          {/* Mark as Sent */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="markAsSent"
              checked={form.watch("markAsSent")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("markAsSent", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="markAsSent">Mark as Sent</Label>
              <p className="text-xs text-muted-foreground">
                Update the invoice status to indicate it has been delivered
              </p>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
