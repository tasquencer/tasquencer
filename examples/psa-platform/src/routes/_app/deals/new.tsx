import { createFileRoute } from '@tanstack/react-router'
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
import { Textarea } from '@repo/ui/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import { Briefcase, ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const schema = z.object({
  name: z.string().min(1, 'Deal name is required').max(200),
  companyId: z.string().min(1, 'Please select a company'),
  contactId: z.string().min(1, 'Please select a contact'),
  value: z.number().min(0, 'Value must be non-negative'),
  ownerId: z.string().min(1, 'Please select an owner'),
  notes: z.string().max(2000, 'Notes must be less than 2000 characters').optional(),
})

type FormValues = z.infer<typeof schema>

export const Route = createFileRoute('/_app/deals/new')({
  component: NewDeal,
  loader: () => ({ crumb: 'New Deal' }),
})

function NewDeal() {
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch companies
  const companies = useQuery(
    api.workflows.dealToDelivery.api.companies.listCompanies
  )

  // Fetch users for owner dropdown
  const users = useQuery(
    api.workflows.dealToDelivery.api.organizations.listUsers,
    { activeOnly: true }
  )

  // Watch company selection to filter contacts
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const contacts = useQuery(
    api.workflows.dealToDelivery.api.companies.listContacts,
    selectedCompanyId
      ? { companyId: selectedCompanyId as Id<'companies'> }
      : 'skip'
  )

  // Mutation to create a new deal
  const createDeal = useMutation(
    api.workflows.dealToDelivery.api.deals.initializeDealToDelivery
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      companyId: '',
      contactId: '',
      value: 0,
      ownerId: '',
      notes: '',
    },
  })

  // When company changes, clear contact
  const watchCompanyId = form.watch('companyId')
  useEffect(() => {
    if (watchCompanyId !== selectedCompanyId) {
      setSelectedCompanyId(watchCompanyId)
      form.setValue('contactId', '')
    }
  }, [watchCompanyId, selectedCompanyId, form])

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      // Convert dollars to cents for storage
      const valueInCents = Math.round(values.value * 100)

      // Create the deal via the workflow-first API
      await createDeal({
        companyId: values.companyId as Id<'companies'>,
        contactId: values.contactId as Id<'contacts'>,
        name: values.name,
        value: valueInCents,
        ownerId: values.ownerId as Id<'users'>,
      })

      toast.success('Deal created successfully')

      // Navigate to deals pipeline
      window.location.href = '/deals'
    } catch (error) {
      console.error('Failed to create deal:', error)
      toast.error('Failed to create deal. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isLoading = companies === undefined || users === undefined

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
            <Briefcase className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Create New Deal
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              Start a new deal workflow in your sales pipeline.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading...
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">
                  Deal Information
                </CardTitle>
                <CardDescription>
                  Enter the deal information to start the sales workflow.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pb-6">
                {/* Deal Name */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">
                    Deal Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Website Redesign Project"
                    {...form.register('name')}
                    className="h-11"
                  />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                {/* Company */}
                <div className="space-y-2">
                  <Label htmlFor="companyId" className="text-sm font-medium">
                    Company <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch('companyId')}
                    onValueChange={(value) => form.setValue('companyId', value)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {companies?.map((company) => (
                        <SelectItem key={company._id} value={company._id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.companyId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.companyId.message}
                    </p>
                  )}
                </div>

                {/* Contact */}
                <div className="space-y-2">
                  <Label htmlFor="contactId" className="text-sm font-medium">
                    Contact <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch('contactId')}
                    onValueChange={(value) => form.setValue('contactId', value)}
                    disabled={!selectedCompanyId}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue
                        placeholder={
                          selectedCompanyId
                            ? 'Select contact...'
                            : 'Select a company first'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts?.map((contact) => (
                        <SelectItem key={contact._id} value={contact._id}>
                          {contact.name} ({contact.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCompanyId && contacts?.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No contacts found for this company
                    </p>
                  )}
                  {form.formState.errors.contactId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.contactId.message}
                    </p>
                  )}
                </div>

                {/* Deal Value */}
                <div className="space-y-2">
                  <Label htmlFor="value" className="text-sm font-medium">
                    Deal Value ($) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="value"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="50000"
                    {...form.register('value', { valueAsNumber: true })}
                    className="h-11"
                  />
                  {form.formState.errors.value && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.value.message}
                    </p>
                  )}
                </div>

                {/* Deal Owner */}
                <div className="space-y-2">
                  <Label htmlFor="ownerId" className="text-sm font-medium">
                    Deal Owner <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch('ownerId')}
                    onValueChange={(value) => form.setValue('ownerId', value)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select owner..." />
                    </SelectTrigger>
                    <SelectContent>
                      {users?.map((user) => (
                        <SelectItem key={user._id} value={user._id}>
                          {user.name} ({user.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.ownerId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.ownerId.message}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-sm font-medium">
                    Notes
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="Add any additional notes about this deal..."
                    {...form.register('notes')}
                    className="min-h-[100px]"
                  />
                  {form.formState.errors.notes && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.notes.message}
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex flex-col-reverse gap-3 px-6 py-4 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => (window.location.href = '/deals')}
                  disabled={isSubmitting}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Deals
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  className="gap-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Briefcase className="h-4 w-4" />
                  {isSubmitting ? 'Creating...' : 'Create Deal'}
                </Button>
              </CardFooter>
            </Card>
          </form>
        )}
      </div>
    </div>
  )
}
