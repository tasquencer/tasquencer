import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type DefaultValues, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import type { Id, Doc } from '@/convex/_generated/dataModel'
import type { TaskMetadata } from '@/types/er'
import { TaskFormLayout } from '@/features/er/components/task-form-layout'
import { useErTask } from '../hooks/useErTask'

type MetaContext = {
  patient: Doc<'erPatients'>
  task: TaskMetadata
}

export interface ErTaskRouteConfig<
  Schema extends z.ZodObject<z.ZodRawShape>,
> {
  workflowTaskName: string
  schema: Schema
  getDefaultValues: (context: MetaContext) => z.input<Schema>
  mapSubmit: (context: {
    values: z.output<Schema>
    patient: Doc<'erPatients'>
    task: TaskMetadata
  }) => {
    payload: Record<string, unknown>
    name?: string
  }
  renderForm: (context: {
    form: UseFormReturn<z.input<Schema>, any, z.output<Schema>>
    patient: Doc<'erPatients'>
    task: TaskMetadata
    isStarted: boolean
  }) => ReactNode
  icon: ReactNode
  title: string | ((context: MetaContext) => string)
  description: string | ((context: MetaContext) => string)
  formTitle?: string | ((context: MetaContext) => string)
  formDescription?: string | ((context: MetaContext) => string)
  submitButtonText?: string
  submitButtonVariant?: 'default' | 'destructive'
  getSubmitProps?: (context: {
    form: UseFormReturn<z.input<Schema>, any, z.output<Schema>>
    patient: Doc<'erPatients'>
    task: TaskMetadata
  }) => {
    text?: string
    variant?: 'default' | 'destructive'
  }
  getCanClaim?: (context: MetaContext) => boolean | undefined
  onSuccess?: (context: {
    navigate: ReturnType<typeof useNavigate>
    patient: Doc<'erPatients'>
    task: TaskMetadata
  }) => Promise<void> | void
}

export function createErTaskComponent<
  Schema extends z.ZodObject<z.ZodRawShape>,
>(
  config: ErTaskRouteConfig<Schema>,
) {
  const resolveMeta = (
    value: string | ((context: MetaContext) => string) | undefined,
    context: MetaContext,
  ) => {
    if (typeof value === 'function') {
      return value(context)
    }
    return value
  }

  type FormInputValues = z.input<Schema>
  type FormOutputValues = z.output<Schema>

  return function ErTaskComponent({
    workItemId,
  }: {
    workItemId: Id<'tasquencerWorkItems'>
  }) {
    const navigate = useNavigate()
    const { task, patient, canClaimWorkItem, startWorkItem, completeWorkItem } =
      useErTask(workItemId)

    const [claiming, setClaiming] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    if (!task || !patient) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          Task details unavailable.
        </div>
      )
    }

    const metaContext: MetaContext = { patient, task }

    const defaultValues = useMemo(
      () => config.getDefaultValues(metaContext),
      [patient, task],
    )

    const form = useForm<FormInputValues, any, FormOutputValues>({
      resolver: zodResolver(config.schema),
      defaultValues: defaultValues as DefaultValues<FormInputValues>,
    })

    const handleClaim = async () => {
      setClaiming(true)
      setErrorMessage(null)
      try {
        await startWorkItem({
          workItemId,
          args: {
            name: config.workflowTaskName as any,
            payload: {} as any,
          },
        })
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to claim task.',
        )
      } finally {
        setClaiming(false)
      }
    }

    const handleValidSubmit = async (values: FormOutputValues) => {
      setSubmitting(true)
      setErrorMessage(null)
      try {
        const { payload, name } = config.mapSubmit({
          values,
          patient,
          task,
        })
        await completeWorkItem({
          workItemId,
          args: {
            name: (name ?? config.workflowTaskName) as any,
            payload: payload as any,
          },
        })

        if (config.onSuccess) {
          await config.onSuccess({ navigate, patient, task })
        } else {
          navigate({ to: '/er/queue' })
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to submit task.',
        )
      } finally {
        setSubmitting(false)
      }
    }

    const submit = () => form.handleSubmit(handleValidSubmit)()

    const resolvedTitle = resolveMeta(config.title, metaContext)
    const resolvedDescription = resolveMeta(config.description, metaContext)
    const resolvedFormTitle = resolveMeta(
      config.formTitle ?? config.title,
      metaContext,
    )
    const resolvedFormDescription = resolveMeta(
      config.formDescription,
      metaContext,
    )

    const dynamicSubmitProps = config.getSubmitProps
      ? config.getSubmitProps({ form, patient, task })
      : undefined

    return (
      <TaskFormLayout
        patient={patient}
        task={task}
        icon={config.icon}
        title={resolvedTitle ?? ''}
        description={resolvedDescription ?? ''}
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
      >
        {(isStarted) =>
          config.renderForm({
            form,
            patient,
            task,
            isStarted,
          })
        }
      </TaskFormLayout>
    )
  }
}
