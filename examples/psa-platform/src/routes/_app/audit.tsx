import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/audit')({
  component: RouteComponent,
  loader: async () => {
    return {
      crumb: 'Audit',
    }
  },
})

function RouteComponent() {
  return <Outlet />
}
