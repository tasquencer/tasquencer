import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useState } from 'react'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import { Users, ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const schema = z.object({
  name: z.string().min(1, 'Contact name is required').max(200),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  phone: z.string().min(1, 'Phone number is required').max(50),
  isPrimary: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export const Route = createFileRoute('/_app/companies/$companyId/contacts/new')({
  component: NewContact,
  loader: () => ({ crumb: 'New Contact' }),
})

function NewContact() {
  const { companyId } = Route.useParams()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get company name for display
  const company = useQuery(
    api.workflows.dealToDelivery.api.companies.getCompany,
    { companyId: companyId as Id<'companies'> }
  )

  const createContact = useMutation(
    api.workflows.dealToDelivery.api.companies.createContact
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      isPrimary: false,
    },
  })

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      await createContact({
        companyId: companyId as Id<'companies'>,
        name: values.name,
        email: values.email,
        phone: values.phone,
        isPrimary: values.isPrimary,
      })

      toast.success('Contact created successfully')
      window.location.href = `/companies/${companyId}`
    } catch (error) {
      console.error('Failed to create contact:', error)
      toast.error('Failed to create contact. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = company === undefined

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (company === null) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Company not found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                Cannot add a contact to a non-existent company.
              </p>
              <Button asChild>
                <Link to="/companies">Back to Companies</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
            <Users className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Add Contact
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              Add a new contact for {company.name}
            </p>
          </div>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Contact Information
              </CardTitle>
              <CardDescription>
                Enter the contact&apos;s details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pb-6">
              {/* Contact Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="John Smith"
                  {...form.register('name')}
                  className="h-11"
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john.smith@company.com"
                  {...form.register('email')}
                  className="h-11"
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  {...form.register('phone')}
                  className="h-11"
                />
                {form.formState.errors.phone && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.phone.message}
                  </p>
                )}
              </div>

              {/* Primary Contact */}
              <div className="flex items-start space-x-3 pt-2">
                <Checkbox
                  id="isPrimary"
                  checked={form.watch('isPrimary')}
                  onCheckedChange={(checked) =>
                    form.setValue('isPrimary', checked === true)
                  }
                />
                <div className="grid gap-1.5 leading-none">
                  <Label
                    htmlFor="isPrimary"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Primary Contact
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Mark this as the primary contact for {company.name}
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col-reverse gap-3 px-6 py-4 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => (window.location.href = `/companies/${companyId}`)}
                disabled={isSubmitting}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Company
              </Button>
              <Button
                type="submit"
                size="lg"
                className="gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <Users className="h-4 w-4" />
                {isSubmitting ? 'Adding...' : 'Add Contact'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  )
}
