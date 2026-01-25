/**
 * Invoice Creation Form
 *
 * Allows creating invoices using different billing methods:
 * - Time & Materials: Aggregate approved time entries + expenses
 * - Fixed Fee: Invoice a fixed amount or percentage of budget
 * - Milestone: Invoice for completed deliverables
 * - Recurring: Monthly retainer billing
 *
 * Reference: .review/recipes/psa-platform/specs/23-ui-invoice-creation-form.md
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { useState, useMemo } from 'react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { Input } from '@repo/ui/components/input'
import { Textarea } from '@repo/ui/components/textarea'
import { Checkbox } from '@repo/ui/components/checkbox'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select'
import { Separator } from '@repo/ui/components/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table'
import { Receipt, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/projects/$projectId/invoices/new')({
  component: InvoiceCreationForm,
})

type InvoiceMethod = 'TimeAndMaterials' | 'FixedFee' | 'Milestone' | 'Recurring'

interface LineItem {
  description: string
  quantity: number
  rate: number
  amount: number
  timeEntryIds?: Id<'timeEntries'>[]
  expenseIds?: Id<'expenses'>[]
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function toDateInputValue(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0]
}

function fromDateInputValue(dateString: string): number {
  return new Date(dateString).getTime()
}

function InvoiceCreationForm() {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()

  // Form state
  const [method, setMethod] = useState<InvoiceMethod>('TimeAndMaterials')
  const [includeTime, setIncludeTime] = useState(true)
  const [includeExpenses, setIncludeExpenses] = useState(true)
  const [groupBy, setGroupBy] = useState<'service' | 'task' | 'date' | 'person'>('service')
  const [dateRangeStart, setDateRangeStart] = useState<string>(
    toDateInputValue(Date.now() - 30 * 24 * 60 * 60 * 1000)
  )
  const [dateRangeEnd, setDateRangeEnd] = useState<string>(toDateInputValue(Date.now()))
  const [fixedAmount, setFixedAmount] = useState<string>('')
  const [fixedDescription, setFixedDescription] = useState('')
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>(
    toDateInputValue(Date.now() + 30 * 24 * 60 * 60 * 1000)
  )
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Queries
  const project = useQuery(api.workflows.dealToDelivery.api.projects.getProject, {
    projectId: projectId as Id<'projects'>,
  })

  const uninvoicedItems = useQuery(
    api.workflows.dealToDelivery.api.invoices.getUninvoicedItems,
    { projectId: projectId as Id<'projects'> }
  )

  const milestones = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjectUninvoicedMilestones,
    { projectId: projectId as Id<'projects'> }
  )

  // Mutations
  const createInvoiceDraft = useMutation(
    api.workflows.dealToDelivery.api.invoices.createInvoiceDraft
  )
  const addLineItem = useMutation(
    api.workflows.dealToDelivery.api.invoices.addInvoiceLineItem
  )

  // Compute preview line items based on method and options
  const previewLineItems = useMemo((): LineItem[] => {
    if (!uninvoicedItems) return []

    const items: LineItem[] = []

    if (method === 'TimeAndMaterials') {
      // Filter time entries by date range
      const startTs = fromDateInputValue(dateRangeStart)
      const endTs = fromDateInputValue(dateRangeEnd) + 24 * 60 * 60 * 1000 // Include end date

      if (includeTime) {
        const filteredEntries = uninvoicedItems.timeEntries.filter(
          (e) => e.date >= startTs && e.date <= endTs
        )

        // Group by selected option
        if (groupBy === 'service') {
          // Group by service name (using a simple approach)
          const byService = new Map<string, typeof filteredEntries>()
          for (const entry of filteredEntries) {
            const key = entry.serviceId?.toString() || 'Other'
            const existing = byService.get(key) || []
            existing.push(entry)
            byService.set(key, existing)
          }

          for (const [, entries] of byService) {
            const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)
            // Use a default rate if not available
            const avgRate = 15000 // $150/hr in cents
            items.push({
              description: `Professional Services (${entries.length} entries)`,
              quantity: totalHours,
              rate: avgRate,
              amount: Math.round(totalHours * avgRate),
              timeEntryIds: entries.map((e) => e._id),
            })
          }
        } else {
          // Simple aggregate for other grouping options
          const totalHours = filteredEntries.reduce((sum, e) => sum + e.hours, 0)
          const avgRate = 15000 // $150/hr in cents
          items.push({
            description: 'Professional Services',
            quantity: totalHours,
            rate: avgRate,
            amount: Math.round(totalHours * avgRate),
            timeEntryIds: filteredEntries.map((e) => e._id),
          })
        }
      }

      if (includeExpenses) {
        const filteredExpenses = uninvoicedItems.expenses.filter(
          (e) => e.date >= startTs && e.date <= endTs
        )

        if (filteredExpenses.length > 0) {
          const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0)
          items.push({
            description: `Expenses (${filteredExpenses.length} items)`,
            quantity: 1,
            rate: totalExpenses,
            amount: totalExpenses,
            expenseIds: filteredExpenses.map((e) => e._id),
          })
        }
      }
    } else if (method === 'FixedFee') {
      const amount = Math.round(parseFloat(fixedAmount || '0') * 100)
      if (amount > 0) {
        items.push({
          description: fixedDescription || 'Fixed Fee',
          quantity: 1,
          rate: amount,
          amount: amount,
        })
      }

      if (includeExpenses && uninvoicedItems.expenses.length > 0) {
        const totalExpenses = uninvoicedItems.expenses.reduce((sum, e) => sum + e.amount, 0)
        items.push({
          description: `Expenses (${uninvoicedItems.expenses.length} items)`,
          quantity: 1,
          rate: totalExpenses,
          amount: totalExpenses,
          expenseIds: uninvoicedItems.expenses.map((e) => e._id),
        })
      }
    } else if (method === 'Milestone') {
      const milestone = milestones?.find((m) => m._id === selectedMilestoneId)
      if (milestone) {
        items.push({
          description: `Milestone: ${milestone.name}`,
          quantity: 1,
          rate: milestone.amount,
          amount: milestone.amount,
        })
      }

      if (includeExpenses && uninvoicedItems.expenses.length > 0) {
        const totalExpenses = uninvoicedItems.expenses.reduce((sum, e) => sum + e.amount, 0)
        items.push({
          description: `Expenses (${uninvoicedItems.expenses.length} items)`,
          quantity: 1,
          rate: totalExpenses,
          amount: totalExpenses,
          expenseIds: uninvoicedItems.expenses.map((e) => e._id),
        })
      }
    } else if (method === 'Recurring') {
      // For recurring, use budget info if available
      const monthlyAmount = project?.budget?.totalAmount
        ? Math.round(project.budget.totalAmount / 12)
        : 0
      if (monthlyAmount > 0) {
        items.push({
          description: 'Monthly Retainer',
          quantity: 1,
          rate: monthlyAmount,
          amount: monthlyAmount,
        })
      }
    }

    return items
  }, [
    method,
    uninvoicedItems,
    milestones,
    project,
    includeTime,
    includeExpenses,
    groupBy,
    dateRangeStart,
    dateRangeEnd,
    fixedAmount,
    fixedDescription,
    selectedMilestoneId,
  ])

  const subtotal = previewLineItems.reduce((sum, item) => sum + item.amount, 0)
  const tax = 0 // 0% tax by default
  const total = subtotal + tax

  // Budget context
  const budgetTotal = project?.metrics?.budgetTotal ?? 0
  const budgetUsed = project?.metrics?.budgetUsed ?? 0
  const budgetRemaining = project?.metrics?.budgetRemaining ?? 0

  // Handle form submission
  const handleCreateInvoice = async (finalize: boolean) => {
    if (!project || previewLineItems.length === 0) {
      toast.error('No items to invoice')
      return
    }

    setIsSubmitting(true)
    try {
      // Create the invoice draft
      const invoiceId = await createInvoiceDraft({
        projectId: projectId as Id<'projects'>,
        companyId: project.companyId as Id<'companies'>,
        organizationId: project.organizationId,
        method: method,
        dueDate: fromDateInputValue(dueDate),
      })

      // Add line items
      for (const item of previewLineItems) {
        await addLineItem({
          invoiceId,
          description: item.description,
          quantity: item.quantity,
          rate: item.rate,
          timeEntryIds: item.timeEntryIds,
          expenseIds: item.expenseIds,
        })
      }

      toast.success(
        finalize
          ? 'Invoice created and finalized'
          : 'Invoice draft created'
      )

      // Navigate back to project page
      navigate({ to: '/projects/$projectId', params: { projectId } })
    } catch (error) {
      console.error('Failed to create invoice:', error)
      toast.error('Failed to create invoice')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (project === undefined || uninvoicedItems === undefined) {
    return (
      <Card className="mt-6">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </CardContent>
      </Card>
    )
  }

  if (project === null) {
    return (
      <Card className="mt-6">
        <CardContent className="py-12 text-center text-muted-foreground">
          Project not found
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Create Invoice
        </CardTitle>
        <CardDescription>
          Generate an invoice for {project.name}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Method Selection */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Invoicing Method</Label>
          <RadioGroup
            value={method}
            onValueChange={(value) => setMethod(value as InvoiceMethod)}
            className="grid grid-cols-2 gap-4"
          >
            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value="TimeAndMaterials" id="tm" />
              <Label htmlFor="tm" className="cursor-pointer flex-1">
                <div className="font-medium">Time & Materials</div>
                <div className="text-sm text-muted-foreground">
                  Bill approved hours + expenses
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value="FixedFee" id="fixed" />
              <Label htmlFor="fixed" className="cursor-pointer flex-1">
                <div className="font-medium">Fixed Fee</div>
                <div className="text-sm text-muted-foreground">
                  Invoice a fixed amount
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value="Milestone" id="milestone" />
              <Label htmlFor="milestone" className="cursor-pointer flex-1">
                <div className="font-medium">Milestone</div>
                <div className="text-sm text-muted-foreground">
                  Bill for completed deliverables
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value="Recurring" id="recurring" />
              <Label htmlFor="recurring" className="cursor-pointer flex-1">
                <div className="font-medium">Recurring</div>
                <div className="text-sm text-muted-foreground">
                  Monthly retainer billing
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        {/* Method-Specific Fields */}
        {method === 'TimeAndMaterials' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeTime"
                  checked={includeTime}
                  onCheckedChange={(checked) => setIncludeTime(checked === true)}
                />
                <Label htmlFor="includeTime">
                  Include time entries ({uninvoicedItems.timeEntries.length} available)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeExpenses"
                  checked={includeExpenses}
                  onCheckedChange={(checked) => setIncludeExpenses(checked === true)}
                />
                <Label htmlFor="includeExpenses">
                  Include expenses ({uninvoicedItems.expenses.length} available)
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupBy">Group By</Label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                <SelectTrigger id="groupBy" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service (Recommended)</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="person">Person</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {method === 'FixedFee' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fixedAmount">Invoice Amount ($)</Label>
                <Input
                  id="fixedAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Quick Fill (% of Budget)</Label>
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <Button
                      key={pct}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFixedAmount(((budgetTotal * pct) / 100 / 100).toFixed(2))
                      }
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fixedDescription">Description</Label>
              <Input
                id="fixedDescription"
                placeholder="e.g., Phase 1 Delivery"
                value={fixedDescription}
                onChange={(e) => setFixedDescription(e.target.value)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeExpensesFixed"
                checked={includeExpenses}
                onCheckedChange={(checked) => setIncludeExpenses(checked === true)}
              />
              <Label htmlFor="includeExpensesFixed">
                Include expenses ({uninvoicedItems.expenses.length} available)
              </Label>
            </div>
          </div>
        )}

        {method === 'Milestone' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="milestone">Select Milestone</Label>
              <Select
                value={selectedMilestoneId}
                onValueChange={setSelectedMilestoneId}
              >
                <SelectTrigger id="milestone">
                  <SelectValue placeholder="Select a completed milestone..." />
                </SelectTrigger>
                <SelectContent>
                  {milestones && milestones.length > 0 ? (
                    milestones.map((m) => (
                      <SelectItem key={m._id} value={m._id}>
                        {m.name} - {formatCurrency(m.amount)}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>
                      No uninvoiced milestones available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeExpensesMilestone"
                checked={includeExpenses}
                onCheckedChange={(checked) => setIncludeExpenses(checked === true)}
              />
              <Label htmlFor="includeExpensesMilestone">
                Include expenses ({uninvoicedItems.expenses.length} available)
              </Label>
            </div>
          </div>
        )}

        {method === 'Recurring' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingPeriodStart">Billing Period Start</Label>
                <Input
                  id="billingPeriodStart"
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => setDateRangeStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingPeriodEnd">Billing Period End</Label>
                <Input
                  id="billingPeriodEnd"
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => setDateRangeEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-4 text-sm">
              <p className="text-muted-foreground">
                Monthly retainer amount will be calculated based on project budget.
                Estimated: {formatCurrency(project?.budget?.totalAmount ? Math.round(project.budget.totalAmount / 12) : 0)}/month
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Common Fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="dueDate">Due Date</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes to Client</Label>
          <Textarea
            id="notes"
            placeholder="Optional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <Separator />

        {/* Budget Context */}
        <div className="rounded-lg border p-4 space-y-2">
          <h4 className="font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Budget Context
          </h4>
          <div className="grid grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total Budget</p>
              <p className="font-medium">{formatCurrency(budgetTotal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Used</p>
              <p className="font-medium">{formatCurrency(budgetUsed)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Remaining</p>
              <p className="font-medium text-green-600">{formatCurrency(budgetRemaining)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">This Invoice</p>
              <p className="font-medium text-blue-600">{formatCurrency(total)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Will Remain</p>
              <p className="font-medium">{formatCurrency(budgetRemaining - total)}</p>
            </div>
          </div>
        </div>

        {/* Line Items Preview */}
        <div className="space-y-3">
          <h4 className="font-medium">Preview Line Items</h4>
          {previewLineItems.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No billable items match your criteria</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewLineItems.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-right">
                      {item.quantity.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.rate)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell colSpan={3} className="text-right font-medium">
                    Subtotal
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(subtotal)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">
                    Tax (0%)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(tax)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={3} className="text-right font-bold">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg">
                    {formatCurrency(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex justify-between border-t pt-6">
        <Button
          variant="outline"
          onClick={() => navigate({ to: '/projects/$projectId', params: { projectId } })}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => handleCreateInvoice(false)}
            disabled={isSubmitting || previewLineItems.length === 0}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save as Draft
          </Button>
          <Button
            onClick={() => handleCreateInvoice(true)}
            disabled={isSubmitting || previewLineItems.length === 0}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Create & Finalize
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
