import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type DefaultValues,
  type UseFormReturn,
} from "react-hook-form";
import { z } from "zod";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import type { TaskMetadata } from "@/types/psa";
import { TaskFormLayout } from "@/features/psa/components/task-form-layout";
import { usePsaTask } from "../hooks/usePsaTask";

type MetaContext = {
  deal: Doc<"deals"> | null;
  task: TaskMetadata;
};

/**
 * Configuration for creating a PSA task component.
 *
 * Pattern reference: examples/er/src/features/er/task/createErTaskComponent.tsx
 */
export interface PsaTaskRouteConfig<Schema extends z.ZodObject<z.ZodRawShape>> {
  /** The work item name in the workflow definition */
  workflowTaskName: string;
  /** Zod schema for form validation */
  schema: Schema;
  /** Function to get default form values from context */
  getDefaultValues: (context: MetaContext) => z.input<Schema>;
  /** Function to map form values to work item completion payload */
  mapSubmit: (context: {
    values: z.output<Schema>;
    deal: Doc<"deals"> | null;
    task: TaskMetadata;
  }) => {
    payload: Record<string, unknown>;
    name?: string;
  };
  /** Function to render the form fields */
  renderForm: (context: {
    form: UseFormReturn<z.input<Schema>, unknown, z.output<Schema>>;
    deal: Doc<"deals"> | null;
    task: TaskMetadata;
    isStarted: boolean;
  }) => ReactNode;
  /** Icon to display in the header */
  icon: ReactNode;
  /** Page title (can be a function for dynamic titles) */
  title: string | ((context: MetaContext) => string);
  /** Page description (can be a function for dynamic descriptions) */
  description: string | ((context: MetaContext) => string);
  /** Form section title (defaults to page title) */
  formTitle?: string | ((context: MetaContext) => string);
  /** Form section description */
  formDescription?: string | ((context: MetaContext) => string);
  /** Submit button text */
  submitButtonText?: string;
  /** Submit button variant */
  submitButtonVariant?: "default" | "destructive";
  /** Dynamic submit button props based on form state */
  getSubmitProps?: (context: {
    form: UseFormReturn<z.input<Schema>, unknown, z.output<Schema>>;
    deal: Doc<"deals"> | null;
    task: TaskMetadata;
  }) => {
    text?: string;
    variant?: "default" | "destructive";
  };
  /** Custom can-claim logic (defaults to API check) */
  getCanClaim?: (context: MetaContext) => boolean | undefined;
  /** Custom success handler */
  onSuccess?: (context: {
    navigate: ReturnType<typeof useNavigate>;
    deal: Doc<"deals"> | null;
    task: TaskMetadata;
  }) => Promise<void> | void;
  /** Custom back navigation */
  backTo?: string;
  backLabel?: string;
}

/**
 * Factory function to create standardized PSA task completion components.
 *
 * Creates a React component with:
 * - Automatic form validation via Zod
 * - Claim/start work item handling
 * - Complete work item submission
 * - Error handling and display
 * - Consistent layout via TaskFormLayout
 *
 * @example
 * ```tsx
 * const QualifyLeadTask = createPsaTaskComponent({
 *   workflowTaskName: "qualifyLead",
 *   schema: z.object({
 *     budgetConfirmed: z.boolean(),
 *     authorityConfirmed: z.boolean(),
 *     needConfirmed: z.boolean(),
 *     timelineConfirmed: z.boolean(),
 *     notes: z.string().min(10),
 *   }),
 *   // ... other config
 * });
 * ```
 */
export function createPsaTaskComponent<
  Schema extends z.ZodObject<z.ZodRawShape>,
>(config: PsaTaskRouteConfig<Schema>) {
  const resolveMeta = (
    value: string | ((context: MetaContext) => string) | undefined,
    context: MetaContext
  ) => {
    if (typeof value === "function") {
      return value(context);
    }
    return value;
  };

  type FormInputValues = z.input<Schema>;
  type FormOutputValues = z.output<Schema>;

  return function PsaTaskComponent({
    workItemId,
  }: {
    workItemId: Id<"tasquencerWorkItems">;
  }) {
    const navigate = useNavigate();
    const { task, deal, canClaimWorkItem, startWorkItem, completeWorkItem } =
      usePsaTask(workItemId);

    const [claiming, setClaiming] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    if (!task) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          Task details unavailable.
        </div>
      );
    }

    const metaContext: MetaContext = { deal, task };

    const defaultValues = useMemo(
      () => config.getDefaultValues(metaContext),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [deal?._id, task._id]
    );

    const form = useForm<FormInputValues, unknown, FormOutputValues>({
      resolver: zodResolver(config.schema),
      defaultValues: defaultValues as DefaultValues<FormInputValues>,
    });

    const handleClaim = async () => {
      setClaiming(true);
      setErrorMessage(null);
      try {
        await startWorkItem({
          workItemId,
          args: {
            name: config.workflowTaskName as never,
            payload: {} as never,
          },
        });
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to claim task."
        );
      } finally {
        setClaiming(false);
      }
    };

    const handleValidSubmit = async (values: FormOutputValues) => {
      setSubmitting(true);
      setErrorMessage(null);
      try {
        const { payload, name } = config.mapSubmit({
          values,
          deal,
          task,
        });
        await completeWorkItem({
          workItemId,
          args: {
            name: (name ?? config.workflowTaskName) as never,
            payload: payload as never,
          },
        });

        if (config.onSuccess) {
          await config.onSuccess({ navigate, deal, task });
        } else {
          navigate({ to: "/tasks" });
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to submit task."
        );
      } finally {
        setSubmitting(false);
      }
    };

    const submit = () => form.handleSubmit(handleValidSubmit)();

    const resolvedTitle = resolveMeta(config.title, metaContext);
    const resolvedDescription = resolveMeta(config.description, metaContext);
    const resolvedFormTitle = resolveMeta(
      config.formTitle ?? config.title,
      metaContext
    );
    const resolvedFormDescription = resolveMeta(
      config.formDescription,
      metaContext
    );

    const dynamicSubmitProps = config.getSubmitProps
      ? config.getSubmitProps({ form, deal, task })
      : undefined;

    return (
      <TaskFormLayout
        deal={deal}
        task={task}
        icon={config.icon}
        title={resolvedTitle ?? ""}
        description={resolvedDescription ?? ""}
        formTitle={resolvedFormTitle}
        formDescription={resolvedFormDescription}
        onSubmit={submit}
        onClaim={handleClaim}
        isSubmitting={submitting}
        isClaiming={claiming}
        canClaim={
          config.getCanClaim
            ? config.getCanClaim(metaContext)
            : canClaimWorkItem
        }
        errorMessage={errorMessage}
        submitButtonText={dynamicSubmitProps?.text ?? config.submitButtonText}
        submitButtonVariant={
          dynamicSubmitProps?.variant ?? config.submitButtonVariant
        }
        backTo={config.backTo}
        backLabel={config.backLabel}
      >
        {(isStarted) =>
          config.renderForm({
            form,
            deal,
            task,
            isStarted,
          })
        }
      </TaskFormLayout>
    );
  };
}
