/**
 * Get Change Order Approval Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-getchangeorderapproval.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
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
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const schema = z.object({
  changeOrderId: z.string().min(1, "Change order is required"),
  approved: z.enum(["true", "false"]),
  approverName: z.string().optional(),
  approverEmail: z.string().email().optional().or(z.literal("")),
  comments: z.string().optional(),
  approvedAmount: z.number().optional(),
});

function GetChangeOrderApprovalComponentFactory(
  projectId: Id<"projects">,
  changeOrders: Doc<"changeOrders">[],
  onRedirectStart?: () => void
) {
  const pendingOrders = changeOrders.filter((co) => co.status === "Pending");
  const latestPending = pendingOrders[0];

  return createPsaTaskComponent({
    workflowTaskName: "getChangeOrderApproval",
    schema,
    getDefaultValues: () => ({
      changeOrderId: latestPending?._id ?? "",
      approved: "true" as const,
      approverName: "",
      approverEmail: "",
      comments: "",
      approvedAmount: undefined,
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        changeOrderId: values.changeOrderId as Id<"changeOrders">,
        approved: values.approved === "true",
        approverName: values.approverName || undefined,
        approverEmail: values.approverEmail || undefined,
        comments: values.comments || undefined,
        approvedAmount: values.approvedAmount
          ? Math.round(values.approvedAmount * 100)
          : undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => {
      const selectedId = form.watch("changeOrderId");
      const selectedOrder = changeOrders.find((co) => co._id === selectedId);
      const isApproved = form.watch("approved") === "true";

      return (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              Review and approve or reject the change order request. Approved
              orders will update the project budget.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="changeOrderId">Change Order *</Label>
            <Select
              value={form.watch("changeOrderId")}
              onValueChange={(v) => form.setValue("changeOrderId", v)}
              disabled={!isStarted}
            >
              <SelectTrigger id="changeOrderId">
                <SelectValue placeholder="Select change order..." />
              </SelectTrigger>
              <SelectContent>
                {pendingOrders.map((co) => (
                  <SelectItem key={co._id} value={co._id}>
                    {co.description.substring(0, 50)}
                    {co.description.length > 50 ? "..." : ""} - $
                    {(co.budgetImpact / 100).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pendingOrders.length === 0 && (
              <p className="text-sm text-amber-600">
                No pending change orders found.
              </p>
            )}
          </div>

          {selectedOrder && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="font-medium">Change Order Details</h4>
              <p className="text-sm text-muted-foreground">
                {selectedOrder.description}
              </p>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <p className="text-xs text-muted-foreground">Budget Impact</p>
                  <p className="font-medium">
                    ${(selectedOrder.budgetImpact / 100).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Justification</p>
                  <p className="text-sm">{selectedOrder.justification}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Decision *</Label>
            <RadioGroup
              value={form.watch("approved")}
              onValueChange={(v) =>
                form.setValue("approved", v as "true" | "false")
              }
              disabled={!isStarted}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="approved-yes" />
                <Label htmlFor="approved-yes" className="cursor-pointer">
                  Approve
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="approved-no" />
                <Label htmlFor="approved-no" className="cursor-pointer">
                  Reject
                </Label>
              </div>
            </RadioGroup>
          </div>

          {isApproved && (
            <div className="space-y-2">
              <Label htmlFor="approvedAmount">
                Approved Amount (optional, defaults to full impact)
              </Label>
              <Input
                id="approvedAmount"
                type="number"
                min="0"
                step="0.01"
                placeholder={
                  selectedOrder
                    ? (selectedOrder.budgetImpact / 100).toString()
                    : "0.00"
                }
                {...form.register("approvedAmount", { valueAsNumber: true })}
                disabled={!isStarted}
              />
              <p className="text-xs text-muted-foreground">
                Enter a partial amount for partial approval, or leave blank to
                approve the full amount.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="approverName">Approver Name (optional)</Label>
              <Input
                id="approverName"
                placeholder="Your name"
                {...form.register("approverName")}
                disabled={!isStarted}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="approverEmail">Approver Email (optional)</Label>
              <Input
                id="approverEmail"
                type="email"
                placeholder="your@email.com"
                {...form.register("approverEmail")}
                disabled={!isStarted}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Comments (optional)</Label>
            <Textarea
              id="comments"
              placeholder="Add any notes about your decision..."
              {...form.register("comments")}
              disabled={!isStarted}
              rows={2}
            />
          </div>
        </div>
      );
    },
    icon: <CheckCircle className="h-8 w-8 text-green-500" />,
    title: "Change Order Approval",
    description: "Approve or reject a pending change order request",
    formTitle: "Approval Decision",
    formDescription:
      "Review the change order and record your approval decision.",
    getSubmitProps: ({ form }) => ({
      text: form.watch("approved") === "true" ? "Approve" : "Reject",
      variant: form.watch("approved") === "true" ? "default" : "destructive",
    }),
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/getchangeorderapproval/$projectId"
)({
  component: GetChangeOrderApprovalTask,
});

function GetChangeOrderApprovalTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "getChangeOrderApproval" }
  );

  const changeOrders = useQuery(
    api.workflows.dealToDelivery.api.projects.listChangeOrders,
    { projectId }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Decision recorded</h3>
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
    changeOrders === undefined
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

  const Component = GetChangeOrderApprovalComponentFactory(
    projectId,
    changeOrders,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
