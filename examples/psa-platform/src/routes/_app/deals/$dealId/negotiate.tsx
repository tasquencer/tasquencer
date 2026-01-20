import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
import { Input } from '@repo/ui/components/input'
import { Textarea } from '@repo/ui/components/textarea'
import { Separator } from '@repo/ui/components/separator'
import { Badge } from '@repo/ui/components/badge'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  MessageSquare,
  DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/negotiate')({
  component: NegotiatePage,
  loader: () => ({
    crumb: 'Negotiate Terms',
  }),
})

const negotiateFormSchema = z.object({
  outcome: z.enum(['proceed', 'revise', 'lost'], {
    message: 'Select a negotiation outcome',
  }),
  adjustedValue: z.number().min(0, 'Value must be positive').optional(),
  negotiationNotes: z.string().max(2000, 'Notes must be less than 2000 characters').optional(),
})

type NegotiateFormValues = z.infer<typeof negotiateFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function NegotiatePage() {
  const { dealId } = Route.useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  const latestProposal = useQuery(
    api.workflows.dealToDelivery.api.proposals.getLatestProposal,
    { dealId: dealId as Id<'deals'> }
  )

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

  const form = useForm<NegotiateFormValues>({
    resolver: zodResolver(negotiateFormSchema),
    defaultValues: {
      outcome: 'proceed',
      negotiationNotes: '',
    },
  })

  // Find the negotiateTerms work item
  const negotiateWorkItem = workItems?.find(
    (wi) => wi.taskType === 'negotiateTerms' && wi.status !== 'completed'
  )

  // Pre-fill adjusted value from deal if available
  const currentValue = deal?.value ? deal.value / 100 : 0

  async function onSubmit(data: NegotiateFormValues) {
    if (!negotiateWorkItem) {
      toast.error('Cannot negotiate at this time')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (negotiateWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: negotiateWorkItem.workItemId,
          args: {
            name: 'negotiateTerms' as const,
          },
        })
      }

      // Complete the work item with negotiation details
      await completeWorkItem({
        workItemId: negotiateWorkItem.workItemId,
        args: {
          name: 'negotiateTerms' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            outcome: data.outcome,
            negotiationNotes: data.negotiationNotes || undefined,
            adjustedValue: data.adjustedValue ? Math.round(data.adjustedValue * 100) : undefined,
          },
        },
      })

      toast.success('Negotiation recorded - deal moved to Negotiation stage')

      setIsRedirecting(true)

      // Navigate back to deal detail
      navigate({ to: '/deals/$dealId', params: { dealId } })
    } catch (error) {
      console.error('Failed to record negotiation:', error)
      toast.error('Failed to record negotiation. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (deal === undefined || latestProposal === undefined || workItems === undefined) {
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
            <a href="/deals">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deals
            </a>
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
            {isRedirecting ? 'Negotiation saved' : 'Submitting negotiation'}
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

  // Check if work item is available
  if (!negotiateWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Cannot negotiate</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The negotiate terms work item is not available. The workflow may
            not have reached this step yet.
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
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Negotiate Terms: {deal.name}</CardTitle>
            <CardDescription>
              Record client feedback and any value adjustments
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Current Deal Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h4 className="font-medium">Current Deal Status</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Stage</p>
                <Badge variant="secondary">{deal.stage}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Current Value</p>
                <p className="font-medium">{formatCurrency(deal.value)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Probability</p>
                <p className="font-medium">{deal.probability}%</p>
              </div>
            </div>
            {latestProposal && (
              <div className="pt-2">
                <p className="text-sm text-muted-foreground">
                  Proposal v{latestProposal.version} - Status: {latestProposal.status}
                  {latestProposal.sentAt && (
                    <span className="ml-2">
                      (Sent {new Date(latestProposal.sentAt).toLocaleDateString()})
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Outcome */}
          <div className="space-y-2">
            <Label className="text-base font-medium">Negotiation Outcome *</Label>
            <RadioGroup
              value={form.watch('outcome')}
              onValueChange={(value: string) =>
                form.setValue('outcome', value as 'proceed' | 'revise' | 'lost')
              }
              className="grid gap-3"
            >
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="proceed" id="outcome-proceed" />
                <Label htmlFor="outcome-proceed" className="grid gap-1">
                  <span className="font-medium">Ready to sign</span>
                  <span className="text-sm text-muted-foreground">
                    Client accepts the proposal. Move toward signature.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="revise" id="outcome-revise" />
                <Label htmlFor="outcome-revise" className="grid gap-1">
                  <span className="font-medium">Needs revision</span>
                  <span className="text-sm text-muted-foreground">
                    Client requested changes. Create a revised proposal.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="lost" id="outcome-lost" />
                <Label htmlFor="outcome-lost" className="grid gap-1">
                  <span className="font-medium">Deal lost</span>
                  <span className="text-sm text-muted-foreground">
                    Client declined. Archive the deal.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {form.formState.errors.outcome && (
              <p className="text-sm text-destructive">
                {form.formState.errors.outcome.message}
              </p>
            )}
          </div>

          <Separator />

          {/* Adjusted Value */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="adjustedValue">Adjusted Deal Value (Optional)</Label>
            </div>
            <Input
              id="adjustedValue"
              type="number"
              step="0.01"
              placeholder={currentValue.toString()}
              {...form.register('adjustedValue', { valueAsNumber: true })}
            />
            {form.formState.errors.adjustedValue && (
              <p className="text-sm text-destructive">
                {form.formState.errors.adjustedValue.message}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              If the client requested changes to the pricing, enter the new agreed value.
              Leave blank to keep the current value.
            </p>
          </div>

          <Separator />

          {/* Negotiation Notes */}
          <div className="space-y-2">
            <Label htmlFor="negotiationNotes">Negotiation Notes (Optional)</Label>
            <Textarea
              id="negotiationNotes"
              placeholder="Client feedback, requested changes, agreed modifications..."
              {...form.register('negotiationNotes')}
              className="min-h-[120px]"
            />
            {form.formState.errors.negotiationNotes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.negotiationNotes.message}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Document any feedback from the client and changes discussed.
            </p>
          </div>

          <Separator />

          {/* What happens next info */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              What happens next?
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              We will route to the next step based on your selected outcome.
            </p>
          </div>

          <Separator />

          {/* Form Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" type="button" asChild>
              <a href={`/deals/${dealId}`}>
                Cancel
              </a>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Record Negotiation
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
