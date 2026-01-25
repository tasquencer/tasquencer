import { formatDuration, intervalToDuration } from 'date-fns'
import type { AuditTracesDoc } from '@repo/tasquencer'

type Trace = AuditTracesDoc
type TraceState = Trace['state']

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDurationIntelligently(ms: number): string {
  const duration = intervalToDuration({ start: 0, end: ms })

  return (
    formatDuration(duration, {
      format: ['years', 'months', 'days', 'hours', 'minutes', 'seconds'],
      delimiter: ', ',
    }) || `${ms}ms`
  )
}

/**
 * Calculate trace duration (completed or ongoing)
 */
export function calculateTraceDuration(trace: Trace): number {
  return trace.endedAt
    ? trace.endedAt - trace.startedAt
    : Date.now() - trace.startedAt
}

/**
 * Extract workflow name from trace attributes.
 * Returns undefined if the trace is not a workflow trace.
 */
export function extractWorkflowName(trace: Trace): string | undefined {
  if (trace.attributes?.type === 'workflow') {
    return trace.attributes.workflowName
  }
  return undefined
}

/**
 * Extract workflow version from trace attributes.
 * Returns undefined if the trace is not a workflow trace.
 */
export function extractWorkflowVersion(trace: Trace): string | undefined {
  if (trace.attributes?.type === 'workflow') {
    return trace.attributes.versionName
  }
  return undefined
}

/**
 * Get the appropriate badge variant for a trace state.
 * Maps trace states to visual badge variants for consistent UI.
 */
export function getTraceStateBadgeVariant(
  state: TraceState,
): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (state) {
    case 'completed':
      return 'default'
    case 'failed':
      return 'destructive'
    case 'canceled':
      return 'secondary'
    default:
      return 'outline'
  }
}
