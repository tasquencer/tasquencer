/**
 * Request Change Order Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-requestchangeorder.md
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Button } from "@repo/ui/components/button";
import { FileText, Loader2, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useFieldArray } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";

const additionalServiceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  rate: z.number().min(0, "Rate must be positive"),
  hours: z.number().min(0, "Hours must be positive"),
});

const schema = z.object({
  description: z.string().min(1, "Description is required"),
  budgetImpact: z.number().min(0, "Budget impact must be 0 or greater"),
  justification: z.string().min(1, "Justification is required"),
  additionalServices: z.array(additionalServiceSchema).optional(),
  scopeChanges: z.string().optional(),
});

type FormValues = z.input<typeof schema>;

function AdditionalServicesFields({
  form,
  isStarted,
}: {
  form: UseFormReturn<FormValues>;
  isStarted: boolean;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additionalServices",
  });

  const addService = () => {
    append({ name: "", rate: 0, hours: 0 });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Additional Services</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addService}
          disabled={!isStarted}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Service
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No additional services added.
        </p>
      )}

      {fields.map((field, index) => (
        <div
          key={field.id}
          className="grid grid-cols-12 gap-2 items-end rounded-lg border p-3"
        >
          <div className="col-span-5 space-y-1">
            <Label htmlFor={`additionalServices.${index}.name`}>Name</Label>
            <Input
              id={`additionalServices.${index}.name`}
              placeholder="Service name"
              {...form.register(`additionalServices.${index}.name` as const)}
              disabled={!isStarted}
            />
          </div>
          <div className="col-span-3 space-y-1">
            <Label htmlFor={`additionalServices.${index}.rate`}>
              Rate ($/hr)
            </Label>
            <Input
              id={`additionalServices.${index}.rate`}
              type="number"
              min="0"
              step="0.01"
              {...form.register(`additionalServices.${index}.rate` as const, {
                valueAsNumber: true,
              })}
              disabled={!isStarted}
            />
          </div>
          <div className="col-span-3 space-y-1">
            <Label htmlFor={`additionalServices.${index}.hours`}>Hours</Label>
            <Input
              id={`additionalServices.${index}.hours`}
              type="number"
              min="0"
              step="0.5"
              {...form.register(`additionalServices.${index}.hours` as const, {
                valueAsNumber: true,
              })}
              disabled={!isStarted}
            />
          </div>
          <div className="col-span-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              disabled={!isStarted}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestChangeOrderComponentFactory(
  projectId: Id<"projects">,
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "requestChangeOrder",
    schema,
    getDefaultValues: () => ({
      description: "",
      budgetImpact: 0,
      justification: "",
      additionalServices: [],
      scopeChanges: "",
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        description: values.description,
        budgetImpact: Math.round(values.budgetImpact * 100), // Convert to cents
        justification: values.justification,
        additionalServices: values.additionalServices?.map((s) => ({
          name: s.name,
          rate: Math.round(s.rate * 100), // Convert to cents
          hours: s.hours,
        })),
        scopeChanges: values.scopeChanges || undefined,
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Submit a change order request to adjust the project budget or scope.
            This will require approval before taking effect.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description *</Label>
          <Textarea
            id="description"
            placeholder="Describe the change being requested..."
            {...form.register("description")}
            disabled={!isStarted}
            rows={3}
          />
          {form.formState.errors.description && (
            <p className="text-sm text-destructive">
              {form.formState.errors.description.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="budgetImpact">Budget Impact ($) *</Label>
          <Input
            id="budgetImpact"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            {...form.register("budgetImpact", { valueAsNumber: true })}
            disabled={!isStarted}
          />
          {form.formState.errors.budgetImpact && (
            <p className="text-sm text-destructive">
              {form.formState.errors.budgetImpact.message}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Enter the additional budget amount needed (must be 0 or greater).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="justification">Justification *</Label>
          <Textarea
            id="justification"
            placeholder="Explain why this change is necessary..."
            {...form.register("justification")}
            disabled={!isStarted}
            rows={3}
          />
          {form.formState.errors.justification && (
            <p className="text-sm text-destructive">
              {form.formState.errors.justification.message}
            </p>
          )}
        </div>

        <AdditionalServicesFields form={form} isStarted={isStarted} />

        <div className="space-y-2">
          <Label htmlFor="scopeChanges">Scope Changes (optional)</Label>
          <Textarea
            id="scopeChanges"
            placeholder="Describe any scope changes..."
            {...form.register("scopeChanges")}
            disabled={!isStarted}
            rows={2}
          />
        </div>
      </div>
    ),
    icon: <FileText className="h-8 w-8 text-orange-500" />,
    title: "Request Change Order",
    description: "Submit a change order request for budget or scope changes",
    formTitle: "Change Order Details",
    formDescription:
      "Provide details about the requested change and its impact.",
    submitButtonText: "Submit Request",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: `/projects/${projectId}` });
    },
    backTo: `/projects/${projectId}`,
    backLabel: "Back to Project",
  });
}

export const Route = createFileRoute(
  "/_app/tasks/requestchangeorder/$projectId"
)({
  component: RequestChangeOrderTask,
});

function RequestChangeOrderTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "requestChangeOrder" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Change order submitted</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to project...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (workItem === undefined) {
    return <SpinningLoader />;
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

  const Component = RequestChangeOrderComponentFactory(projectId, () =>
    setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
