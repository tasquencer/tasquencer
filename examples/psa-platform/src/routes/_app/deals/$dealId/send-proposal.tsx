import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, skip } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState } from 'react'
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
import {
  ArrowLeft,
  Send,
  AlertTriangle,
  Loader2,
  FileCheck,
  Mail,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/send-proposal')({
  component: SendProposalPage,
  loader: () => ({
    crumb: 'Send Proposal',
  }),
})

const sendProposalFormSchema = z.object({
  recipientName: z.string().min(1, 'Recipient name is required'),
  recipientEmail: z.string().email('Enter a valid email address'),
  personalMessage: z.string().max(1000, 'Message must be less than 1000 characters').optional(),
})

type SendProposalFormValues = z.infer<typeof sendProposalFormSchema>

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function SendProposalPage() {
  const { dealId } = Route.useParams()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  const contact = useQuery(
    api.workflows.dealToDelivery.api.companies.getContact,
    deal ? { contactId: deal.contactId } : skip
  )

  const company = useQuery(
    api.workflows.dealToDelivery.api.companies.getCompany,
    deal ? { companyId: deal.companyId } : skip
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

  const form = useForm<SendProposalFormValues>({
    resolver: zodResolver(sendProposalFormSchema),
    defaultValues: {
      recipientName: '',
      recipientEmail: '',
      personalMessage: '',
    },
  })

  useEffect(() => {
    if (form.formState.isDirty) {
      return
    }

    let recipientName = contact?.name ?? ''
    let recipientEmail = contact?.email ?? ''

    if ((!recipientName || !recipientEmail) && company?.contacts?.length) {
      const primaryContact =
        company.contacts.find((c) => c.isPrimary) ?? company.contacts[0]
      if (!recipientName) recipientName = primaryContact?.name ?? ''
      if (!recipientEmail) recipientEmail = primaryContact?.email ?? ''
    }

    if (recipientName) {
      form.setValue('recipientName', recipientName, { shouldDirty: false })
    }
    if (recipientEmail) {
      form.setValue('recipientEmail', recipientEmail, { shouldDirty: false })
    }
  }, [company, contact, form])

  // Find the sendProposal work item
  const sendWorkItem = workItems?.find(
    (wi) => wi.taskType === 'sendProposal' && wi.status !== 'completed'
  )

  async function onSubmit(data: SendProposalFormValues) {
    if (!sendWorkItem || !latestProposal) {
      toast.error('Cannot send proposal at this time')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (sendWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: sendWorkItem.workItemId,
          args: {
            name: 'sendProposal' as const,
          },
        })
      }

      // Complete the work item
      // Note: The work item backend will mark the proposal as "Sent"
      // In a real app, this would also trigger an email to the recipient
      await completeWorkItem({
        workItemId: sendWorkItem.workItemId,
        args: {
          name: 'sendProposal' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            proposalId: latestProposal._id,
          },
        },
      })

      toast.success(`Proposal sent to ${data.recipientEmail}`)

      // Navigate back to deal detail
      window.location.href = `/deals/${dealId}`
    } catch (error) {
      console.error('Failed to send proposal:', error)
      toast.error('Failed to send proposal. Please try again.')
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

  // Check if proposal exists
  if (!latestProposal) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No proposal found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            A proposal must be created before it can be sent.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}/proposal`}>
              <FileCheck className="h-4 w-4 mr-2" />
              Create Proposal
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Check if proposal is already sent
  if (latestProposal.status !== 'Draft') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Proposal already sent</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            This proposal has already been sent (Status: {latestProposal.status}).
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
  if (!sendWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Cannot send proposal</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The send proposal work item is not available. The workflow may
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
            <Send className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Send Proposal: {deal.name}</CardTitle>
            <CardDescription>
              Send the proposal to the client for review
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Proposal Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Proposal Summary</h4>
              <Badge variant="outline">v{latestProposal.version}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Deal Value</p>
                <p className="font-medium">{formatCurrency(deal.value)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">
                  {new Date(latestProposal.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Document</p>
              <a
                href={latestProposal.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline break-all"
              >
                {latestProposal.documentUrl}
              </a>
            </div>
          </div>

          <Separator />

          {/* Recipient Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Recipient Details</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="recipientName">Recipient Name *</Label>
                <Input
                  id="recipientName"
                  placeholder="John Smith"
                  {...form.register('recipientName')}
                />
                {form.formState.errors.recipientName && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.recipientName.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipientEmail">Recipient Email *</Label>
                <Input
                  id="recipientEmail"
                  type="email"
                  placeholder="john@company.com"
                  {...form.register('recipientEmail')}
                />
                {form.formState.errors.recipientEmail && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.recipientEmail.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Personal Message */}
          <div className="space-y-2">
            <Label htmlFor="personalMessage">Personal Message (Optional)</Label>
            <Textarea
              id="personalMessage"
              placeholder="Hi John, please find attached our proposal for the website redesign project..."
              {...form.register('personalMessage')}
              className="min-h-[100px]"
            />
            {form.formState.errors.personalMessage && (
              <p className="text-sm text-destructive">
                {form.formState.errors.personalMessage.message}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Add a personal note to include in the email with the proposal.
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
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Proposal
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
