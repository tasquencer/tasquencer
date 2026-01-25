import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent, CardTitle, CardDescription } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/tabs'
import {
  ListTodo,
  PlayCircle,
  CheckCircle,
  Clock,
  ArrowRight,
  Loader2,
  RefreshCw,
  ExternalLink,
  ClipboardEdit,
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import {
  getTaskRoute,
  getTaskCategory,
  getCategoryColor,
  TASK_TYPE_LABELS,
} from '@/features/psa/task/task-routing'

export const Route = createFileRoute('/_app/tasks/')({
  component: TasksPage,
})

// Get status badge variant
function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'claimed':
      return 'default'
    case 'pending':
      return 'secondary'
    case 'completed':
      return 'outline'
    default:
      return 'outline'
  }
}

type WorkItemResponse = {
  _id: Id<'dealToDeliveryWorkItems'>
  _creationTime: number
  workItemId: Id<'tasquencerWorkItems'>
  aggregateTableId: Id<'deals'>
  projectId?: Id<'projects'>
  taskName: string
  taskType: string
  status: 'pending' | 'claimed' | 'completed'
  requiredScope?: string
  requiredGroupId?: string
  claimedBy?: string
  payload: unknown
  workItemState?: string
}

function TaskCard({ task }: { task: WorkItemResponse }) {
  const category = getTaskCategory(task.taskType)
  const label = TASK_TYPE_LABELS[task.taskType] ?? task.taskName
  const routeInfo = getTaskRoute(
    task.taskType,
    task.workItemId,
    task.aggregateTableId,
    task.projectId
  )

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className={cn('text-xs', getCategoryColor(category))}>
                {category}
              </Badge>
              <Badge variant={getStatusBadgeVariant(task.status)}>
                {task.status}
              </Badge>
              {task.workItemState && task.workItemState !== task.status && (
                <Badge variant="outline" className="text-xs">
                  {task.workItemState}
                </Badge>
              )}
              {routeInfo.hasDirectForm && (
                <Badge variant="outline" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  Form
                </Badge>
              )}
            </div>
            <h3 className="font-medium text-base truncate">{label}</h3>
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {task.taskName !== label ? task.taskName : `Work item: ${task.taskType}`}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(task._creationTime).toLocaleDateString()}
              </span>
              {task.requiredScope && (
                <span className="truncate max-w-[200px]" title={task.requiredScope}>
                  Scope: {task.requiredScope.split(':').pop()}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {routeInfo.hasDirectForm ? (
              <Link to={routeInfo.to} params={routeInfo.params}>
                <Button size="sm" variant="default">
                  <ClipboardEdit className="h-4 w-4 mr-1" />
                  Open Task
                </Button>
              </Link>
            ) : routeInfo.params ? (
              <Link to={routeInfo.to as '/deals/$dealId'} params={routeInfo.params as { dealId: string }}>
                <Button size="sm" variant="outline">
                  <ExternalLink className="h-4 w-4 mr-1" />
                  View
                </Button>
              </Link>
            ) : (
              <Link to={routeInfo.to as '/timesheet'}>
                <Button size="sm" variant="outline">
                  <ArrowRight className="h-4 w-4 mr-1" />
                  Go
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TasksPage() {
  const [activeTab, setActiveTab] = useState('available')

  // Queries
  const availableTasks = useQuery(
    api.workflows.dealToDelivery.api.workItems.getMyAvailableTasks
  )
  const claimedTasks = useQuery(
    api.workflows.dealToDelivery.api.workItems.getMyClaimedTasks
  )
  const allTasks = useQuery(
    api.workflows.dealToDelivery.api.workItems.getAllAvailableTasks
  )

  const isLoading = availableTasks === undefined || claimedTasks === undefined

  // Count tasks
  const availableCount = availableTasks?.length ?? 0
  const claimedCount = claimedTasks?.length ?? 0
  const allCount = allTasks?.length ?? 0

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <ListTodo className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                My Tasks
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                View and manage your workflow tasks.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.location.reload()
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{availableCount}</p>
                <p className="text-sm text-muted-foreground">Available</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{claimedCount}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
                <CheckCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{allCount}</p>
                <p className="text-sm text-muted-foreground">All Active</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="available" className="gap-2">
              <Clock className="h-4 w-4" />
              Available
              {availableCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {availableCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="claimed" className="gap-2">
              <PlayCircle className="h-4 w-4" />
              In Progress
              {claimedCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {claimedCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              <ListTodo className="h-4 w-4" />
              All Tasks
              {allCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {allCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading tasks...
              </div>
            ) : availableCount === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <CardTitle className="text-lg mb-2">All caught up!</CardTitle>
                  <CardDescription>
                    No tasks are currently available for you to claim.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {availableTasks?.map((task) => (
                  <TaskCard key={task._id} task={task as WorkItemResponse} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="claimed" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading tasks...
              </div>
            ) : claimedCount === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <PlayCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <CardTitle className="text-lg mb-2">No tasks in progress</CardTitle>
                  <CardDescription>
                    Claim a task from the Available tab to get started.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {claimedTasks?.map((task) => (
                  <TaskCard key={task._id} task={task as WorkItemResponse} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-4">
            {allTasks === undefined ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading tasks...
              </div>
            ) : allCount === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <CardTitle className="text-lg mb-2">No active tasks</CardTitle>
                  <CardDescription>
                    There are no active workflow tasks in the system.
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {allTasks?.map((task) => (
                  <TaskCard key={task._id} task={task as WorkItemResponse} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
