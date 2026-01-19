import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { WorkItemActivityFeed } from '@/features/psa/components/WorkItemActivityFeed'
import { Button } from '@repo/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Separator } from '@repo/ui/components/separator'
import {
  Briefcase,
  DollarSign,
  Calendar,
  ArrowLeft,
  FileText,
  ClipboardCheck,
  FileCheck,
  Send,
  MessageSquare,
  Award,
  Activity,
  History,
} from 'lucide-react'

export const Route = createFileRoute('/_app/deals/$dealId')({
  component: DealDetailPage,
  loader: () => ({
    crumb: 'Deal',
  }),
})

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function getStageBadgeVariant(
  stage: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (stage) {
    case 'Won':
      return 'default'
    case 'Lost':
    case 'Disqualified':
      return 'destructive'
    case 'Qualified':
    case 'Proposal':
    case 'Negotiation':
      return 'secondary'
    default:
      return 'outline'
  }
}

function getNextAction(
  stage: string,
  hasEstimate: boolean
): {
  label: string
  href: string
  icon: typeof FileText
} | null {
  switch (stage) {
    case 'Lead':
      return {
        label: 'Qualify Lead',
        href: 'qualify',
        icon: ClipboardCheck,
      }
    case 'Qualified':
      if (hasEstimate) {
        return {
          label: 'Create Proposal',
          href: 'proposal',
          icon: FileCheck,
        }
      }
      return {
        label: 'Create Estimate',
        href: 'estimate',
        icon: FileText,
      }
    case 'Proposal':
      return {
        label: 'Send Proposal',
        href: 'send-proposal',
        icon: Send,
      }
    case 'Negotiation':
      return {
        label: 'Mark as Signed',
        href: 'sign',
        icon: Award,
      }
    default:
      return null
  }
}

function DealDetailPage() {
  const { dealId } = Route.useParams()
  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  if (deal === undefined) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10">
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading deal...
          </div>
        </div>
      </div>
    )
  }

  if (deal === null) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Deal not found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                The deal you're looking for doesn't exist or has been deleted.
              </p>
              <Button asChild>
                <Link to="/deals">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Deals
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const hasEstimate = Boolean(deal.estimateId)
  const nextAction = getNextAction(deal.stage, hasEstimate)

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-5xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          to="/deals"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Pipeline
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Briefcase className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {deal.name}
                </h1>
                <Badge variant={getStageBadgeVariant(deal.stage)} className="h-6">
                  {deal.stage}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground text-lg">
                  {formatCurrency(deal.value)}
                </span>
                <span>•</span>
                <span>{deal.probability}% probability</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* View Workflow Button */}
            {deal.workflowId && (
              <Button asChild variant="outline">
                <Link
                  to="/audit/$traceId/visualizer"
                  params={{ traceId: deal.workflowId }}
                >
                  <Activity className="h-4 w-4 mr-2" />
                  View Workflow
                </Link>
              </Button>
            )}
            {/* Next Action Button */}
            {nextAction && (
              <Button asChild>
                <a href={`/deals/${dealId}/${nextAction.href}`}>
                  <nextAction.icon className="h-4 w-4 mr-2" />
                  {nextAction.label}
                </a>
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* Deal Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Deal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Deal Information</CardTitle>
              <CardDescription>Core deal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Value</p>
                  <p className="font-medium">{formatCurrency(deal.value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {new Date(deal.createdAt).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
              {deal.qualificationNotes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Qualification Notes
                  </p>
                  <p className="text-sm bg-muted/50 rounded-md p-3">
                    {deal.qualificationNotes}
                  </p>
                </div>
              )}
              {deal.lostReason && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Lost Reason
                  </p>
                  <p className="text-sm bg-destructive/10 text-destructive rounded-md p-3">
                    {deal.lostReason}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Workflow Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sales Progress</CardTitle>
              <CardDescription>Deal stage progression</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won'].map(
                  (stage, index) => {
                    const stages = [
                      'Lead',
                      'Qualified',
                      'Proposal',
                      'Negotiation',
                      'Won',
                    ]
                    const currentIndex = stages.indexOf(deal.stage)
                    const stageIndex = index
                    const isCompleted = stageIndex < currentIndex
                    const isCurrent = stage === deal.stage

                    return (
                      <div
                        key={stage}
                        className={`flex items-center gap-3 p-2 rounded-md ${
                          isCurrent
                            ? 'bg-primary/10 text-primary'
                            : isCompleted
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/50'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                            isCurrent
                              ? 'bg-primary text-primary-foreground'
                              : isCompleted
                                ? 'bg-green-500 text-white'
                                : 'bg-muted'
                          }`}
                        >
                          {isCompleted ? '✓' : stageIndex + 1}
                        </div>
                        <span className={isCurrent ? 'font-medium' : ''}>
                          {stage}
                        </span>
                      </div>
                    )
                  }
                )}
                {(deal.stage === 'Lost' || deal.stage === 'Disqualified') && (
                  <div className="flex items-center gap-3 p-2 rounded-md bg-destructive/10 text-destructive">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium bg-destructive text-destructive-foreground">
                      ✕
                    </div>
                    <span className="font-medium">{deal.stage}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Work Item History */}
        {deal.workflowId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Work Item History
              </CardTitle>
              <CardDescription>
                Timeline of workflow activities and task completions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkItemActivityFeed dealId={dealId as Id<'deals'>} limit={20} />
            </CardContent>
          </Card>
        )}

        {/* Actions Panel for current stage */}
        {deal.stage !== 'Won' &&
          deal.stage !== 'Lost' &&
          deal.stage !== 'Disqualified' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Available Actions</CardTitle>
                <CardDescription>
                  Actions you can take to progress this deal
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {deal.stage === 'Lead' && (
                    <>
                      <Button asChild>
                        <a href={`/deals/${dealId}/qualify`}>
                          <ClipboardCheck className="h-4 w-4 mr-2" />
                          Qualify Lead
                        </a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`/deals/${dealId}/disqualify`}>
                          Disqualify
                        </a>
                      </Button>
                    </>
                  )}
                  {deal.stage === 'Qualified' && (
                    <Button asChild>
                      <a
                        href={`/deals/${dealId}/${hasEstimate ? 'proposal' : 'estimate'}`}
                      >
                        {hasEstimate ? (
                          <FileCheck className="h-4 w-4 mr-2" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        {hasEstimate ? 'Create Proposal' : 'Create Estimate'}
                      </a>
                    </Button>
                  )}
                  {deal.stage === 'Proposal' && (
                    <>
                      <Button asChild>
                        <a href={`/deals/${dealId}/send-proposal`}>
                          <Send className="h-4 w-4 mr-2" />
                          Send Proposal
                        </a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`/deals/${dealId}/proposal`}>
                          <FileCheck className="h-4 w-4 mr-2" />
                          View Proposal
                        </a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`/deals/${dealId}/negotiate`}>
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Record Client Response
                        </a>
                      </Button>
                    </>
                  )}
                  {deal.stage === 'Negotiation' && (
                    <>
                      <Button asChild>
                        <a href={`/deals/${dealId}/sign`}>
                          <Award className="h-4 w-4 mr-2" />
                          Mark as Signed
                        </a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`/deals/${dealId}/proposal`}>
                          <FileCheck className="h-4 w-4 mr-2" />
                          View Proposal
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Outlet for nested routes (qualify, estimate, etc.) */}
        <Outlet />
      </div>
    </div>
  )
}
