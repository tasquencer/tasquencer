import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useState, useEffect } from 'react'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import { Building2, ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const schema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  street: z.string().min(1, 'Street address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required'),
  paymentTerms: z.number().min(0, 'Payment terms must be non-negative').max(365),
})

type FormValues = z.infer<typeof schema>

export const Route = createFileRoute('/_app/companies/$companyId/edit')({
  component: EditCompany,
  loader: () => ({ crumb: 'Edit Company' }),
})

function EditCompany() {
  const { companyId } = Route.useParams()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const company = useQuery(
    api.workflows.dealToDelivery.api.companies.getCompany,
    { companyId: companyId as Id<'companies'> }
  )

  const updateCompany = useMutation(
    api.workflows.dealToDelivery.api.companies.updateCompany
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      paymentTerms: 30,
    },
  })

  // Populate form when company data loads
  useEffect(() => {
    if (company) {
      form.reset({
        name: company.name,
        street: company.billingAddress.street,
        city: company.billingAddress.city,
        state: company.billingAddress.state,
        postalCode: company.billingAddress.postalCode,
        country: company.billingAddress.country,
        paymentTerms: company.paymentTerms,
      })
    }
  }, [company, form])

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      await updateCompany({
        companyId: companyId as Id<'companies'>,
        name: values.name,
        billingAddress: {
          street: values.street,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
          country: values.country,
        },
        paymentTerms: values.paymentTerms,
      })

      toast.success('Company updated successfully')
      window.location.href = `/companies/${companyId}`
    } catch (error) {
      console.error('Failed to update company:', error)
      toast.error('Failed to update company. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = company === undefined

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
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
              <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Company not found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                The company you&apos;re trying to edit doesn&apos;t exist.
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
            <Building2 className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Edit Company
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              Update {company.name}&apos;s information.
            </p>
          </div>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Company Information
              </CardTitle>
              <CardDescription>
                Update the company details and billing address.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pb-6">
              {/* Company Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Company Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="Acme Corporation"
                  {...form.register('name')}
                  className="h-11"
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              {/* Billing Address Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Billing Address
                </h3>

                {/* Street */}
                <div className="space-y-2">
                  <Label htmlFor="street" className="text-sm font-medium">
                    Street Address <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="street"
                    placeholder="123 Main Street, Suite 100"
                    {...form.register('street')}
                    className="h-11"
                  />
                  {form.formState.errors.street && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.street.message}
                    </p>
                  )}
                </div>

                {/* City / State / Postal */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city" className="text-sm font-medium">
                      City <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="city"
                      placeholder="San Francisco"
                      {...form.register('city')}
                      className="h-11"
                    />
                    {form.formState.errors.city && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.city.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state" className="text-sm font-medium">
                      State <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="state"
                      placeholder="CA"
                      {...form.register('state')}
                      className="h-11"
                    />
                    {form.formState.errors.state && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.state.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="postalCode" className="text-sm font-medium">
                      Postal Code <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="postalCode"
                      placeholder="94102"
                      {...form.register('postalCode')}
                      className="h-11"
                    />
                    {form.formState.errors.postalCode && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.postalCode.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Country */}
                <div className="space-y-2">
                  <Label htmlFor="country" className="text-sm font-medium">
                    Country <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="country"
                    placeholder="United States"
                    {...form.register('country')}
                    className="h-11"
                  />
                  {form.formState.errors.country && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.country.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Payment Terms */}
              <div className="space-y-2">
                <Label htmlFor="paymentTerms" className="text-sm font-medium">
                  Payment Terms (days) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="paymentTerms"
                  type="number"
                  min="0"
                  max="365"
                  {...form.register('paymentTerms', { valueAsNumber: true })}
                  className="h-11 w-32"
                />
                <p className="text-sm text-muted-foreground">
                  Number of days until payment is due (Net terms)
                </p>
                {form.formState.errors.paymentTerms && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.paymentTerms.message}
                  </p>
                )}
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
                Cancel
              </Button>
              <Button
                type="submit"
                size="lg"
                className="gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <Building2 className="h-4 w-4" />
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  )
}
