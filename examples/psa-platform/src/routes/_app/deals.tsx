import { createFileRoute, Outlet } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { api } from '@/convex/_generated/api'

export const Route = createFileRoute('/_app/deals')({
  component: DealsLayout,
  loader: async ({ context }) => {
    // Fetch dealToDelivery workflow structure for the Visualize button
    const workflowStructure = await context.queryClient.ensureQueryData(
      convexQuery(api.workflows.metadata.getWorkflowStructure, {
        workflow: { name: 'dealToDelivery', version: 'v1' },
      })
    )

    return {
      crumb: 'Deals',
      headerRight: { type: 'workflowStructure', data: workflowStructure },
    }
  },
})

function DealsLayout() {
  return <Outlet />
}
