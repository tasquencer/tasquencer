import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '@/convex/_generated/api'
import { TraceHeader } from '@repo/audit/components/audit/trace-header'
import {
  TimelineWorkflowVisualizer,
  type WorkflowState,
  type WorkflowInstance,
} from '@repo/audit/components/timeline-workflow-visualizer'
import { Button } from '@repo/ui/components/button'
import {
  calculateTraceDuration,
  extractWorkflowName,
  extractWorkflowVersion,
} from '@/lib/audit-utils'
import { Route as ParentRoute } from './$traceId'
import type { AuditTracesDoc, AuditSpansDoc } from '@repo/tasquencer'

export const Route = createFileRoute('/_app/audit/$traceId/visualizer')({
  component: VisualizerView,
  loader: async () => {
    return {
      crumb: 'Time-Travel Debugger',
    }
  },
})

function VisualizerView() {
  const { traceId } = Route.useParams()
  const { trace } = ParentRoute.useLoaderData()
  const duration = calculateTraceDuration(trace)
  const workflowName = extractWorkflowName(trace)
  const workflowVersion = extractWorkflowVersion(trace)

  if (!workflowName || !workflowVersion) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold">Visualizer not available</p>
          <p className="text-muted-foreground">
            This trace does not have workflow metadata (name and version)
          </p>
          <Link to="/audit/$traceId" params={{ traceId }}>
            <Button variant="outline">Back to Spans</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <VisualizerInner
      traceId={traceId}
      trace={trace}
      duration={duration}
      workflowName={workflowName}
      workflowVersion={workflowVersion}
    />
  )
}

function VisualizerInner({
  traceId,
  trace,
  duration,
  workflowName,
  workflowVersion,
}: {
  traceId: string
  trace: AuditTracesDoc
  duration: number
  workflowName: string
  workflowVersion: string
}) {
  const queryClient = useQueryClient()

  // Load workflow structure (additive data specific to visualizer)
  const structureQuery = convexQuery(
    api.workflows.metadata.genericGetWorkflowStructure,
    { workflow: { name: workflowName, version: workflowVersion } },
  )
  const { data: workflowStructure } = useSuspenseQuery(structureQuery)

  // Fetch key events
  const { data: keyEvents } = useSuspenseQuery(
    convexQuery(api.admin.audit.getKeyEvents, { traceId }),
  )

  // Fetch root spans
  const { data: rootSpans } = useSuspenseQuery(
    convexQuery(api.admin.audit.getRootSpans, { traceId }),
  )

  // Callback for lazy loading children
  const handleLoadChildren = useCallback(
    async (parentSpanId: string): Promise<AuditSpansDoc[]> => {
      return queryClient.fetchQuery(
        convexQuery(api.admin.audit.getChildSpans, { traceId, parentSpanId }),
      )
    },
    [queryClient, traceId],
  )

  // Callback for fetching workflow state
  const handleFetchWorkflowState = useCallback(
    async (params: {
      workflowId?: string
      timestamp: number
    }): Promise<WorkflowState | null> => {
      return queryClient.fetchQuery(
        convexQuery(api.admin.audit.getWorkflowStateAtTime, {
          traceId,
          workflowId: params.workflowId,
          timestamp: params.timestamp,
        }),
      )
    },
    [queryClient, traceId],
  )

  // Callback for fetching child instances
  const handleFetchChildInstances = useCallback(
    async (params: {
      taskName: string
      workflowName?: string
      timestamp: number
    }): Promise<WorkflowInstance[]> => {
      return queryClient.fetchQuery(
        convexQuery(api.admin.audit.getChildWorkflowInstances, {
          traceId,
          taskName: params.taskName,
          workflowName: params.workflowName,
          timestamp: params.timestamp,
        }),
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
          <Link to="/audit/$traceId" params={{ traceId }}>
            <Button variant="outline" size="sm">
              Back to Spans
            </Button>
          </Link>
        }
      />
      <div className="flex-1 h-full relative">
        <TimelineWorkflowVisualizer
          traceId={traceId}
          trace={trace}
          structure={workflowStructure}
          keyEvents={keyEvents}
          rootSpans={rootSpans}
          onLoadChildren={handleLoadChildren}
          onFetchWorkflowState={handleFetchWorkflowState}
          onFetchChildInstances={handleFetchChildInstances}
        />
      </div>
    </div>
  )
}
