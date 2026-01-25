import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { Button } from '@repo/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Input } from '@repo/ui/components/input'
import { Textarea } from '@repo/ui/components/textarea'
import { Separator } from '@repo/ui/components/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@repo/ui/components/table'
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/deals/$dealId/estimate')({
  component: EstimatePage,
  loader: () => ({
    crumb: 'Create Estimate',
  }),
})

const serviceSchema = z.object({
  name: z.string().min(1, 'Service name is required'),
  rate: z.number().min(0, 'Enter a valid rate'),
  hours: z.number().min(0.5, 'Enter valid hours (min 0.5)'),
})

const estimateFormSchema = z.object({
  services: z.array(serviceSchema).min(1, 'Add at least one service'),
  notes: z.string().max(2000, 'Notes must be less than 2000 characters').optional(),
})

type EstimateFormValues = z.infer<typeof estimateFormSchema>

// Service templates with rates in dollars
const SERVICE_TEMPLATES = [
  { name: 'Design', rate: 150 },
  { name: 'Development', rate: 175 },
  { name: 'Project Management', rate: 125 },
  { name: 'QA Testing', rate: 100 },
  { name: 'Strategy/Discovery', rate: 200 },
]

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function EstimatePage() {
  const { dealId } = Route.useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const deal = useQuery(api.workflows.dealToDelivery.api.deals.getDeal, {
    dealId: dealId as Id<'deals'>,
  })

  const workItems = useQuery(
    api.workflows.dealToDelivery.api.workItems.getTasksByDeal,
    { dealId: dealId as Id<'deals'> }
  )

  const startWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.startWorkItem
  )
  const completeWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.completeWorkItem
  )

  const form = useForm<EstimateFormValues>({
    resolver: zodResolver(estimateFormSchema),
    defaultValues: {
      services: [{ name: '', rate: 0, hours: 0 }],
      notes: '',
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'services',
  })

  const watchServices = form.watch('services')

  // Calculate totals
  const serviceLineTotals = watchServices.map(
    (service) => (service.rate || 0) * (service.hours || 0)
  )
  const subtotal = serviceLineTotals.reduce((sum, total) => sum + total, 0)

  // Find the createEstimate work item
  const estimateWorkItem = workItems?.find(
    (wi) => wi.taskType === 'createEstimate' && wi.status !== 'completed'
  )

  function addServiceTemplate(template: (typeof SERVICE_TEMPLATES)[number]) {
    append({ name: template.name, rate: template.rate, hours: 0 })
  }

  async function onSubmit(data: EstimateFormValues) {
    if (!estimateWorkItem) {
      toast.error('No estimate work item available')
      return
    }

    setIsSubmitting(true)
    try {
      // Start/claim the work item if not already started
      if (estimateWorkItem.status === 'pending') {
        await startWorkItem({
          workItemId: estimateWorkItem.workItemId,
          args: {
            name: 'createEstimate' as const,
          },
        })
      }

      // Complete the work item with services (convert rates to cents)
      await completeWorkItem({
        workItemId: estimateWorkItem.workItemId,
        args: {
          name: 'createEstimate' as const,
          payload: {
            dealId: dealId as Id<'deals'>,
            services: data.services.map((s) => ({
              name: s.name,
              rate: Math.round(s.rate * 100), // Convert dollars to cents
              hours: s.hours,
            })),
            notes: data.notes,
          },
        },
      })

      toast.success(
        `Estimate created - ${formatCurrency(Math.round(subtotal * 100))}`
      )

      setIsRedirecting(true)

      // Navigate back to deal detail
      navigate({ to: '/deals/$dealId', params: { dealId } })
    } catch (error) {
      console.error('Failed to create estimate:', error)
      toast.error('Failed to create estimate. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (deal === undefined || workItems === undefined) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (deal === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <h3 className="text-lg font-medium">Deal not found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The deal you're looking for doesn't exist.
          </p>
          <Button asChild>
            <a href="/deals">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deals
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (isRedirecting || isSubmitting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">
            {isRedirecting ? 'Estimate saved' : 'Submitting estimate'}
          </h3>
          <p className="text-muted-foreground mt-1">
            {isRedirecting
              ? 'Redirecting back to the deal.'
              : 'This should only take a moment.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (deal.stage !== 'Qualified') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">Cannot create estimate</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            This deal is in the "{deal.stage}" stage. Estimates can only be
            created for qualified deals.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deal
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!estimateWorkItem) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium">No estimate task available</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            The create estimate work item is not available yet. The workflow may
            not have reached this step.
          </p>
          <Button asChild>
            <a href={`/deals/${dealId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Deal
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Create Estimate: {deal.name}</CardTitle>
            <CardDescription>
              Add service line items with rates and hours
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Service Templates */}
          <div className="space-y-2">
            <Label>Quick Add Service Templates</Label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TEMPLATES.map((template) => (
                <Button
                  key={template.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addServiceTemplate(template)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {template.name} (${template.rate}/hr)
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Services Table */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Services</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ name: '', rate: 0, hours: 0 })}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Service
              </Button>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Service Name</TableHead>
                    <TableHead className="w-[20%]">Rate ($/hr)</TableHead>
                    <TableHead className="w-[15%]">Hours</TableHead>
                    <TableHead className="w-[15%] text-right">Total</TableHead>
                    <TableHead className="w-[10%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell>
                        <Input
                          {...form.register(`services.${index}.name`)}
                          placeholder="Service name"
                          className="h-9"
                        />
                        {form.formState.errors.services?.[index]?.name && (
                          <p className="text-xs text-destructive mt-1">
                            {form.formState.errors.services[index]?.name?.message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          {...form.register(`services.${index}.rate`, {
                            valueAsNumber: true,
                          })}
                          placeholder="0"
                          className="h-9"
                        />
                        {form.formState.errors.services?.[index]?.rate && (
                          <p className="text-xs text-destructive mt-1">
                            {form.formState.errors.services[index]?.rate?.message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.5"
                          {...form.register(`services.${index}.hours`, {
                            valueAsNumber: true,
                          })}
                          placeholder="0"
                          className="h-9"
                        />
                        {form.formState.errors.services?.[index]?.hours && (
                          <p className="text-xs text-destructive mt-1">
                            {form.formState.errors.services[index]?.hours?.message}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${serviceLineTotals[index]?.toLocaleString() || 0}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => fields.length > 1 && remove(index)}
                          disabled={fields.length === 1}
                          className="h-8 w-8"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">
                      Subtotal
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      ${subtotal.toLocaleString()}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {form.formState.errors.services?.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.services.root.message}
              </p>
            )}
            {form.formState.errors.services?.message && (
              <p className="text-sm text-destructive">
                {form.formState.errors.services.message}
              </p>
            )}
          </div>

          <Separator />

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any additional notes about this estimate..."
              {...form.register('notes')}
              className="min-h-[80px]"
            />
            {form.formState.errors.notes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>

          <Separator />

          {/* Form Actions */}
          <div className="flex items-center justify-between">
            <Button variant="outline" type="button" asChild>
              <a href={`/deals/${dealId}`}>
                Cancel
              </a>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Create Estimate
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
