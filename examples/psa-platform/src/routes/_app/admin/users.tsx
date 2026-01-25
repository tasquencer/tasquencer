import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin/users')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Users',
  }),
})

function RouteComponent() {
  return <Outlet />
}
