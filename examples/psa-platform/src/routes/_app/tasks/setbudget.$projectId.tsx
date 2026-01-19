/**
 * Set Budget Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { DollarSign, Plus, Trash2 } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatCurrency } from "@/lib/utils";

const serviceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  rate: z.number().positive("Rate must be greater than 0"),
  estimatedHours: z.number().min(0, "Estimated hours must be non-negative"),
});

const setBudgetSchema = z.object({
  budgetType: z.enum(["TimeAndMaterials", "FixedFee", "Retainer"]),
  services: z.array(serviceSchema).min(1, "Add at least one service"),
});

type SetBudgetFormValues = z.infer<typeof setBudgetSchema>;

type ProjectBudgetService = {
  name: string;
  rate: number;
  estimatedHours: number;
};

type ProjectBudget = {
  _id: Id<"budgets">;
  type: "TimeAndMaterials" | "FixedFee" | "Retainer";
  services: ProjectBudgetService[];
};

type ProjectWithBudget = {
  budget: ProjectBudget | null;
};

// Service templates with rates in dollars
const SERVICE_TEMPLATES = [
  { name: "Design", rate: 150 },
  { name: "Development", rate: 175 },
  { name: "Project Management", rate: 125 },
  { name: "QA Testing", rate: 100 },
  { name: "Strategy/Discovery", rate: 200 },
];

const getEmptyService = () => ({ name: "", rate: 0, estimatedHours: 0 });

export const Route = createFileRoute("/_app/tasks/setbudget/$projectId")({
  component: SetBudgetTask,
});

function SetBudgetTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };

  const project = useQuery(api.workflows.dealToDelivery.api.projects.getProject, {
    projectId,
  });

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "setBudget" }
  );

  if (project === undefined || workItem === undefined) {
    return <SpinningLoader />;
  }

  if (project === null) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Project not found.
      </div>
    );
  }

  // No active work item for this task - redirect to projects page
  if (workItem === null) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">
          This task is not currently available for this project.
        </p>
        <Navigate to="/projects" />
      </div>
    );
  }

  return (
    <Suspense fallback={<SpinningLoader />}>
      <SetBudgetTaskForm workItemId={workItem.workItemId} project={project} />
    </Suspense>
  );
}

function SetBudgetTaskForm({
  workItemId,
  project,
}: {
  workItemId: Id<"tasquencerWorkItems">;
  project: ProjectWithBudget;
}) {
  const navigate = useNavigate();
  const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
    usePsaTask(workItemId);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultValues = useMemo<SetBudgetFormValues>(() => {
    const services =
      project.budget?.services?.length
        ? project.budget.services.map((service) => ({
            name: service.name,
            rate: service.rate / 100,
            estimatedHours: service.estimatedHours,
          }))
        : [getEmptyService()];

    return {
      budgetType: project.budget?.type ?? "TimeAndMaterials",
      services,
    };
  }, [project.budget?.type, project.budget?.services]);

  const form = useForm<SetBudgetFormValues>({
    resolver: zodResolver(setBudgetSchema),
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "services",
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  if (!task) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Task details unavailable.
      </div>
    );
  }

  const watchServices = form.watch("services");
  const serviceLineTotals = watchServices.map(
    (service) => (service.rate || 0) * (service.estimatedHours || 0)
  );
  const subtotal = serviceLineTotals.reduce((sum, total) => sum + total, 0);

  const handleClaim = async () => {
    setIsClaiming(true);
    setErrorMessage(null);
    try {
      await startWorkItem({
        workItemId,
        args: {
          name: "setBudget" as const,
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

  const handleSubmit = async (values: SetBudgetFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      if (!project.budget?._id) {
        throw new Error("Project budget not found.");
      }

      await completeWorkItem({
        workItemId,
        args: {
          name: "setBudget" as const,
          payload: {
            budgetId: project.budget._id,
            type: values.budgetType,
            services: values.services.map((service) => ({
              name: service.name,
              rate: Math.round(service.rate * 100),
              estimatedHours: service.estimatedHours,
            })),
          },
        },
      });

      navigate({ to: "/projects" });
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
      icon={<DollarSign className="h-8 w-8 text-green-500" />}
      title="Set Project Budget"
      description="Define the budget type and service allocations for this project"
      formTitle="Budget Configuration"
      formDescription="Configure the project budget type and service line items."
      onSubmit={() => handleSubmit(form.getValues())}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Set Budget"
    >
      {(isStarted) => (
        <>
          <div className="grid gap-2">
            <Label htmlFor="budgetType">Budget Type</Label>
            <Select
              value={form.watch("budgetType")}
              onValueChange={(v) =>
                form.setValue(
                  "budgetType",
                  v as "TimeAndMaterials" | "FixedFee" | "Retainer"
                )
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="budgetType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TimeAndMaterials">
                  Time & Materials - Bill based on actual hours
                </SelectItem>
                <SelectItem value="FixedFee">
                  Fixed Fee - Set price for defined scope
                </SelectItem>
                <SelectItem value="Retainer">
                  Retainer - Monthly recurring budget
                </SelectItem>
              </SelectContent>
            </Select>
            {form.formState.errors.budgetType && (
              <p className="text-sm text-destructive">
                {form.formState.errors.budgetType.message}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Budget Services</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append(getEmptyService())}
                disabled={!isStarted}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Service
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {SERVICE_TEMPLATES.map((template) => (
                <Button
                  key={template.name}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    append({
                      name: template.name,
                      rate: template.rate,
                      estimatedHours: 0,
                    })
                  }
                  disabled={!isStarted}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {template.name}
                </Button>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Service Name</TableHead>
                  <TableHead className="w-[20%]">Rate ($/hr)</TableHead>
                  <TableHead className="w-[20%]">Est. Hours</TableHead>
                  <TableHead className="w-[15%] text-right">Total</TableHead>
                  <TableHead className="w-[5%]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => (
                  <TableRow key={field.id}>
                    <TableCell>
                      <Input
                        {...form.register(`services.${index}.name`)}
                        placeholder="Service name"
                        className="h-9"
                        disabled={!isStarted}
                      />
                      {form.formState.errors.services?.[index]?.name && (
                        <p className="text-xs text-destructive mt-1">
                          {
                            form.formState.errors.services[index]?.name
                              ?.message
                          }
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        {...form.register(`services.${index}.rate`, {
                          valueAsNumber: true,
                        })}
                        placeholder="0"
                        className="h-9"
                        disabled={!isStarted}
                      />
                      {form.formState.errors.services?.[index]?.rate && (
                        <p className="text-xs text-destructive mt-1">
                          {
                            form.formState.errors.services[index]?.rate
                              ?.message
                          }
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.5"
                        {...form.register(`services.${index}.estimatedHours`, {
                          valueAsNumber: true,
                        })}
                        placeholder="0"
                        className="h-9"
                        disabled={!isStarted}
                      />
                      {form.formState.errors.services?.[index]
                        ?.estimatedHours && (
                        <p className="text-xs text-destructive mt-1">
                          {
                            form.formState.errors.services[index]
                              ?.estimatedHours?.message
                          }
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(
                        Math.round(
                          (serviceLineTotals[index] || 0) * 100
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => fields.length > 1 && remove(index)}
                        disabled={!isStarted || fields.length === 1}
                        className="h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-medium">
                    Subtotal
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg">
                    {formatCurrency(Math.round(subtotal * 100))}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {form.formState.errors.services?.message && (
              <p className="text-sm text-destructive">
                {form.formState.errors.services.message}
              </p>
            )}
          </div>
        </>
      )}
    </TaskFormLayout>
  );
}
