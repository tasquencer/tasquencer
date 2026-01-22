import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '@/convex/_generated/api'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Avatar, AvatarFallback } from '@repo/ui/components/avatar'
import { Tabs, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import { Progress } from '@repo/ui/components/progress'
import { FolderKanban, Building2, Calendar, Clock, DollarSign } from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/projects/')({
  component: ProjectsPage,
})

type StatusFilter = 'all' | 'Planning' | 'Active' | 'OnHold' | 'Completed'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return 'Not set'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function getHealthStatusIndicator(status: string): { icon: string; color: string; label: string } {
  switch (status) {
    case 'healthy':
      return { icon: '🟢', color: 'text-green-600', label: 'On track' }
    case 'at_risk':
      return { icon: '🟡', color: 'text-yellow-600', label: 'At risk' }
    case 'critical':
      return { icon: '🔴', color: 'text-red-600', label: 'Critical' }
    case 'planning':
      return { icon: '🔵', color: 'text-blue-600', label: 'Planning' }
    default:
      return { icon: '⚪', color: 'text-gray-600', label: 'Unknown' }
  }
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'Active':
      return 'default'
    case 'Planning':
      return 'secondary'
    case 'OnHold':
      return 'outline'
    case 'Completed':
      return 'secondary'
    default:
      return 'outline'
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const data = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjectsWithMetrics,
    statusFilter === 'all' ? {} : { status: statusFilter }
  )

  const isLoading = data === undefined

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <FolderKanban className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Projects
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Track project status, budget, and timeline.
              </p>
            </div>
          </div>
        </div>

        {/* Status Tabs */}
        <Tabs
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
            <TabsTrigger value="all" className="gap-2">
              All
              {data && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{data.counts.all}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="Active" className="gap-2">
              Active
              {data && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{data.counts.active}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="Planning" className="gap-2">
              Planning
              {data && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{data.counts.planning}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="OnHold" className="gap-2">
              On Hold
              {data && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{data.counts.onHold}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="Completed" className="gap-2">
              Completed
              {data && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{data.counts.completed}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Projects Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading projects...
          </div>
        ) : data.projects.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderKanban className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No projects yet</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                Projects are created when deals are won.
              </p>
              <Button asChild>
                <Link to="/deals">View Deals Pipeline</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
            {data.projects.map((project) => {
              const health = getHealthStatusIndicator(project.healthStatus)

              return (
                <Link
                  key={project._id}
                  to="/projects/$projectId"
                  params={{ projectId: project._id }}
                  className="block"
                >
                  <Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30">
                    <CardContent className="p-5 space-y-4">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-xl" title={health.label}>{health.icon}</span>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-base truncate">
                            {project.name}
                          </h3>
                          {project.company && (
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                              <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="truncate">{project.company.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={getStatusBadgeVariant(project.status)}>
                          {project.status}
                        </Badge>
                        {project.manager && (
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs bg-primary/10">
                              {getInitials(project.manager.name)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    </div>

                    {/* Budget & Timeline Progress */}
                    <div className="space-y-3 pt-2 border-t">
                      {/* Budget Progress */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <DollarSign className="h-3.5 w-3.5" />
                            Budget
                          </span>
                          <span className="font-medium">
                            {formatCurrency(project.budget.total)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress
                            value={project.budget.burnPercent}
                            className={cn(
                              'h-2 flex-1',
                              project.budget.burnPercent > 90 && '[&>div]:bg-red-500',
                              project.budget.burnPercent >= 75 && project.budget.burnPercent <= 90 && '[&>div]:bg-yellow-500'
                            )}
                          />
                          <span className="text-sm text-muted-foreground w-12 text-right">
                            {project.budget.burnPercent}%
                          </span>
                        </div>
                      </div>

                      {/* Timeline Progress */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            Timeline
                          </span>
                          <span className="text-muted-foreground">
                            {formatDate(project.startDate)} - {formatDate(project.endDate)}
                          </span>
                        </div>
                        {project.timeline.totalDays > 0 ? (
                          <div className="flex items-center gap-3">
                            <Progress
                              value={project.timeline.progressPercent}
                              className="h-2 flex-1"
                            />
                            <span className={cn(
                              'text-sm w-16 text-right capitalize',
                              project.timeline.status === 'delayed' && 'text-red-600',
                              project.timeline.status === 'on_track' && 'text-green-600',
                              project.timeline.status === 'ahead' && 'text-blue-600'
                            )}>
                              {project.timeline.status.replace('_', ' ')}
                            </span>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">Not started</div>
                        )}
                      </div>
                    </div>

                    {/* Metrics Footer */}
                    <div className="flex items-center justify-between pt-3 border-t text-sm">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {Math.round(project.metrics.hoursLogged)} / {project.metrics.hoursEstimated || '—'} hrs
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        Revenue: <span className="font-medium text-foreground">{formatCurrency(project.metrics.revenue)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        Margin: <span className={cn(
                          'font-medium',
                          project.metrics.margin >= 30 && 'text-green-600',
                          project.metrics.margin >= 15 && project.metrics.margin < 30 && 'text-yellow-600',
                          project.metrics.margin < 15 && 'text-red-600'
                        )}>{project.metrics.margin}%</span>
                      </div>
                    </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
