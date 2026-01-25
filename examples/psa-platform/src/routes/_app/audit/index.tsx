import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '@/convex/_generated/api'
import { Badge } from '@repo/ui/components/badge'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import {
  calculateTraceDuration,
  formatDurationIntelligently,
} from '@/lib/audit-utils'
import { Activity, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'

export const Route = createFileRoute('/_app/audit/')({
  component: AuditTracesList,
  pendingComponent: Loading,
})

function Loading() {
  return (
    <div className="p-4">
      <div className="animate-pulse space-y-3">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="h-8 w-full bg-muted rounded" />
        <div className="space-y-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-muted rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}

// Status indicator dot component
function StatusDot({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full flex-shrink-0',
        state === 'completed' && 'bg-emerald-500',
        state === 'failed' && 'bg-red-500',
        state === 'canceled' && 'bg-zinc-400',
        !['completed', 'failed', 'canceled'].includes(state) &&
          'bg-blue-500 animate-pulse',
      )}
    />
  )
}

function AuditTracesList() {
  const tracesQ = convexQuery(api.admin.audit.listRecentTraces, { limit: 50 })
  const { data: traces } = useSuspenseQuery(tracesQ)

  // Calculate stats
  const stats = useMemo(() => {
    const completed = traces.filter((t) => t.state === 'completed').length
    const failed = traces.filter((t) => t.state === 'failed').length
    const running = traces.filter(
      (t) => t.state !== 'completed' && t.state !== 'failed',
    ).length
    return { total: traces.length, completed, failed, running }
  }, [traces])

  return (
    <div className="p-4 space-y-3">
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Traces</h1>
        </div>
        {/* Inline Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          <span>
            <span className="text-foreground font-medium">{stats.total}</span>{' '}
            total
          </span>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-foreground font-medium">
              {stats.completed}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-foreground font-medium">{stats.failed}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-foreground font-medium">{stats.running}</span>
          </span>
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
        <span className="w-6" />
        <span>Workflow</span>
        <span className="hidden sm:block">Started</span>
        <span className="hidden md:block w-24 text-right">Duration</span>
        <span className="w-16 text-center">Status</span>
        <span className="w-4" />
      </div>

      {/* Traces List */}
      {traces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="h-5 w-5 text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No traces found</p>
        </div>
      ) : (
        <div className="space-y-px">
          {traces.map((trace, index) => {
            const duration = calculateTraceDuration(trace)
            const timeAgo = formatDistanceToNow(trace.startedAt, {
              addSuffix: false,
            })

            return (
              <Link
                key={trace._id}
                to="/audit/$traceId"
                params={{ traceId: trace.traceId }}
                className={cn(
                  'grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-2 py-2 rounded transition-colors',
                  'hover:bg-muted/60 group',
                )}
              >
                {/* Row Number */}
                <span className="w-6 text-[10px] font-mono text-muted-foreground tabular-nums text-right">
                  {index + 1}
                </span>

                {/* Workflow Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <StatusDot state={trace.state} />
                    <span className="text-xs font-medium truncate">
                      {trace.name}
                    </span>
                  </div>
                  <code className="text-[10px] text-muted-foreground font-mono truncate block">
                    {trace.traceId}
                  </code>
                </div>

                {/* Time */}
                <span className="hidden sm:block text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                  {timeAgo} ago
                </span>

                {/* Duration */}
                <span className="hidden md:block w-24 text-right text-[10px] font-mono text-muted-foreground">
                  {formatDurationIntelligently(duration)}
                </span>

                {/* Status Badge */}
                <Badge
                  variant="outline"
                  className={cn(
                    'w-16 justify-center text-[10px] font-mono h-5 px-1.5',
                    trace.state === 'completed' &&
                      'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5',
                    trace.state === 'failed' &&
                      'border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5',
                    trace.state === 'canceled' &&
                      'border-zinc-500/30 text-zinc-500 bg-zinc-500/5',
                    !['completed', 'failed', 'canceled'].includes(
                      trace.state,
                    ) &&
                      'border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/5',
                  )}
                >
                  {trace.state}
                </Badge>

                {/* Chevron */}
                <ChevronRight className="w-4 h-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
