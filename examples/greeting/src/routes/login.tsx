import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthForm } from '@/components/auth-form'

const fallback = '/simple' as const

export const Route = createFileRoute('/login')({
  validateSearch: z.object({
    redirect: z.string().optional().catch(''),
  }),
  component: RouteComponent,
  beforeLoad: ({ context, search }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: search.redirect || fallback })
    }
  },
})

function RouteComponent() {
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="w-96">
        <AuthForm />
      </div>
    </div>
  )
}
