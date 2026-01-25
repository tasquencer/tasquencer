import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/expenses')({
  component: ExpensesLayout,
  loader: () => ({ crumb: 'Expenses' }),
})

function ExpensesLayout() {
  return <Outlet />
}
