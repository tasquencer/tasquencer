/**
 * Log Travel Expense Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 *
 * Spec: task-logtravelexpense.md
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useState, useEffect } from "react";
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
import { Plane, Loader2, AlertTriangle } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "@/features/psa/hooks/usePsaTask";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const logTravelExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  currency: z.string().optional(),
  date: z.number(),
  travelCategory: z.enum([
    "Airfare",
    "Hotel",
    "CarRental",
    "Meals",
    "Mileage",
    "Parking",
    "Other",
  ]),
  origin: z.string().optional(),
  destination: z.string().optional(),
  purpose: z.string().optional(),
  travelDate: z.number().optional(),
  returnDate: z.number().optional(),
  miles: z.number().optional(),
  mileageRate: z.number().optional(),
  notes: z.string().optional(),
});

type LogTravelExpenseFormValues = z.infer<typeof logTravelExpenseSchema>;

const TRAVEL_CATEGORIES = [
  { value: "Airfare", label: "Airfare" },
  { value: "Hotel", label: "Hotel" },
  { value: "CarRental", label: "Car Rental" },
  { value: "Meals", label: "Meals" },
  { value: "Mileage", label: "Mileage" },
  { value: "Parking", label: "Parking" },
  { value: "Other", label: "Other Travel" },
];

// Default IRS mileage rate for 2024 (in dollars per mile)
const DEFAULT_MILEAGE_RATE = 0.67;

export const Route = createFileRoute(
  "/_app/tasks/logtravelexpense/$projectId"
)({
  component: LogTravelExpenseTask,
});

function LogTravelExpenseTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const navigate = useNavigate();
  const [isRedirecting, setIsRedirecting] = useState(false);

  const project = useQuery(
    api.workflows.dealToDelivery.api.projects.getProject,
    { projectId }
  );

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "logTravelExpense" }
  );

  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Expense logged</h3>
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
      <LogTravelExpenseTaskForm
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

function LogTravelExpenseTaskForm({
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

  const form = useForm<LogTravelExpenseFormValues>({
    resolver: zodResolver(logTravelExpenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      currency: "USD",
      date: Date.now(),
      travelCategory: "Other",
      mileageRate: DEFAULT_MILEAGE_RATE,
      notes: "",
    },
  });

  const travelCategory = form.watch("travelCategory");
  const miles = form.watch("miles");
  const mileageRate = form.watch("mileageRate");

  // Auto-calculate amount for mileage
  useEffect(() => {
    if (travelCategory === "Mileage" && miles && mileageRate) {
      const calculatedAmount = miles * mileageRate;
      form.setValue("amount", Math.round(calculatedAmount * 100) / 100);
    }
  }, [travelCategory, miles, mileageRate, form]);

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
        args: {
          name: "logTravelExpense" as const,
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

  const handleSubmit = async (values: LogTravelExpenseFormValues) => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await completeWorkItem({
        workItemId,
        args: {
          name: "logTravelExpense" as const,
          payload: {
            projectId,
            description: values.description,
            amount: Math.round(values.amount * 100), // Convert to cents
            currency: values.currency ?? "USD",
            date: values.date,
            travelCategory: values.travelCategory,
            origin: values.origin,
            destination: values.destination,
            purpose: values.purpose,
            travelDate: values.travelDate,
            returnDate: values.returnDate,
            miles: values.miles,
            mileageRate: values.mileageRate,
            notes: values.notes,
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

  const isMileage = travelCategory === "Mileage";
  const showTripDetails = ["Airfare", "Hotel", "CarRental"].includes(
    travelCategory
  );

  return (
    <TaskFormLayout
      deal={deal}
      task={task}
      icon={<Plane className="h-8 w-8 text-sky-500" />}
      title="Log Travel Expense"
      description="Record a travel-related expense"
      formTitle="Travel Expense Details"
      formDescription="Enter the details of your travel expense."
      onSubmit={form.handleSubmit(handleSubmit)}
      onClaim={handleClaim}
      isSubmitting={isSubmitting}
      isClaiming={isClaiming}
      canClaim={canClaimWorkItem}
      errorMessage={errorMessage}
      submitButtonText="Log Expense"
      backTo={`/projects/${projectId}`}
      backLabel="Back to Project"
    >
      {(isStarted) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="travelCategory">Travel Category *</Label>
            <Select
              value={form.watch("travelCategory")}
              onValueChange={(v) =>
                form.setValue(
                  "travelCategory",
                  v as LogTravelExpenseFormValues["travelCategory"]
                )
              }
              disabled={!isStarted}
            >
              <SelectTrigger id="travelCategory">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {TRAVEL_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              placeholder="e.g., Flight to client site - NYC to LAX"
              {...form.register("description")}
              disabled={!isStarted}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-500">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          {isMileage ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="miles">Miles Driven *</Label>
                <Input
                  id="miles"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="0"
                  {...form.register("miles", { valueAsNumber: true })}
                  disabled={!isStarted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mileageRate">Rate ($/mile)</Label>
                <Input
                  id="mileageRate"
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register("mileageRate", { valueAsNumber: true })}
                  disabled={!isStarted}
                />
                <p className="text-xs text-muted-foreground">
                  IRS standard rate: ${DEFAULT_MILEAGE_RATE}/mile
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (USD) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  {...form.register("amount", { valueAsNumber: true })}
                  disabled={!isStarted}
                />
                {form.formState.errors.amount && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.amount.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Expense Date *</Label>
                <Input
                  id="date"
                  type="date"
                  value={
                    new Date(form.watch("date")).toISOString().split("T")[0]
                  }
                  onChange={(e) =>
                    form.setValue("date", new Date(e.target.value).getTime())
                  }
                  disabled={!isStarted}
                />
              </div>
            </div>
          )}

          {isMileage && (
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm">
                <span className="font-medium">Calculated Amount:</span>{" "}
                <span className="text-lg font-semibold">
                  ${form.watch("amount")?.toFixed(2) ?? "0.00"}
                </span>
              </p>
            </div>
          )}

          {showTripDetails && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="origin">Origin</Label>
                  <Input
                    id="origin"
                    placeholder="e.g., New York, NY"
                    {...form.register("origin")}
                    disabled={!isStarted}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="destination">Destination</Label>
                  <Input
                    id="destination"
                    placeholder="e.g., Los Angeles, CA"
                    {...form.register("destination")}
                    disabled={!isStarted}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="travelDate">Travel Date</Label>
                  <Input
                    id="travelDate"
                    type="date"
                    value={
                      form.watch("travelDate")
                        ? new Date(form.watch("travelDate")!)
                            .toISOString()
                            .split("T")[0]
                        : ""
                    }
                    onChange={(e) =>
                      form.setValue(
                        "travelDate",
                        e.target.value
                          ? new Date(e.target.value).getTime()
                          : undefined
                      )
                    }
                    disabled={!isStarted}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="returnDate">Return Date</Label>
                  <Input
                    id="returnDate"
                    type="date"
                    value={
                      form.watch("returnDate")
                        ? new Date(form.watch("returnDate")!)
                            .toISOString()
                            .split("T")[0]
                        : ""
                    }
                    onChange={(e) =>
                      form.setValue(
                        "returnDate",
                        e.target.value
                          ? new Date(e.target.value).getTime()
                          : undefined
                      )
                    }
                    disabled={!isStarted}
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="purpose">Business Purpose</Label>
            <Input
              id="purpose"
              placeholder="e.g., Client kickoff meeting"
              {...form.register("purpose")}
              disabled={!isStarted}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional details about this expense..."
              {...form.register("notes")}
              disabled={!isStarted}
              rows={3}
            />
          </div>

          {!isStarted && (
            <p className="text-sm text-muted-foreground">
              Claim this task to log the expense.
            </p>
          )}
        </div>
      )}
    </TaskFormLayout>
  );
}
