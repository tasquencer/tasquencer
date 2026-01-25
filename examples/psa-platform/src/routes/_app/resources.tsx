import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/resources')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Outlet />
}
