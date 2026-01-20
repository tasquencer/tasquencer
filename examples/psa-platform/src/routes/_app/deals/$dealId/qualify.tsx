import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { Button } from '@repo/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Textarea } from '@repo/ui/components/textarea'
import { Checkbox } from '@repo/ui/components/checkbox'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import { Separator } from '@repo/ui/components/separator'
import { Alert, AlertDescription } from '@repo/ui/components/alert'
import {
  ArrowLeft,
  ClipboardCheck,
  AlertTriangle,
  Loader2,
  DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/qualify')({
  component: QualifyLeadPage,
  loader: () => ({
    crumb: 'Qualify Lead',
  }),
})

const qualifyFormSchema = z.object({
  qualified: z.enum(['qualify', 'disqualify'], {
    message: 'Please select qualify or disqualify',
  }),
  notes: z
    .string()
    .min(10, 'Notes must be at least 10 characters')
    .max(2000, 'Notes must be less than 2000 characters'),
  budget: z.boolean(),
  authority: z.boolean(),
  need: z.boolean(),
  timeline: z.boolean(),
})

type QualifyFormValues = z.infer<typeof qualifyFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function QualifyLeadPage() {
  const { dealId } = Route.useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  const workItems = useQuery(
    api.workflows.dealToDelivery.api.workItems.getTasksByDeal,
    { dealId: dealId as Id<'deals'> }
  )

  const startWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.startWorkItem
  )
  const completeWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.completeWorkItem
  )

  const form = useForm<QualifyFormValues>({
    resolver: zodResolver(qualifyFormSchema),
    defaultValues: {
      qualified: undefined,
      notes: '',
      budget: false,
      authority: false,
      need: false,
      timeline: false,
    },
  })

  const watchQualified = form.watch('qualified')
  const watchBant = form.watch(['budget', 'authority', 'need', 'timeline'])
  const bantCount = watchBant.filter(Boolean).length

  // Find the qualifyLead work item
  const qualifyWorkItem = workItems?.find(
    (wi) => wi.taskType === 'qualifyLead' && wi.status !== 'completed'
  )

  const showMismatchWarning =
    (watchQualified === 'qualify' && bantCount < 2) ||
    (watchQualified === 'disqualify' && bantCount === 4)

  async function onSubmit(data: QualifyFormValues) {
    if (!qualifyWorkItem) {
      toast.error('No qualification work item available')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (qualifyWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: qualifyWorkItem.workItemId,
          args: {
            name: 'qualifyLead' as const,
          },
        })
      }

      // Complete the work item
      await completeWorkItem({
        workItemId: qualifyWorkItem.workItemId,
        args: {
          name: 'qualifyLead' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            qualified: data.qualified === 'qualify',
            qualificationNotes: data.notes,
            budget: data.budget,
            authority: data.authority,
            need: data.need,
            timeline: data.timeline,
          },
        },
      })

      toast.success(
        data.qualified === 'qualify'
          ? 'Lead qualified successfully'
          : 'Lead disqualified'
      )

      setIsRedirecting(true)

      // Navigate back to deal detail or pipeline
      if (data.qualified === 'qualify') {
        navigate({ to: '/deals/$dealId', params: { dealId } })
      } else {
        navigate({ to: '/deals' })
      }
    } catch (error) {
      console.error('Failed to submit qualification:', error)
      toast.error('Failed to submit qualification. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (deal === undefined || workItems === undefined) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (deal === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <h3 className="text-lg font-medium">Deal not found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The deal you're looking for doesn't exist.
          </p>
          <Button asChild>
            <Link to="/deals">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deals
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (isRedirecting || isSubmitting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">
            {isRedirecting ? 'Qualification saved' : 'Submitting qualification'}
          </h3>
          <p className="text-muted-foreground mt-1">
            {isRedirecting
              ? 'Redirecting back to the deal.'
              : 'This should only take a moment.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (deal.stage !== 'Lead') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Cannot qualify this deal</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            This deal is already in the "{deal.stage}" stage and cannot be
            qualified.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deal
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!qualifyWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">
            No qualification task available
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The qualification work item is not available yet. The workflow may
            not have reached this step.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deal
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Qualify Lead</CardTitle>
            <CardDescription>
              Assess this lead using BANT criteria
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Deal Info (Read-only) */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <h4 className="font-medium">{deal.name}</h4>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <DollarSign className="h-4 w-4" />
                <span>{formatCurrency(deal.value)}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* BANT Criteria */}
          <div className="space-y-4">
            <h4 className="font-medium">BANT Assessment</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="budget"
                  checked={form.watch('budget')}
                  onCheckedChange={(checked) =>
                    form.setValue('budget', checked === true)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="budget" className="font-medium">
                    Budget
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Has budget allocated for this project
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="authority"
                  checked={form.watch('authority')}
                  onCheckedChange={(checked) =>
                    form.setValue('authority', checked === true)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="authority" className="font-medium">
                    Authority
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Contact is a decision maker
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="need"
                  checked={form.watch('need')}
                  onCheckedChange={(checked) =>
                    form.setValue('need', checked === true)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="need" className="font-medium">
                    Need
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Has a clear need for our services
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Checkbox
                  id="timeline"
                  checked={form.watch('timeline')}
                  onCheckedChange={(checked) =>
                    form.setValue('timeline', checked === true)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="timeline" className="font-medium">
                    Timeline
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Has a clear timeline for the project
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {bantCount} of 4 BANT criteria met
            </p>
          </div>

          <Separator />

          {/* Qualification Decision */}
          <div className="space-y-4">
            <h4 className="font-medium">Qualification Decision</h4>
            <RadioGroup
              value={form.watch('qualified')}
              onValueChange={(value: string) =>
                form.setValue('qualified', value as 'qualify' | 'disqualify')
              }
              className="grid grid-cols-2 gap-4"
            >
              <div>
                <RadioGroupItem
                  value="qualify"
                  id="qualify"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="qualify"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <span className="font-medium">Qualify Lead</span>
                  <span className="text-sm text-muted-foreground">
                    Move to Qualified stage
                  </span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="disqualify"
                  id="disqualify"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="disqualify"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-destructive [&:has([data-state=checked])]:border-destructive cursor-pointer"
                >
                  <span className="font-medium">Disqualify Lead</span>
                  <span className="text-sm text-muted-foreground">
                    Archive this deal
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {form.formState.errors.qualified && (
              <p className="text-sm text-destructive">
                {form.formState.errors.qualified.message}
              </p>
            )}
          </div>

          {/* Warning for BANT mismatch */}
          {showMismatchWarning && (
            <Alert variant="default" className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-800">
                {watchQualified === 'qualify' && bantCount < 2
                  ? 'Consider whether qualification is appropriate with limited BANT criteria met.'
                  : 'All BANT criteria are met - are you sure this should be disqualified?'}
              </AlertDescription>
            </Alert>
          )}

          {/* Qualification Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">
              Qualification Notes <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="notes"
              placeholder="Enter your qualification notes (min 10 characters)..."
              {...form.register('notes')}
              className="min-h-[100px]"
            />
            {form.formState.errors.notes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>

          <Separator />

          {/* Form Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" type="button" asChild>
              <a href={`/deals/${dealId}`}>Cancel</a>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Submit Qualification
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
