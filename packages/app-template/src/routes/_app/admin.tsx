import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Admin',
  }),
})

function RouteComponent() {
  return <Outlet />
}
