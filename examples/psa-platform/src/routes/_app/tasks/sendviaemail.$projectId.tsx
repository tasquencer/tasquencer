/**
 * Send Invoice via Email Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-sendviaemail.md
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
import { Card, CardContent } from "@repo/ui/components/card";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const sendViaEmailSchema = z.object({
  recipientEmail: z.string().email("Valid email is required"),
  recipientName: z.string().optional(),
  ccEmails: z.string().optional(),
  personalMessage: z.string().optional(),
  attachPdf: z.boolean(),
  includePaymentLink: z.boolean(),
});

type SendViaEmailFormValues = z.infer<typeof sendViaEmailSchema>;

export const Route = createFileRoute("/_app/tasks/sendviaemail/$projectId")({
  component: SendViaEmailTask,
});

function SendViaEmailTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "sendViaEmail" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Invoice sent</h3>
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
      <SendViaEmailTaskForm
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

function SendViaEmailTaskForm({
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

  const form = useForm<SendViaEmailFormValues>({
    resolver: zodResolver(sendViaEmailSchema),
    defaultValues: {
      recipientEmail: "",
      recipientName: "",
      ccEmails: "",
      personalMessage: "",
      attachPdf: true,
      includePaymentLink: true,
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
        args: { name: "sendViaEmail" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: SendViaEmailFormValues) => {
    if (!finalizedInvoice) {
      setErrorMessage("No finalized invoice found.");
      return;
    }

    if (!values.recipientEmail) {
      setErrorMessage("Recipient email is required.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Parse CC emails
      const ccEmails = values.ccEmails
        ? values.ccEmails
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0)
        : undefined;

      await completeWorkItem({
        workItemId,
        args: {
          name: "sendViaEmail" as const,
          payload: {
            invoiceId: finalizedInvoice._id,
            recipientEmail: values.recipientEmail,
            recipientName: values.recipientName || undefined,
            ccEmails,
            personalMessage: values.personalMessage || undefined,
            attachPdf: values.attachPdf,
            includePaymentLink: values.includePaymentLink,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to send invoice."
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
      icon={<Mail className="h-8 w-8 text-blue-500" />}
      title="Send Invoice via Email"
      description="Send the finalized invoice by email"
      formTitle="Email Details"
      formDescription="Configure the email recipient and message."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Send Email"
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
                <div className="text-sm text-muted-foreground">
                  Total: {formatCurrency(finalizedInvoice.total)}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No finalized invoice found for this project.
            </p>
          )}

          {/* Recipient Email */}
          <div className="space-y-2">
            <Label htmlFor="recipientEmail">
              Recipient Email <span className="text-red-500">*</span>
            </Label>
            <Input
              id="recipientEmail"
              type="email"
              {...form.register("recipientEmail")}
              placeholder="client@example.com"
              disabled={!isStarted}
            />
            {form.formState.errors.recipientEmail && (
              <p className="text-sm text-destructive">
                {form.formState.errors.recipientEmail.message}
              </p>
            )}
          </div>

          {/* Recipient Name */}
          <div className="space-y-2">
            <Label htmlFor="recipientName">Recipient Name (optional)</Label>
            <Input
              id="recipientName"
              {...form.register("recipientName")}
              placeholder="John Smith"
              disabled={!isStarted}
            />
          </div>

          {/* CC Emails */}
          <div className="space-y-2">
            <Label htmlFor="ccEmails">CC Emails (optional)</Label>
            <Input
              id="ccEmails"
              {...form.register("ccEmails")}
              placeholder="cc1@example.com, cc2@example.com"
              disabled={!isStarted}
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple emails with commas
            </p>
          </div>

          {/* Personal Message */}
          <div className="space-y-2">
            <Label htmlFor="personalMessage">Personal Message (optional)</Label>
            <Textarea
              id="personalMessage"
              {...form.register("personalMessage")}
              placeholder="Add a personal message to the email..."
              disabled={!isStarted}
              rows={3}
            />
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="attachPdf"
                checked={form.watch("attachPdf")}
                onCheckedChange={(checked: boolean) =>
                  form.setValue("attachPdf", checked)
                }
                disabled={!isStarted}
              />
              <div className="space-y-0.5">
                <Label htmlFor="attachPdf">Attach PDF</Label>
                <p className="text-xs text-muted-foreground">
                  Include the invoice as a PDF attachment
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="includePaymentLink"
                checked={form.watch("includePaymentLink")}
                onCheckedChange={(checked: boolean) =>
                  form.setValue("includePaymentLink", checked)
                }
                disabled={!isStarted}
              />
              <div className="space-y-0.5">
                <Label htmlFor="includePaymentLink">Include Payment Link</Label>
                <p className="text-xs text-muted-foreground">
                  Add a link for online payment
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
