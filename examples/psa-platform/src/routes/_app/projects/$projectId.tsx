import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
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
import { Progress } from '@repo/ui/components/progress'
import {
  FolderKanban,
  ArrowLeft,
  DollarSign,
  Clock,
  Receipt,
  FileText,
  Activity,
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/projects/$projectId')({
  component: ProjectDetailPage,
  loader: () => ({
    crumb: 'Project',
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

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return 'Not set'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Active':
      return 'default'
    case 'Completed':
      return 'secondary'
    case 'OnHold':
      return 'destructive'
    default:
      return 'outline'
  }
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams()
  const project = useQuery(api.workflows.dealToDelivery.api.projects.getProject, {
    projectId: projectId as Id<'projects'>,
  })

  if (project === undefined) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10">
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading project...
          </div>
        </div>
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderKanban className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Project not found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                The project you're looking for doesn't exist or has been deleted.
              </p>
              <Button asChild>
                <Link to="/projects">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Projects
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const budgetBurnPercent = project.metrics.budgetTotal > 0
    ? Math.round((project.metrics.budgetUsed / project.metrics.budgetTotal) * 100)
    : 0

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          to="/projects"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Projects
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <FolderKanban className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {project.name}
                </h1>
                <Badge variant={getStatusBadgeVariant(project.status)}>
                  {project.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  {formatDate(project.startDate)} - {formatDate(project.endDate)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* View Workflow Button */}
            {project.workflowId && (
              <Button asChild variant="outline">
                <Link
                  to="/audit/$traceId/visualizer"
                  params={{ traceId: project.workflowId }}
                >
                  <Activity className="h-4 w-4 mr-2" />
                  View Workflow
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link
                to="/projects/$projectId/invoices/new"
                params={{ projectId }}
              >
                <Receipt className="h-4 w-4 mr-2" />
                Create Invoice
              </Link>
            </Button>
          </div>
        </div>

        <Separator />

        {/* Project Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Budget Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Budget
              </CardTitle>
              <CardDescription>Project budget and spending</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Budget</span>
                  <span className="font-medium">{formatCurrency(project.metrics.budgetTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Used</span>
                  <span className="font-medium">{formatCurrency(project.metrics.budgetUsed)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="font-medium text-green-600">{formatCurrency(project.metrics.budgetRemaining)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Budget Burn</span>
                  <span className="font-medium">{budgetBurnPercent}%</span>
                </div>
                <Progress
                  value={budgetBurnPercent}
                  className={cn(
                    'h-2',
                    budgetBurnPercent > 90 && '[&>div]:bg-red-500',
                    budgetBurnPercent >= 75 && budgetBurnPercent <= 90 && '[&>div]:bg-yellow-500'
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Hours Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Hours
              </CardTitle>
              <CardDescription>Time tracking summary</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Estimated Hours</span>
                  <span className="font-medium">{project.metrics.estimatedHours}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Logged</span>
                  <span className="font-medium">{project.metrics.hoursTotal}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Approved</span>
                  <span className="font-medium">{project.metrics.hoursApproved}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Billable</span>
                  <span className="font-medium text-green-600">{project.metrics.hoursBillable}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="font-medium">{project.metrics.hoursRemaining}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Expenses Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Expenses
              </CardTitle>
              <CardDescription>Project expenses summary</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Expenses</span>
                  <span className="font-medium">{formatCurrency(project.metrics.expensesTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Approved</span>
                  <span className="font-medium">{formatCurrency(project.metrics.expensesApproved)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Billable</span>
                  <span className="font-medium text-green-600">{formatCurrency(project.metrics.expensesBillable)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Services Card */}
          {project.budget && project.budget.services.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Services
                </CardTitle>
                <CardDescription>Budget services breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {project.budget.services.map((service) => (
                    <div key={service._id} className="flex justify-between text-sm py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium">{service.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {service.estimatedHours}h @ {formatCurrency(service.rate)}/hr
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(service.estimatedHours * service.rate)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Outlet for nested routes (invoices/new, etc.) */}
        <Outlet />
      </div>
    </div>
  )
}
