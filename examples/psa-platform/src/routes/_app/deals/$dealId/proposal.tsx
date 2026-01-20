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
  FileText,
  Send,
  Check,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/proposal')({
  component: ProposalPage,
  loader: () => ({
    crumb: 'Proposal',
  }),
})

const proposalFormSchema = z.object({
  documentUrl: z.string().url('Enter a valid document URL'),
})

type ProposalFormValues = z.infer<typeof proposalFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function getProposalStatusBadge(status: string) {
  switch (status) {
    case 'Draft':
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Draft</Badge>
    case 'Sent':
      return <Badge variant="secondary"><Send className="h-3 w-3 mr-1" />Sent</Badge>
    case 'Viewed':
      return <Badge variant="secondary"><FileText className="h-3 w-3 mr-1" />Viewed</Badge>
    case 'Signed':
      return <Badge variant="default"><Check className="h-3 w-3 mr-1" />Signed</Badge>
    case 'Rejected':
      return <Badge variant="destructive">Rejected</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function ProposalPage() {
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

  const form = useForm<ProposalFormValues>({
    resolver: zodResolver(proposalFormSchema),
    defaultValues: {
      documentUrl: '',
    },
  })

  // Find the createProposal work item
  const proposalWorkItem = workItems?.find(
    (wi) => wi.taskType === 'createProposal' && wi.status !== 'completed'
  )
  const sendWorkItem = workItems?.find(
    (wi) => wi.taskType === 'sendProposal' && wi.status !== 'completed'
  )
  const negotiateWorkItem = workItems?.find(
    (wi) => wi.taskType === 'negotiateTerms' && wi.status !== 'completed'
  )

  async function onSubmit(data: ProposalFormValues) {
    if (!proposalWorkItem) {
      toast.error('No proposal work item available')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (proposalWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: proposalWorkItem.workItemId,
          args: {
            name: 'createProposal' as const,
          },
        })
      }

      // Complete the work item with the document URL
      await completeWorkItem({
        workItemId: proposalWorkItem.workItemId,
        args: {
          name: 'createProposal' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            documentUrl: data.documentUrl,
          },
        },
      })

      toast.success('Proposal created successfully')

      setIsRedirecting(true)

      // Navigate back to deal detail
      navigate({ to: '/deals/$dealId', params: { dealId } })
    } catch (error) {
      console.error('Failed to create proposal:', error)
      toast.error('Failed to create proposal. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (deal === undefined || estimate === undefined || latestProposal === undefined || workItems === undefined) {
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
            {isRedirecting ? 'Proposal saved' : 'Submitting proposal'}
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

  // If proposal exists, show proposal details
  if (latestProposal) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Proposal v{latestProposal.version}</CardTitle>
                <CardDescription>
                  {deal.name}
                </CardDescription>
              </div>
            </div>
            {getProposalStatusBadge(latestProposal.status)}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Proposal Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Version</p>
              <p className="font-medium">{latestProposal.version}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-medium">{latestProposal.status}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="font-medium">
                {new Date(latestProposal.createdAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            {latestProposal.sentAt && (
              <div>
                <p className="text-sm text-muted-foreground">Sent</p>
                <p className="font-medium">
                  {new Date(latestProposal.sentAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Estimate Summary */}
          {estimate && (
            <div className="space-y-3">
              <h4 className="font-medium">Estimate Summary</h4>
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
                        <TableCell className="text-right">{service.hours}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(service.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">Total</TableCell>
                      <TableCell className="text-right font-bold">
                        {formatCurrency(estimate.total)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          )}

          <Separator />

          {/* Document Link */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">Document URL</p>
            <a
              href={latestProposal.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline break-all"
            >
              {latestProposal.documentUrl}
            </a>
          </div>

          <Separator />

          {/* Actions based on status */}
          <div className="flex items-center justify-between">
            <Button variant="outline" asChild>
              <a href={`/deals/${dealId}`}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Deal
              </a>
            </Button>
            {latestProposal.status === 'Draft' && sendWorkItem && (
              <Button asChild>
                <a href={`/deals/${dealId}/send-proposal`}>
                  <Send className="h-4 w-4 mr-2" />
                  Send Proposal
                </a>
              </Button>
            )}
            {(latestProposal.status === 'Sent' || latestProposal.status === 'Viewed') &&
              negotiateWorkItem && (
                <Button asChild>
                  <a href={`/deals/${dealId}/negotiate`}>
                    Record Client Response
                  </a>
                </Button>
              )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Check if deal has estimate (required before creating proposal)
  if (!estimate) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No estimate found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            An estimate must be created before generating a proposal.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}/estimate`}>
              <FileText className="h-4 w-4 mr-2" />
              Create Estimate
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Check if work item is available
  if (!proposalWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No proposal task available</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The create proposal work item is not available yet. The workflow may
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

  // Create Proposal Form
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Create Proposal: {deal.name}</CardTitle>
            <CardDescription>
              Generate a proposal document from the estimate
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Estimate Summary */}
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
                      <TableCell className="text-right">{service.hours}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(service.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">Total</TableCell>
                    <TableCell className="text-right font-bold">
                      {formatCurrency(estimate.total)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          <Separator />

          {/* Document URL Input */}
          <div className="space-y-2">
            <Label htmlFor="documentUrl">Proposal Document URL *</Label>
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
            <p className="text-sm text-muted-foreground">
              Enter the URL to your proposal document (Google Docs, PDF, etc.)
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
              Create Proposal
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
