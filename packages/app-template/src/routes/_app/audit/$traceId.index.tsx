import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '@/convex/_generated/api'
import { SpansView } from '@repo/audit/components/audit/spans-view'
import { TraceHeader } from '@repo/audit/components/audit/trace-header'
import { Button } from '@repo/ui/components/button'
import {
  calculateTraceDuration,
  extractWorkflowName,
} from '@repo/audit/util/audit'
import { Route as ParentRoute } from './$traceId'

export const Route = createFileRoute('/_app/audit/$traceId/')({
  component: AuditTraceDetail,
})

function AuditTraceDetail() {
  const { trace } = ParentRoute.useLoaderData()
  const { traceId } = Route.useParams()
  const duration = calculateTraceDuration(trace)
  const workflowName = extractWorkflowName(trace)

  // Fetch root spans
  const { data: rootSpans } = useSuspenseQuery(
    convexQuery(api.admin.audit.getRootSpans, { traceId }),
  )

  // Callback for lazy loading children
  const queryClient = useQueryClient()
  const handleLoadChildren = useCallback(
    async (parentSpanId: string) => {
      return queryClient.fetchQuery(
        convexQuery(api.admin.audit.getChildSpans, { traceId, parentSpanId }),
      )
    },
    [queryClient, traceId],
  )

  return (
    <div className="flex flex-col h-full">
      <TraceHeader
        trace={trace}
        duration={duration}
        buttonSlot={
          workflowName ? (
            <Link
              to="/audit/$traceId/visualizer"
              params={{ traceId: trace.traceId }}
            >
              <Button variant="outline" size="sm">
                Time-Travel Debugger
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="flex-1 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <SpansView
            traceId={traceId}
            trace={trace}
            rootSpans={rootSpans}
            onLoadChildren={handleLoadChildren}
          />
        </div>
      </div>
    </div>
  )
}
