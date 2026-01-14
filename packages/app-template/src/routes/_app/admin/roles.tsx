import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin/roles')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Roles',
  }),
})

function RouteComponent() {
  return <Outlet />
}
