import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/tasks')({
  component: TasksLayout,
  loader: () => {
    return { crumb: 'Tasks' }
  },
})

function TasksLayout() {
  return <Outlet />
}
