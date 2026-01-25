import { cn } from '@/lib/utils'
import { Button } from '@repo/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card'
import { Input } from '@repo/ui/components/input'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@repo/ui/components/form'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Loader2 } from 'lucide-react'
import { useRouter } from '@tanstack/react-router'

const signInFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const signUpFormSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

function SignInForm({
  onSwitchToSignUp,
  onSuccess,
}: {
  onSwitchToSignUp: () => void
  onSuccess: () => void
}) {
  const form = useForm<z.infer<typeof signInFormSchema>>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })
  async function onSubmit(values: z.infer<typeof signInFormSchema>) {
    await authClient.signIn.email(
      {
        email: values.email,
        password: values.password,
      },
      {
        onError: (ctx) => {
          form.setError('root.signInError', {
            message: ctx.error.message,
          })
        },
        onSuccess: () => {
          onSuccess()
        },
      },
    )
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="flex flex-col gap-6">
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {form.formState.errors.root?.signInError && (
            <FormMessage>
              {form.formState.errors.root.signInError.message}
            </FormMessage>
          )}
          <div className="flex flex-col gap-3">
            <Button type="submit" className="w-full">
              {form.formState.isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Sign in'
              )}
            </Button>
            <div className="text-sm text-center border-t border-border pt-3 mt-3">
              Don't have an account?{' '}
              <Button
                type="button"
                variant="link"
                className="inline p-0 cursor-pointer"
                onClick={onSwitchToSignUp}
              >
                Sign up
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  )
}

function SignUpForm({
  onSwitchToSignIn,
  onSuccess,
}: {
  onSwitchToSignIn: () => void
  onSuccess: () => void
}) {
  const form = useForm<z.infer<typeof signUpFormSchema>>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })
  async function onSubmit(values: z.infer<typeof signUpFormSchema>) {
    await authClient.signUp.email(
      {
        name: values.name,
        email: values.email,
        password: values.password,
      },
      {
        onError: (ctx) => {
          form.setError('root.signUpError', {
            message: ctx.error.message,
          })
        },
        onSuccess: () => {
          onSuccess()
        },
      },
    )
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="flex flex-col gap-6">
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-3">
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {form.formState.errors.root?.signUpError && (
            <FormMessage>
              {form.formState.errors.root.signUpError.message}
            </FormMessage>
          )}
          <div className="flex flex-col gap-3">
            <Button type="submit" className="w-full">
              {form.formState.isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Create account'
              )}
            </Button>
            <div className="text-sm text-center border-t border-border pt-3 mt-3">
              Already have an account?{' '}
              <Button
                type="button"
                variant="link"
                className="inline p-0 cursor-pointer"
                onClick={onSwitchToSignIn}
              >
                Sign in
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  )
}

export function AuthForm({
  className,
  defaultTab = 'login',
  ...props
}: React.ComponentProps<'div'> & { defaultTab?: 'login' | 'signup' }) {
  const router = useRouter()
  const [tab, setTab] = useState<'login' | 'signup'>(defaultTab)

  const handleSuccess = () => {
    router.invalidate()
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            {tab === 'login'
              ? 'Sign in to your account'
              : 'Create a new account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tab === 'login' ? (
            <SignInForm
              onSwitchToSignUp={() => setTab('signup')}
              onSuccess={handleSuccess}
            />
          ) : (
            <SignUpForm
              onSwitchToSignIn={() => setTab('login')}
              onSuccess={handleSuccess}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
