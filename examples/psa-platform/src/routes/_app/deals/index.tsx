import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Avatar, AvatarFallback } from '@repo/ui/components/avatar'
import { Plus, Briefcase, Building2, Clock } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/deals/')({
  component: DealsPage,
})

const PIPELINE_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation'] as const

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function getProbabilityBadgeVariant(
  probability: number
): 'default' | 'secondary' | 'outline' {
  if (probability >= 75) return 'default'
  if (probability >= 50) return 'secondary'
  return 'outline'
}

function getStageColor(stage: string): string {
  switch (stage) {
    case 'Lead':
      return 'bg-slate-500'
    case 'Qualified':
      return 'bg-blue-500'
    case 'Proposal':
      return 'bg-amber-500'
    case 'Negotiation':
      return 'bg-purple-500'
    default:
      return 'bg-gray-500'
  }
}

function getDaysInStage(createdAt: number): number {
  const now = Date.now()
  const diffMs = now - createdAt
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function DealsPage() {
  const deals = useQuery(
    api.workflows.dealToDelivery.api.deals.listDealsWithDetails
  )
  const summary = useQuery(
    api.workflows.dealToDelivery.api.deals.getPipelineSummary
  )

  const isLoading = deals === undefined || summary === undefined

  // Group deals by stage
  const dealsByStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = deals?.filter((deal) => deal.stage === stage) ?? []
      return acc
    },
    {} as Record<(typeof PIPELINE_STAGES)[number], typeof deals>
  )

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Briefcase className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Deals Pipeline
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Track your deals through the sales stages.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/deals/new">
              <Plus className="h-4 w-4 mr-2" />
              New Deal
            </Link>
          </Button>
        </div>

        {/* Kanban Pipeline */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading pipeline...
          </div>
        ) : deals && deals.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Briefcase className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No deals yet</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                Get started by creating your first deal.
              </p>
              <Button asChild>
                <Link to="/deals/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Deal
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {PIPELINE_STAGES.map((stage) => {
              const stageDeals = dealsByStage[stage] ?? []
              const stageSummary = summary?.find((s) => s.stage === stage)

              return (
                <div key={stage} className="flex flex-col gap-3">
                  {/* Stage Header */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn('w-3 h-3 rounded-full', getStageColor(stage))}
                      />
                      <h3 className="font-semibold">{stage}</h3>
                      <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                        {stageDeals.length}
                      </Badge>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {formatCurrency(stageSummary?.totalValue ?? 0)}
                    </span>
                  </div>

                  {/* Stage Column */}
                  <div className="flex flex-col gap-2 p-2 rounded-lg bg-muted/40 min-h-[400px]">
                    {stageDeals.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        No deals in {stage}
                      </div>
                    ) : (
                      stageDeals.map((deal) => (
                        <Link
                          key={deal._id}
                          to="/deals/$dealId"
                          params={{ dealId: deal._id }}
                          className="block"
                        >
                          <Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30">
                            <CardContent className="p-4 space-y-3">
                              {/* Deal Name & Value */}
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-medium text-sm line-clamp-2">
                                  {deal.name}
                                </h4>
                                <span className="text-sm font-semibold whitespace-nowrap">
                                  {formatCurrency(deal.value)}
                                </span>
                              </div>

                              {/* Company */}
                              {deal.company && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Building2 className="h-3 w-3" />
                                  <span className="truncate">
                                    {deal.company.name}
                                  </span>
                                </div>
                              )}

                              {/* Footer: Owner, Probability, Days */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {/* Owner Avatar */}
                                  {deal.owner && (
                                    <Avatar className="h-6 w-6">
                                      <AvatarFallback className="text-[10px] bg-primary/10">
                                        {getInitials(deal.owner.name)}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}

                                  {/* Probability Badge */}
                                  <Badge
                                    variant={getProbabilityBadgeVariant(
                                      deal.probability
                                    )}
                                    className="h-5 text-[10px]"
                                  >
                                    {deal.probability}%
                                  </Badge>
                                </div>

                                {/* Days in Stage */}
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  <span>
                                    {getDaysInStage(deal.createdAt)}d
                                  </span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Won/Lost Summary (below pipeline) */}
        {deals && deals.length > 0 && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600">
                Won
              </Badge>
              <span>
                {deals.filter((d) => d.stage === 'Won').length} deals (
                {formatCurrency(
                  deals
                    .filter((d) => d.stage === 'Won')
                    .reduce((sum, d) => sum + d.value, 0)
                )}
                )
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Lost</Badge>
              <span>
                {deals.filter((d) => d.stage === 'Lost' || d.stage === 'Disqualified').length} deals
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
