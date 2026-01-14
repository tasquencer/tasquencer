import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin/groups')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Groups',
  }),
})

function RouteComponent() {
  return <Outlet />
}
