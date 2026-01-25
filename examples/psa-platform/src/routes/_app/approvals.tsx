import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/approvals')({
  component: ApprovalsLayout,
  loader: () => ({ crumb: 'Approvals' }),
})

function ApprovalsLayout() {
  return <Outlet />
}
