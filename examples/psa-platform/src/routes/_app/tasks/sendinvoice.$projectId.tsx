/**
 * Send Invoice Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-sendinvoice.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@repo/ui/components/card";
import { Send, Loader2, AlertTriangle, Mail, FileDown, Globe } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

type DeliveryMethod = "email" | "pdf" | "portal";

const DELIVERY_METHODS = [
  {
    value: "email" as const,
    label: "Email",
    description: "Send invoice directly to client's email address",
    icon: Mail,
  },
  {
    value: "pdf" as const,
    label: "Download PDF",
    description: "Download PDF and deliver manually",
    icon: FileDown,
  },
  {
    value: "portal" as const,
    label: "Client Portal",
    description: "Post to client portal for viewing",
    icon: Globe,
  },
];

export const Route = createFileRoute("/_app/tasks/sendinvoice/$projectId")({
  component: SendInvoiceTask,
});

function SendInvoiceTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "sendInvoice" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Delivery method selected</h3>
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
      <SendInvoiceTaskForm
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

function SendInvoiceTaskForm({
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
  const [selectedMethod, setSelectedMethod] = useState<DeliveryMethod | null>(null);

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
        args: { name: "sendInvoice" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSelectMethod = async (method: DeliveryMethod) => {
    if (!finalizedInvoice) {
      setErrorMessage("No finalized invoice found.");
      return;
    }

    setSelectedMethod(method);
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "sendInvoice" as const,
          payload: {
            invoiceId: finalizedInvoice._id,
            method,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to select method."
      );
      setSelectedMethod(null);
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
      icon={<Send className="h-8 w-8 text-blue-500" />}
      title="Send Invoice"
      description="Choose how to deliver the invoice"
      formTitle="Delivery Method"
      formDescription="Select how you want to send this invoice to the client."
      onSubmit={async () => {}}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText=""
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
                    Invoice #{finalizedInvoice.number ?? "Finalized"}
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

          {/* Method Selection Cards */}
          <div className="grid grid-cols-1 gap-4">
            {DELIVERY_METHODS.map((method) => {
              const Icon = method.icon;
              const isSelected = selectedMethod === method.value;
              return (
                <Card
                  key={method.value}
                  className={`cursor-pointer transition-all hover:border-primary ${
                    isSelected ? "border-primary bg-primary/5" : ""
                  } ${!isStarted || !finalizedInvoice ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => {
                    if (isStarted && !isSubmitting && finalizedInvoice) {
                      handleSelectMethod(method.value);
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{method.label}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{method.description}</CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
