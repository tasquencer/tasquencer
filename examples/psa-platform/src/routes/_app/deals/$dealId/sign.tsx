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
import { Separator } from '@repo/ui/components/separator'
import { Badge } from '@repo/ui/components/badge'
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Award,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/sign')({
  component: SignProposalPage,
  loader: () => ({
    crumb: 'Mark as Signed',
  }),
})

const signFormSchema = z.object({
  signedBy: z.string().min(1, 'Signer name is required'),
  signedAt: z.string().min(1, 'Signature date is required'),
})

type SignFormValues = z.infer<typeof signFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function SignProposalPage() {
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

  // Default to today's date
  const today = new Date().toISOString().split('T')[0]

  const form = useForm<SignFormValues>({
    resolver: zodResolver(signFormSchema),
    defaultValues: {
      signedBy: '',
      signedAt: today,
    },
  })

  // Find the getProposalSigned work item
  const signWorkItem = workItems?.find(
    (wi) => wi.taskType === 'getProposalSigned' && wi.status !== 'completed'
  )

  async function onSubmit(data: SignFormValues) {
    if (!signWorkItem || !latestProposal) {
      toast.error('Cannot mark as signed at this time')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (signWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: signWorkItem.workItemId,
          args: {
            name: 'getProposalSigned' as const,
          },
        })
      }

      // Convert date string to timestamp
      const signedAt = new Date(data.signedAt).getTime()

      // Complete the work item
      await completeWorkItem({
        workItemId: signWorkItem.workItemId,
        args: {
          name: 'getProposalSigned' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            proposalId: latestProposal._id,
            signedAt,
          },
        },
      })

      toast.success('🎉 Deal won! Proposal marked as signed.')

      setIsRedirecting(true)

      // Navigate back to deal detail
      navigate({ to: '/deals/$dealId', params: { dealId } })
    } catch (error) {
      console.error('Failed to mark as signed:', error)
      toast.error('Failed to mark as signed. Please try again.')
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
            {isRedirecting ? 'Signature recorded' : 'Submitting signature'}
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

  // Check if proposal exists
  if (!latestProposal) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No proposal found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            A proposal must exist before it can be marked as signed.
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

  // Check if work item is available
  if (!signWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Cannot mark as signed</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The sign proposal work item is not available. The workflow may
            not have reached this step yet. Make sure the deal is in Negotiation stage.
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400">
            <Award className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Mark Proposal as Signed: {deal.name}</CardTitle>
            <CardDescription>
              Record the signature to close this deal as won
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Deal & Proposal Summary */}
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              <h4 className="font-medium text-green-900 dark:text-green-100">
                Ready to close this deal!
              </h4>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-green-700 dark:text-green-300">Deal Value</p>
                <p className="font-bold text-green-900 dark:text-green-100 text-lg">
                  {formatCurrency(deal.value)}
                </p>
              </div>
              <div>
                <p className="text-green-700 dark:text-green-300">Proposal Version</p>
                <p className="font-medium text-green-900 dark:text-green-100">
                  v{latestProposal.version}
                </p>
              </div>
              <div>
                <p className="text-green-700 dark:text-green-300">Current Stage</p>
                <Badge variant="secondary">{deal.stage}</Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Signature Details */}
          <div className="space-y-4">
            <h4 className="font-medium">Signature Details</h4>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="signedBy">Signed By *</Label>
                <Input
                  id="signedBy"
                  placeholder="Client name who signed"
                  {...form.register('signedBy')}
                />
                {form.formState.errors.signedBy && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.signedBy.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="signedAt">Signature Date *</Label>
                <Input
                  id="signedAt"
                  type="date"
                  max={today}
                  {...form.register('signedAt')}
                />
                {form.formState.errors.signedAt && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.signedAt.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* What happens next info */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              What happens when you mark this as signed?
            </h4>
            <ul className="text-sm text-blue-700 dark:text-blue-300 list-disc list-inside space-y-1">
              <li>The deal will be marked as "Won" with 100% probability</li>
              <li>The proposal status will change to "Signed"</li>
              <li>The sales workflow will complete successfully</li>
              <li>A project can then be created for delivery</li>
            </ul>
          </div>

          <Separator />

          {/* Form Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" type="button" asChild>
              <a href={`/deals/${dealId}`}>
                Cancel
              </a>
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Mark as Signed - Close Deal
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
