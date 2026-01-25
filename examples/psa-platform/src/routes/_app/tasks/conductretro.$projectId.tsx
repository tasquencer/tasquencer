/**
 * Conduct Retrospective Task Route - Domain-First Routing
 *
 * TENET-UI-DOMAIN: Route uses projectId (domain ID) for navigation.
 * The workItemId is looked up from the project for workflow execution.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Button } from "@repo/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  ClipboardList,
  Plus,
  X,
  ThumbsUp,
  AlertTriangle,
  Lightbulb,
  Star,
  Loader2,
} from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createPsaTaskComponent } from "@/features/psa/task/createPsaTaskComponent";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Category options for retro items
const categories = [
  { value: "timeline", label: "Timeline" },
  { value: "budget", label: "Budget" },
  { value: "quality", label: "Quality" },
  { value: "communication", label: "Communication" },
  { value: "process", label: "Process" },
  { value: "other", label: "Other" },
] as const;

// Impact options
const impacts = [
  { value: "high", label: "High", color: "text-red-600" },
  { value: "medium", label: "Medium", color: "text-yellow-600" },
  { value: "low", label: "Low", color: "text-green-600" },
] as const;

// Zod schema for the form
const retroItemSchema = z.object({
  category: z.enum(["timeline", "budget", "quality", "communication", "process", "other"]),
  description: z.string().min(5, "Description must be at least 5 characters"),
  impact: z.enum(["high", "medium", "low"]),
});

const improvementSchema = retroItemSchema.extend({
  recommendation: z.string().optional(),
});

const schema = z.object({
  successes: z.array(retroItemSchema).min(1, "Add at least one success"),
  improvements: z.array(improvementSchema),
  keyLearnings: z.array(z.string().min(5, "Learning must be at least 5 characters")),
  recommendations: z.array(z.string().min(5, "Recommendation must be at least 5 characters")),
  clientSatisfactionRating: z.coerce.number().min(1).max(5),
  clientFeedback: z.string().optional(),
  wouldRecommend: z.boolean(),
  testimonialProvided: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

// Component for adding/removing success items
function SuccessesSection({
  successes,
  onAdd,
  onRemove,
  onUpdate,
  disabled,
}: {
  successes: FormValues["successes"];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof FormValues["successes"][0], value: string) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ThumbsUp className="h-5 w-5 text-green-600" />
          What Went Well
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {successes.map((success, index) => (
          <div key={index} className="grid gap-2 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Success #{index + 1}</span>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={success.category}
                onValueChange={(v) => onUpdate(index, "category", v)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={success.impact}
                onValueChange={(v) => onUpdate(index, "impact", v)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Impact" />
                </SelectTrigger>
                <SelectContent>
                  {impacts.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      <span className={i.color}>{i.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="What went well?"
              value={success.description}
              onChange={(e) => onUpdate(index, "description", e.target.value)}
              disabled={disabled}
            />
          </div>
        ))}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Add Success
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Component for adding/removing improvement items
function ImprovementsSection({
  improvements,
  onAdd,
  onRemove,
  onUpdate,
  disabled,
}: {
  improvements: FormValues["improvements"];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof FormValues["improvements"][0], value: string) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          Areas for Improvement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {improvements.map((improvement, index) => (
          <div key={index} className="grid gap-2 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Improvement #{index + 1}</span>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={improvement.category}
                onValueChange={(v) => onUpdate(index, "category", v)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={improvement.impact}
                onValueChange={(v) => onUpdate(index, "impact", v)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Impact" />
                </SelectTrigger>
                <SelectContent>
                  {impacts.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      <span className={i.color}>{i.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="What could be improved?"
              value={improvement.description}
              onChange={(e) => onUpdate(index, "description", e.target.value)}
              disabled={disabled}
            />
            <Input
              placeholder="Recommendation (optional)"
              value={improvement.recommendation ?? ""}
              onChange={(e) => onUpdate(index, "recommendation", e.target.value)}
              disabled={disabled}
            />
          </div>
        ))}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Add Improvement
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Component for string array (learnings/recommendations)
function StringArraySection({
  title,
  icon,
  items,
  placeholder,
  onAdd,
  onRemove,
  onUpdate,
  disabled,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  placeholder: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              placeholder={placeholder}
              value={item}
              onChange={(e) => onUpdate(index, e.target.value)}
              disabled={disabled}
              className="flex-1"
            />
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ConductRetroTaskComponentFactory(onRedirectStart?: () => void) {
  return createPsaTaskComponent({
    workflowTaskName: "conductRetro",
  schema,
  getDefaultValues: () => ({
    successes: [
      { category: "timeline" as const, description: "", impact: "medium" as const },
    ],
    improvements: [],
    keyLearnings: [""],
    recommendations: [],
    clientSatisfactionRating: 4,
    clientFeedback: "",
    wouldRecommend: true,
    testimonialProvided: false,
  }),
  mapSubmit: ({ values, task }) => ({
    payload: {
      projectId: task.aggregateTableId, // Project ID is stored in aggregateTableId
      retrospective: {
        successes: values.successes.filter((s) => s.description.length > 0),
        improvements: values.improvements.filter((i) => i.description.length > 0),
        keyLearnings: values.keyLearnings.filter((l) => l.length > 0),
        recommendations: values.recommendations.filter((r) => r.length > 0),
        clientSatisfaction: {
          rating: values.clientSatisfactionRating as 1 | 2 | 3 | 4 | 5,
          feedback: values.clientFeedback || undefined,
          wouldRecommend: values.wouldRecommend,
          testimonialProvided: values.testimonialProvided,
        },
      },
      participants: [], // TODO: Allow selecting participants
    },
  }),
  renderForm: ({ form, isStarted }) => {
    const successes = form.watch("successes");
    const improvements = form.watch("improvements");
    const keyLearnings = form.watch("keyLearnings");
    const recommendations = form.watch("recommendations");

    return (
      <div className="space-y-4">
        {/* Introduction */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/50 p-4">
          <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            Project Retrospective
          </h4>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Capture key learnings from this project. This information helps improve
            future projects and builds organizational knowledge.
          </p>
        </div>

        {/* Successes Section */}
        <SuccessesSection
          successes={successes}
          onAdd={() =>
            form.setValue("successes", [
              ...successes,
              { category: "quality", description: "", impact: "medium" },
            ])
          }
          onRemove={(index) =>
            form.setValue(
              "successes",
              successes.filter((_, i) => i !== index)
            )
          }
          onUpdate={(index, field, value) => {
            const updated = [...successes];
            // Type assertion needed for dynamic field update
            (updated[index] as Record<string, string>)[field] = value;
            form.setValue("successes", updated);
          }}
          disabled={!isStarted}
        />

        {/* Improvements Section */}
        <ImprovementsSection
          improvements={improvements}
          onAdd={() =>
            form.setValue("improvements", [
              ...improvements,
              { category: "process", description: "", impact: "medium", recommendation: "" },
            ])
          }
          onRemove={(index) =>
            form.setValue(
              "improvements",
              improvements.filter((_, i) => i !== index)
            )
          }
          onUpdate={(index, field, value) => {
            const updated = [...improvements];
            (updated[index] as Record<string, string>)[field] = value;
            form.setValue("improvements", updated);
          }}
          disabled={!isStarted}
        />

        {/* Key Learnings */}
        <StringArraySection
          title="Key Learnings"
          icon={<Lightbulb className="h-5 w-5 text-amber-500" />}
          items={keyLearnings}
          placeholder="What did the team learn?"
          onAdd={() => form.setValue("keyLearnings", [...keyLearnings, ""])}
          onRemove={(index) =>
            form.setValue(
              "keyLearnings",
              keyLearnings.filter((_, i) => i !== index)
            )
          }
          onUpdate={(index, value) => {
            const updated = [...keyLearnings];
            updated[index] = value;
            form.setValue("keyLearnings", updated);
          }}
          disabled={!isStarted}
        />

        {/* Recommendations */}
        <StringArraySection
          title="Recommendations for Future Projects"
          icon={<ClipboardList className="h-5 w-5 text-purple-500" />}
          items={recommendations}
          placeholder="What would you recommend for similar projects?"
          onAdd={() => form.setValue("recommendations", [...recommendations, ""])}
          onRemove={(index) =>
            form.setValue(
              "recommendations",
              recommendations.filter((_, i) => i !== index)
            )
          }
          onUpdate={(index, value) => {
            const updated = [...recommendations];
            updated[index] = value;
            form.setValue("recommendations", updated);
          }}
          disabled={!isStarted}
        />

        {/* Client Satisfaction */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Client Satisfaction
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="clientSatisfactionRating">Overall Rating</Label>
              <Select
                value={String(form.watch("clientSatisfactionRating"))}
                onValueChange={(v) =>
                  form.setValue("clientSatisfactionRating", parseInt(v, 10))
                }
                disabled={!isStarted}
              >
                <SelectTrigger id="clientSatisfactionRating">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 - Exceptional</SelectItem>
                  <SelectItem value="4">4 - Very Satisfied</SelectItem>
                  <SelectItem value="3">3 - Satisfied</SelectItem>
                  <SelectItem value="2">2 - Somewhat Dissatisfied</SelectItem>
                  <SelectItem value="1">1 - Very Dissatisfied</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientFeedback">Client Feedback (Optional)</Label>
              <Textarea
                id="clientFeedback"
                placeholder="Any specific feedback from the client..."
                rows={3}
                {...form.register("clientFeedback")}
                disabled={!isStarted}
              />
            </div>

            <div className="flex items-start space-x-3">
              <Checkbox
                id="wouldRecommend"
                checked={form.watch("wouldRecommend")}
                onCheckedChange={(checked) =>
                  form.setValue("wouldRecommend", checked === true)
                }
                disabled={!isStarted}
              />
              <div className="space-y-1">
                <Label htmlFor="wouldRecommend" className="font-medium">
                  Client would recommend
                </Label>
                <p className="text-sm text-muted-foreground">
                  The client indicated they would recommend our services
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <Checkbox
                id="testimonialProvided"
                checked={form.watch("testimonialProvided")}
                onCheckedChange={(checked) =>
                  form.setValue("testimonialProvided", checked === true)
                }
                disabled={!isStarted}
              />
              <div className="space-y-1">
                <Label htmlFor="testimonialProvided" className="font-medium">
                  Testimonial provided
                </Label>
                <p className="text-sm text-muted-foreground">
                  The client provided a testimonial or case study
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form Errors */}
        {form.formState.errors.successes && (
          <p className="text-sm text-destructive">
            {form.formState.errors.successes.message ||
              form.formState.errors.successes.root?.message}
          </p>
        )}
      </div>
    );
  },
  icon: <ClipboardList className="h-8 w-8 text-purple-500" />,
  title: "Conduct Retrospective",
  description: "Document project learnings and capture client feedback",
  formTitle: "Project Retrospective Form",
  formDescription:
    "Record what went well, areas for improvement, and key learnings from the project.",
    submitButtonText: "Complete Retrospective",
    onSuccess: ({ navigate }) => {
      onRedirectStart?.();
      navigate({ to: "/projects" });
    },
  });
}

export const Route = createFileRoute("/_app/tasks/conductretro/$projectId")({
  component: ConductRetroTask,
});

/**
 * Route component that looks up workItemId from projectId.
 *
 * TENET-UI-DOMAIN: Uses domain ID (projectId) for routing, looks up workItemId for execution.
 */
function ConductRetroTask() {
  const { projectId } = Route.useParams() as {
    projectId: Id<"projects">;
  };
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Look up the work item from the project ID and task type
  const workItem = useQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemByProjectAndType,
    { projectId, taskType: "conductRetro" }
  );

  // Show redirecting screen when submission completes
  if (isRedirecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Retrospective completed</h3>
          <p className="text-muted-foreground mt-1">
            Redirecting to projects...
          </p>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (workItem === undefined) {
    return <SpinningLoader />;
  }

  // No active work item for this task
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

  const Component = ConductRetroTaskComponentFactory(
    () => setIsRedirecting(true)
  );

  return (
    <Suspense fallback={<SpinningLoader />}>
      <Component workItemId={workItem.workItemId} />
    </Suspense>
  );
}
