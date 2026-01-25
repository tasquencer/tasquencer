/**
 * Review Invoice Draft Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-reviewdraft.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { Card, CardContent } from "@repo/ui/components/card";
import { FileSearch, Loader2, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const reviewDraftSchema = z.object({
  approved: z.boolean(),
  comments: z.string().optional(),
});

type ReviewDraftFormValues = z.infer<typeof reviewDraftSchema>;

export const Route = createFileRoute("/_app/tasks/reviewdraft/$projectId")({
  component: ReviewDraftTask,
});

function ReviewDraftTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "reviewDraft" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Review submitted</h3>
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
      <ReviewDraftTaskForm
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

function ReviewDraftTaskForm({
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

  // Get draft invoices for this project
  const draftInvoices = useQuery(
    api.workflows.dealToDelivery.api.invoices.listInvoices,
    { projectId, status: "Draft" }
  );
  const draftInvoice = draftInvoices?.[0] ?? null;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<ReviewDraftFormValues>({
    resolver: zodResolver(reviewDraftSchema),
    defaultValues: {
      approved: true,
      comments: "",
    },
  });

  const isApproved = form.watch("approved");

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
        args: { name: "reviewDraft" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: ReviewDraftFormValues) => {
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
          name: "reviewDraft" as const,
          payload: {
            invoiceId: draftInvoice._id,
            approved: values.approved,
            comments: values.comments || undefined,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit review."
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
      icon={<FileSearch className="h-8 w-8 text-indigo-500" />}
      title="Review Invoice Draft"
      description="Approve or reject the invoice draft"
      formTitle="Draft Review"
      formDescription="Review the invoice details and approve or reject."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText={isApproved ? "Approve Draft" : "Reject Draft"}
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Invoice Details */}
          {draftInvoice ? (
            <Card className="bg-muted/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    Invoice #{draftInvoice.number ?? "Draft"}
                  </span>
                  <Badge variant="outline">Draft</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-medium">
                      {formatCurrency(draftInvoice.total)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Method:</span>{" "}
                    <span className="font-medium">
                      {draftInvoice.method}
                    </span>
                  </div>
                  {draftInvoice.dueDate && (
                    <div>
                      <span className="text-muted-foreground">Due Date:</span>{" "}
                      {new Date(draftInvoice.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
                {draftInvoice.notes && (
                  <p className="text-sm text-muted-foreground border-t pt-2">
                    {draftInvoice.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No draft invoice found for this project.
            </p>
          )}

          {/* Approval Toggle */}
          <div className="space-y-3">
            <Label>Decision</Label>
            <div className="flex gap-4">
              <Card
                className={`flex-1 cursor-pointer transition-all ${
                  isApproved ? "border-green-500 bg-green-50" : ""
                } ${!isStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => isStarted && form.setValue("approved", true)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <CheckCircle
                    className={`h-5 w-5 ${
                      isApproved ? "text-green-500" : "text-muted-foreground"
                    }`}
                  />
                  <span className={isApproved ? "font-medium" : ""}>
                    Approve
                  </span>
                </CardContent>
              </Card>
              <Card
                className={`flex-1 cursor-pointer transition-all ${
                  !isApproved ? "border-red-500 bg-red-50" : ""
                } ${!isStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => isStarted && form.setValue("approved", false)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <XCircle
                    className={`h-5 w-5 ${
                      !isApproved ? "text-red-500" : "text-muted-foreground"
                    }`}
                  />
                  <span className={!isApproved ? "font-medium" : ""}>
                    Reject
                  </span>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Comments */}
          <div className="space-y-2">
            <Label htmlFor="comments">
              Comments {!isApproved && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              id="comments"
              {...form.register("comments")}
              placeholder={
                isApproved
                  ? "Optional comments..."
                  : "Please explain why the draft is being rejected..."
              }
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
