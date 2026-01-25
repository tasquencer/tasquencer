import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/timesheet')({
  component: TimesheetLayout,
  loader: () => ({ crumb: 'Timesheet' }),
})

function TimesheetLayout() {
  return <Outlet />
}
