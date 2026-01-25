/**
 * Select Expense Type Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-selectexpensetype.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@repo/ui/components/label";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import {
  Receipt,
  Loader2,
  AlertTriangle,
  Monitor,
  Plane,
  Package,
  Users,
  MoreHorizontal,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

const selectExpenseTypeSchema = z.object({
  expenseType: z.enum(["Software", "Travel", "Materials", "Subcontractor", "Other"]),
});

type SelectExpenseTypeFormValues = z.infer<typeof selectExpenseTypeSchema>;

const EXPENSE_TYPES = [
  {
    value: "Software" as const,
    label: "Software",
    description: "Licenses, subscriptions, and software tools",
    icon: Monitor,
  },
  {
    value: "Travel" as const,
    label: "Travel",
    description: "Airfare, hotels, meals, and transportation",
    icon: Plane,
  },
  {
    value: "Materials" as const,
    label: "Materials",
    description: "Physical goods, supplies, and equipment",
    icon: Package,
  },
  {
    value: "Subcontractor" as const,
    label: "Subcontractor",
    description: "External contractor and freelancer invoices",
    icon: Users,
  },
  {
    value: "Other" as const,
    label: "Other",
    description: "Miscellaneous and uncategorized expenses",
    icon: MoreHorizontal,
  },
];

export const Route = createFileRoute("/_app/tasks/selectexpensetype/$projectId")(
  {
    component: SelectExpenseTypeTask,
  }
);

function SelectExpenseTypeTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    {
      projectId,
    }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "selectExpenseType" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense type selected</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to expense form...
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
      <SelectExpenseTypeTaskForm
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

function SelectExpenseTypeTaskForm({
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

  const form = useForm<SelectExpenseTypeFormValues>({
    resolver: zodResolver(selectExpenseTypeSchema),
    defaultValues: {
      expenseType: "Other",
    },
  });

  if (!task) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Task details unavailable.
      </div>
    );
  }

  const selectedType = form.watch("expenseType");

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "selectExpenseType" as const,
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

  const handleSubmit = async (values: SelectExpenseTypeFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "selectExpenseType" as const,
          payload: {
            expenseType: values.expenseType,
            projectId,
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
      icon={<Receipt className="h-8 w-8 text-yellow-500" />}
      title="Select Expense Type"
      description="Choose the category for your expense"
      formTitle="Expense Category"
      formDescription="Select the type that best describes this expense."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Continue"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <Label className="text-base font-medium">
            What type of expense is this?
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {EXPENSE_TYPES.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.value;
              return (
                <Button
                  key={type.value}
                  type="button"
                  variant="outline"
                  disabled={!isStarted}
                  onClick={() => form.setValue("expenseType", type.value)}
                  className={cn(
                    "h-auto p-4 flex flex-col items-start gap-2 text-left",
                    isSelected &&
                      "border-primary bg-primary/5 ring-2 ring-primary ring-offset-2"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <span className="font-medium">{type.label}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {type.description}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </TaskFormLayout>
  );
}
