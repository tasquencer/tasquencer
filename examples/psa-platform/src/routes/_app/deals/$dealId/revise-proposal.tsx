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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@repo/ui/components/table'
import {
  ArrowLeft,
  FileCheck,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/revise-proposal')({
  component: ReviseProposalPage,
  loader: () => ({
    crumb: 'Revise Proposal',
  }),
})

const reviseProposalFormSchema = z.object({
  documentUrl: z.string().url('Enter a valid document URL'),
  revisionNotes: z
    .string()
    .max(2000, 'Notes must be less than 2000 characters')
    .optional(),
})

type ReviseProposalFormValues = z.infer<typeof reviseProposalFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function ReviseProposalPage() {
  const { dealId } = Route.useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  const estimate = useQuery(
    api.workflows.dealToDelivery.api.estimates.getEstimateByDeal,
    { dealId: dealId as Id<'deals'> }
  )

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

  const form = useForm<ReviseProposalFormValues>({
    resolver: zodResolver(reviseProposalFormSchema),
    defaultValues: {
      documentUrl: '',
      revisionNotes: '',
    },
  })

  const reviseWorkItem = workItems?.find(
    (wi) => wi.taskType === 'reviseProposal' && wi.status !== 'completed'
  )

  async function onSubmit(data: ReviseProposalFormValues) {
    if (!reviseWorkItem) {
      toast.error('No proposal revision task available')
      return
    }

    setIsSubmitting(true)
    try {
      if (reviseWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: reviseWorkItem.workItemId,
          args: {
            name: 'reviseProposal' as const,
          },
        })
      }

      await completeWorkItem({
        workItemId: reviseWorkItem.workItemId,
        args: {
          name: 'reviseProposal' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            documentUrl: data.documentUrl,
            revisionNotes: data.revisionNotes,
          },
        },
      })

      toast.success('Proposal revised successfully')
      setIsRedirecting(true)
      navigate({ to: '/deals/$dealId', params: { dealId } })
    } catch (error) {
      console.error('Failed to revise proposal:', error)
      toast.error('Failed to revise proposal. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (
    deal === undefined ||
    estimate === undefined ||
    latestProposal === undefined ||
    workItems === undefined
  ) {
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
            {isRedirecting ? 'Proposal revision saved' : 'Submitting revision'}
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

  if (!latestProposal) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No proposal found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            A proposal must exist before it can be revised.
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

  if (latestProposal.status !== 'Rejected') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No revision required</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            This proposal does not require a revision right now.
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

  if (!reviseWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No revision task available</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The proposal revision work item is not available yet.
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
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Revise Proposal: {deal.name}</CardTitle>
            <CardDescription>
              Create a new version based on client feedback
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {estimate && (
            <>
              <div className="space-y-3">
                <Label>Estimate Summary</Label>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {estimate.services.map((service) => (
                        <TableRow key={service._id}>
                          <TableCell>{service.name}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(service.rate)}/hr
                          </TableCell>
                          <TableCell className="text-right">
                            {service.hours}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(service.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3} className="font-medium">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatCurrency(estimate.total)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </div>
              <Separator />
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="documentUrl">Revised Proposal Document URL *</Label>
            <Input
              id="documentUrl"
              type="url"
              placeholder="https://docs.google.com/document/d/..."
              {...form.register('documentUrl')}
            />
            {form.formState.errors.documentUrl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.documentUrl.message}
              </p>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="revisionNotes">Revision Notes (Optional)</Label>
            <Textarea
              id="revisionNotes"
              placeholder="Summarize the changes made based on client feedback..."
              {...form.register('revisionNotes')}
              className="min-h-[100px]"
            />
            {form.formState.errors.revisionNotes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.revisionNotes.message}
              </p>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Button variant="outline" type="button" asChild>
              <a href={`/deals/${dealId}`}>Cancel</a>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save Revision
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
