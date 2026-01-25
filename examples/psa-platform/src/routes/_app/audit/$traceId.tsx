import { createFileRoute, Outlet } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '@/convex/_generated/api'
import { SpinningLoader } from '@/components/spinning-loader'

export const Route = createFileRoute('/_app/audit/$traceId')({
  component: RouteComponent,
  pendingComponent: Loading,
  loader: async ({ context, params }) => {
    // Load and cache trace data for all child routes
    const trace = await context.queryClient.ensureQueryData(
      convexQuery(api.admin.audit.getTrace, {
        traceId: params.traceId,
      }),
    )

    if (!trace) {
      throw new Error(`Trace not found: ${params.traceId}`)
    }

    return {
      trace,
      crumb: `${trace.name} (${trace.traceId})`,
    }
  },
})

function Loading() {
  return (
    <div className="p-4">
      <SpinningLoader />
    </div>
  )
}

function RouteComponent() {
  // Layout route loads data via loader, children access it via parent's useLoaderData()
  return <Outlet />
}
