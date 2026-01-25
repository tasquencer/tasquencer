/**
 * Edit Invoice Draft Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-editdraft.md
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
import { Button } from "@repo/ui/components/button";
import { Edit3, Loader2, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@repo/ui/components/badge";

const editDraftSchema = z.object({
  discountType: z.enum(["percentage", "fixed", "none"]),
  discountValue: z.number().min(0).optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

type EditDraftFormValues = z.infer<typeof editDraftSchema>;

type LineItemChange = {
  action: "add" | "update" | "remove";
  id?: Id<"invoiceLineItems">;
  description?: string;
  quantity?: number;
  rate?: number;
};

export const Route = createFileRoute("/_app/tasks/editdraft/$projectId")({
  component: EditDraftTask,
});

function EditDraftTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "editDraft" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Changes saved</h3>
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
      <EditDraftTaskForm
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

function EditDraftTaskForm({
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
  const [lineItemChanges, setLineItemChanges] = useState<LineItemChange[]>([]);
  const [newLineItems, setNewLineItems] = useState<
    { description: string; quantity: number; rate: number }[]
  >([]);

  const form = useForm<EditDraftFormValues>({
    resolver: zodResolver(editDraftSchema),
    defaultValues: {
      discountType: "none",
      discountValue: 0,
      dueDate: draftInvoice?.dueDate
        ? new Date(draftInvoice.dueDate).toISOString().split("T")[0]
        : "",
      notes: draftInvoice?.notes ?? "",
    },
  });

  const discountType = form.watch("discountType");

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
        args: { name: "editDraft" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleAddNewLineItem = () => {
    setNewLineItems([...newLineItems, { description: "", quantity: 1, rate: 0 }]);
  };

  const handleRemoveNewLineItem = (index: number) => {
    setNewLineItems(newLineItems.filter((_, i) => i !== index));
  };

  const handleUpdateNewLineItem = (
    index: number,
    field: "description" | "quantity" | "rate",
    value: string | number
  ) => {
    const updated = [...newLineItems];
    if (field === "description") {
      updated[index].description = value as string;
    } else if (field === "quantity") {
      updated[index].quantity = Number(value);
    } else {
      updated[index].rate = Number(value);
    }
    setNewLineItems(updated);
  };

  const handleMarkForRemoval = (lineItemId: Id<"invoiceLineItems">) => {
    const existing = lineItemChanges.find((c) => c.id === lineItemId);
    if (existing) {
      // Toggle off
      setLineItemChanges(lineItemChanges.filter((c) => c.id !== lineItemId));
    } else {
      setLineItemChanges([...lineItemChanges, { action: "remove", id: lineItemId }]);
    }
  };

  const handleSubmit = async (values: EditDraftFormValues) => {
    if (!draftInvoice) {
      setErrorMessage("No draft invoice found.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Build changes object
      const changes: {
        discount?: { type: "percentage" | "fixed"; value: number };
        dueDate?: number;
        notes?: string;
        lineItems?: LineItemChange[];
      } = {};

      if (values.discountType !== "none" && values.discountValue) {
        changes.discount = {
          type: values.discountType as "percentage" | "fixed",
          value: Math.round(values.discountValue * 100),
        };
      }

      if (values.dueDate) {
        changes.dueDate = new Date(values.dueDate).getTime();
      }

      if (values.notes) {
        changes.notes = values.notes;
      }

      // Collect line item changes
      const allLineItemChanges: LineItemChange[] = [...lineItemChanges];

      // Add new line items
      for (const item of newLineItems) {
        if (item.description && item.rate > 0) {
          allLineItemChanges.push({
            action: "add",
            description: item.description,
            quantity: item.quantity,
            rate: Math.round(item.rate * 100),
          });
        }
      }

      if (allLineItemChanges.length > 0) {
        changes.lineItems = allLineItemChanges;
      }

      await completeWorkItem({
        workItemId,
        args: {
          name: "editDraft" as const,
          payload: {
            invoiceId: draftInvoice._id,
            changes,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save changes."
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
      icon={<Edit3 className="h-8 w-8 text-orange-500" />}
      title="Edit Invoice Draft"
      description="Make changes to the invoice draft"
      formTitle="Edit Draft"
      formDescription="Modify line items, discount, due date, and notes."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Save Changes"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-6">
          {/* Current Invoice Summary */}
          {draftInvoice ? (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">
                    Invoice #{draftInvoice.number ?? "Draft"}
                  </span>
                  <Badge variant="outline">Draft</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  Current Total: {formatCurrency(draftInvoice.total)}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded">
              No draft invoice found for this project.
            </p>
          )}

          {/* Existing Line Items */}
          {draftInvoice?.lineItems && draftInvoice.lineItems.length > 0 && (
            <div className="space-y-2">
              <Label>Current Line Items</Label>
              <div className="space-y-2">
                {draftInvoice.lineItems.map((item: { _id: Id<"invoiceLineItems">; description: string; quantity: number; rate: number }) => {
                  const isMarkedForRemoval = lineItemChanges.some(
                    (c) => c.id === item._id && c.action === "remove"
                  );
                  return (
                    <Card
                      key={item._id}
                      className={isMarkedForRemoval ? "opacity-50" : ""}
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex-1">
                          <span className={isMarkedForRemoval ? "line-through" : ""}>
                            {item.description}
                          </span>
                          <div className="text-sm text-muted-foreground">
                            {item.quantity} x {formatCurrency(item.rate)} ={" "}
                            {formatCurrency(item.quantity * item.rate)}
                          </div>
                        </div>
                        <Button
                          variant={isMarkedForRemoval ? "outline" : "ghost"}
                          size="sm"
                          onClick={() => handleMarkForRemoval(item._id)}
                          disabled={!isStarted}
                        >
                          {isMarkedForRemoval ? "Undo" : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* New Line Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add Line Items</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddNewLineItem}
                disabled={!isStarted}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            </div>
            {newLineItems.map((item, index) => (
              <Card key={index}>
                <CardContent className="p-3 space-y-2">
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) =>
                      handleUpdateNewLineItem(index, "description", e.target.value)
                    }
                    disabled={!isStarted}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          handleUpdateNewLineItem(index, "quantity", e.target.value)
                        }
                        disabled={!isStarted}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Rate ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.rate}
                        onChange={(e) =>
                          handleUpdateNewLineItem(index, "rate", e.target.value)
                        }
                        disabled={!isStarted}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveNewLineItem(index)}
                        disabled={!isStarted}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Discount */}
          <div className="space-y-2">
            <Label>Discount</Label>
            <div className="grid grid-cols-2 gap-4">
              <Select
                value={form.watch("discountType")}
                onValueChange={(v) =>
                  form.setValue("discountType", v as "percentage" | "fixed" | "none")
                }
                disabled={!isStarted}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Discount</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
              {discountType !== "none" && (
                <Input
                  type="number"
                  step={discountType === "percentage" ? "1" : "0.01"}
                  min="0"
                  max={discountType === "percentage" ? "100" : undefined}
                  placeholder={discountType === "percentage" ? "%" : "$"}
                  {...form.register("discountValue", { valueAsNumber: true })}
                  disabled={!isStarted}
                />
              )}
            </div>
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
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              {...form.register("notes")}
              placeholder="Additional notes for the invoice..."
              disabled={!isStarted}
              rows={3}
            />
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
