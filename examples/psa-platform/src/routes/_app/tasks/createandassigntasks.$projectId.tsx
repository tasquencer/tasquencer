/**
 * Create & Assign Tasks Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { ClipboardList, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@repo/ui/components/card";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useFieldArray } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";

const taskSchema = z.object({
  name: z.string().min(1, "Task name is required"),
  description: z.string().optional(),
  assigneeId: z.string().min(1, "Assignee is required"),
  estimatedHours: z.number().min(0, "Estimated hours must be 0 or more"),
  dueDate: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]),
});

const schema = z.object({
  executionStrategy: z.enum(["sequential", "parallel", "conditional"]),
  tasks: z.array(taskSchema).min(1, "Add at least one task"),
});

type FormValues = z.input<typeof schema>;

function TaskFields({
  form,
  isStarted,
  users,
}: {
  form: UseFormReturn<FormValues>;
  isStarted: boolean;
  users: Doc<"users">[];
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tasks",
  });

  const defaultAssignee = users[0]?._id ?? "";
  const addTask = () => {
    append({
      name: "",
      description: "",
      assigneeId: defaultAssignee,
      estimatedHours: 8,
      dueDate: "",
      priority: "Medium" as const,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Tasks</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addTask}
          disabled={!isStarted}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      {fields.map((field, index) => (
        <div key={field.id} className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label className="text-sm font-medium">
              Task {index + 1}
            </Label>
            {fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(index)}
                disabled={!isStarted}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`tasks.${index}.name`}>Task Name *</Label>
            <Input
              id={`tasks.${index}.name`}
              placeholder="Define the task"
              {...form.register(`tasks.${index}.name` as const)}
              disabled={!isStarted}
            />
            {form.formState.errors.tasks?.[index]?.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.tasks?.[index]?.name?.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`tasks.${index}.description`}>Description</Label>
            <Textarea
              id={`tasks.${index}.description`}
              placeholder="Optional details for the assignee"
              rows={3}
              {...form.register(`tasks.${index}.description` as const)}
              disabled={!isStarted}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`tasks.${index}.assigneeId`}>Assignee *</Label>
              <Select
                value={form.watch(`tasks.${index}.assigneeId` as const)}
                onValueChange={(value) =>
                  form.setValue(`tasks.${index}.assigneeId` as const, value)
                }
                disabled={!isStarted}
              >
                <SelectTrigger id={`tasks.${index}.assigneeId`}>
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.name}
                      {user.role ? ` (${user.role})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.tasks?.[index]?.assigneeId && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.tasks?.[index]?.assigneeId?.message}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`tasks.${index}.estimatedHours`}>
                Estimated Hours *
              </Label>
              <Input
                id={`tasks.${index}.estimatedHours`}
                type="number"
                min="0"
                step="0.5"
                {...form.register(`tasks.${index}.estimatedHours` as const, {
                  valueAsNumber: true,
                })}
                disabled={!isStarted}
              />
              {form.formState.errors.tasks?.[index]?.estimatedHours && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.tasks?.[index]?.estimatedHours?.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`tasks.${index}.dueDate`}>Due Date</Label>
              <Input
                id={`tasks.${index}.dueDate`}
                type="date"
                {...form.register(`tasks.${index}.dueDate` as const)}
                disabled={!isStarted}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`tasks.${index}.priority`}>Priority</Label>
              <Select
                value={form.watch(`tasks.${index}.priority` as const)}
                onValueChange={(value) =>
                  form.setValue(
                    `tasks.${index}.priority` as const,
                    value as FormValues["tasks"][number]["priority"]
                  )
                }
                disabled={!isStarted}
              >
                <SelectTrigger id={`tasks.${index}.priority`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateAndAssignTasksComponentFactory(
  projectId: Id<"projects">,
  users: Doc<"users">[],
  onRedirectStart?: () => void
) {
  return createPsaTaskComponent({
    workflowTaskName: "createAndAssignTasks",
    schema,
    getDefaultValues: () => ({
      executionStrategy: "sequential" as const,
      tasks: [
        {
          name: "",
          description: "",
          assigneeId: users[0]?._id ?? "",
          estimatedHours: 8,
          dueDate: "",
          priority: "Medium" as const,
        },
      ],
    }),
    mapSubmit: ({ values }) => ({
      payload: {
        projectId,
        executionStrategy: values.executionStrategy,
        tasks: values.tasks.map((task) => ({
          name: task.name,
          description: task.description?.trim() || "",
          assigneeIds: [task.assigneeId as Id<"users">],
          estimatedHours: task.estimatedHours,
          dueDate: task.dueDate ? new Date(task.dueDate).getTime() : undefined,
          priority: task.priority,
        })),
      },
    }),
    renderForm: ({ form, isStarted }) => (
      <>
        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Define the initial delivery tasks and assign owners to kick off the
            execution phase.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="executionStrategy">Execution Strategy</Label>
          <Select
            value={form.watch("executionStrategy")}
            onValueChange={(value) =>
              form.setValue(
                "executionStrategy",
                value as FormValues["executionStrategy"]
              )
            }
            disabled={!isStarted}
          >
            <SelectTrigger id="executionStrategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">Sequential</SelectItem>
              <SelectItem value="parallel">Parallel</SelectItem>
              <SelectItem value="conditional">Conditional</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TaskFields form={form} isStarted={isStarted} users={users} />
      </>
    ),
    icon: <ClipboardList className="h-8 w-8 text-orange-500" />,
    title: "Create & Assign Tasks",
    description: "Define execution tasks and assign them to the team",
    formTitle: "Execution Tasks",
    formDescription:
      "Add tasks, owners, and delivery priorities for this project.",
    submitButtonText: "Create Tasks",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: "/projects" });
    },
  });
}

export const Route = createFileRoute(
  "/_app/tasks/createandassigntasks/$projectId"
)({
  component: CreateAndAssignTasksTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function CreateAndAssignTasksTask() {
  const { projectId } = Route.useParams() as { projectId: Id<"projects"> };
  const [isRedirecting, setIsRedirecting] = useState(false);

  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "createAndAssignTasks" }
  );
  const users = useQuery(
    api.workflows.dealToDelivery.api.organizations.listUsers,
    { activeOnly: true }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Tasks created</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to projects...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (workItem === undefined || users === undefined) {
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

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No team members</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            No active team members are available to assign tasks.
          </p>
        </CardContent>
      </Card>
    );
  }

  const Component = CreateAndAssignTasksComponentFactory(
    projectId,
    users,
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
