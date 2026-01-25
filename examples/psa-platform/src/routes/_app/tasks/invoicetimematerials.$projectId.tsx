/**
 * Invoice Time & Materials Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-invoicetimematerials.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent } from "@repo/ui/components/card";
import { Clock, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const invoiceT_MSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeExpenses: z.boolean(),
  groupBy: z.enum(["service", "task", "date", "person"]),
  detailLevel: z.enum(["summary", "detailed"]),
});

type InvoiceT_MFormValues = z.infer<typeof invoiceT_MSchema>;

export const Route = createFileRoute(
  "/_app/tasks/invoicetimematerials/$projectId"
)({
  component: InvoiceTimeMaterialsTask,
});

function InvoiceTimeMaterialsTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "invoiceTimeAndMaterials" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Invoice draft created</h3>
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
      <InvoiceTimeMaterialsTaskForm
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

function InvoiceTimeMaterialsTaskForm({
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

  // Get uninvoiced items
  const uninvoicedItems = useQuery(
    api.workflows.dealToDelivery.api.invoices.getUninvoicedItems,
    { projectId }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const form = useForm<InvoiceT_MFormValues>({
    resolver: zodResolver(invoiceT_MSchema),
    defaultValues: {
      includeExpenses: true,
      groupBy: "service",
      detailLevel: "summary",
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
        args: { name: "invoiceTimeAndMaterials" as const },
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to claim task."
      );
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSubmit = async (values: InvoiceT_MFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const dateRange = values.startDate && values.endDate
        ? {
            startDate: new Date(values.startDate).getTime(),
            endDate: new Date(values.endDate).getTime(),
          }
        : undefined;

      await completeWorkItem({
        workItemId,
        args: {
          name: "invoiceTimeAndMaterials" as const,
          payload: {
            projectId,
            dateRange,
            includeExpenses: values.includeExpenses,
            groupBy: values.groupBy,
            detailLevel: values.detailLevel,
          },
        },
      });
      onRedirect();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create invoice."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const timeCount = uninvoicedItems?.timeEntries?.length ?? 0;
  const expenseCount = uninvoicedItems?.expenses?.length ?? 0;

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Clock className="h-8 w-8 text-blue-500" />}
      title="Invoice Time & Materials"
      description="Create a T&M invoice from approved time and expenses"
      formTitle="Invoice Configuration"
      formDescription="Configure how the invoice should be generated."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Create Invoice Draft"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          {/* Available Items Summary */}
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Uninvoiced Time Entries:</span>{" "}
                  <span className="font-medium">{timeCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Uninvoiced Expenses:</span>{" "}
                  <span className="font-medium">{expenseCount}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date (optional)</Label>
              <Input
                id="startDate"
                type="date"
                {...form.register("startDate")}
                disabled={!isStarted}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date (optional)</Label>
              <Input
                id="endDate"
                type="date"
                {...form.register("endDate")}
                disabled={!isStarted}
              />
            </div>
          </div>

          {/* Include Expenses */}
          <div className="flex items-center gap-3 py-2">
            <Checkbox
              id="includeExpenses"
              checked={form.watch("includeExpenses")}
              onCheckedChange={(checked: boolean) =>
                form.setValue("includeExpenses", checked)
              }
              disabled={!isStarted}
            />
            <div className="space-y-0.5">
              <Label htmlFor="includeExpenses">Include Expenses</Label>
              <p className="text-xs text-muted-foreground">
                Add approved expenses to the invoice
              </p>
            </div>
          </div>

          {/* Group By */}
          <div className="space-y-2">
            <Label htmlFor="groupBy">Group Line Items By</Label>
            <Select
              value={form.watch("groupBy")}
              onValueChange={(v) =>
                form.setValue("groupBy", v as "service" | "task" | "date" | "person")
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="groupBy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="person">Person</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Detail Level */}
          <div className="space-y-2">
            <Label htmlFor="detailLevel">Detail Level</Label>
            <Select
              value={form.watch("detailLevel")}
              onValueChange={(v) =>
                form.setValue("detailLevel", v as "summary" | "detailed")
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="detailLevel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summary">Summary (grouped totals)</SelectItem>
                <SelectItem value="detailed">Detailed (individual entries)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
