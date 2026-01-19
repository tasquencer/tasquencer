import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import {
  CheckCircle,
  PlayCircle,
  PauseCircle,
  XCircle,
  Circle,
  Clock,
} from 'lucide-react'
import { Badge } from '@repo/ui/components/badge'

/**
 * Get the icon for a work item event type.
 * Maps event types to appropriate visual indicators.
 */
function getEventIcon(eventType: string) {
  const type = eventType.toLowerCase()
  if (type.includes('complete')) {
    return <CheckCircle className="h-4 w-4 text-green-500" />
  }
  if (type.includes('start')) {
    return <PlayCircle className="h-4 w-4 text-blue-500" />
  }
  if (type.includes('initialize')) {
    return <Circle className="h-4 w-4 text-gray-400" />
  }
  if (type.includes('fail') || type.includes('error')) {
    return <XCircle className="h-4 w-4 text-red-500" />
  }
  if (type.includes('cancel')) {
    return <PauseCircle className="h-4 w-4 text-yellow-500" />
  }
  return <Clock className="h-4 w-4 text-muted-foreground" />
}

/**
 * Get the badge variant for an event type.
 */
function getEventBadgeVariant(
  eventType: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const type = eventType.toLowerCase()
  if (type.includes('complete')) return 'default'
  if (type.includes('fail') || type.includes('error')) return 'destructive'
  if (type.includes('start')) return 'secondary'
  return 'outline'
}

/**
 * Format a human-readable label from an event type.
 * E.g., "WorkItem.complete" -> "Completed"
 */
function formatEventLabel(eventType: string): string {
  const type = eventType.toLowerCase()
  if (type.includes('complete')) return 'Completed'
  if (type.includes('start')) return 'Started'
  if (type.includes('initialize')) return 'Initialized'
  if (type.includes('fail')) return 'Failed'
  if (type.includes('cancel')) return 'Canceled'
  if (type.includes('reset')) return 'Reset'
  // Fall back to the type itself with cleaner formatting
  return eventType.replace(/WorkItem\./i, '').replace(/([A-Z])/g, ' $1').trim()
}

/**
 * Format timestamp to a human-readable string.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  // Relative time for recent events
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  // Absolute date for older events
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface WorkItemActivityFeedProps {
  dealId: Id<'deals'>
  limit?: number
}

/**
 * Work Item Activity Feed Component.
 *
 * Displays a timeline of work item lifecycle events (initialized, started, completed, etc.)
 * for a deal's workflow. Uses the audit system to track all work item transitions.
 *
 * @param dealId - The ID of the deal to show activity for
 * @param limit - Maximum number of events to display (default: 20)
 */
export function WorkItemActivityFeed({
  dealId,
  limit = 20,
}: WorkItemActivityFeedProps) {
  const history = useQuery(
    api.workflows.dealToDelivery.api.deals.getWorkItemHistory,
    { dealId, limit }
  )

  // Loading state
  if (history === undefined) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        Loading activity...
      </div>
    )
  }

  // Empty state
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">
          No work item activity yet
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {history.map((event, index) => (
        <div
          key={`${event.spanId}-${index}`}
          className="flex gap-3 py-2 border-b last:border-0 border-border/50"
        >
          {/* Icon */}
          <div className="flex-shrink-0 mt-0.5">{getEventIcon(event.type)}</div>

          {/* Content */}
          <div className="flex-grow min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {event.description}
              </span>
              <Badge
                variant={getEventBadgeVariant(event.type)}
                className="text-xs shrink-0"
              >
                {formatEventLabel(event.type)}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span>{formatTimestamp(event.timestamp)}</span>
              {event.workflowName && (
                <>
                  <span>·</span>
                  <span className="truncate">{event.workflowName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
