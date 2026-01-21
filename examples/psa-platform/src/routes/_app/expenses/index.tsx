import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id, Doc } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select'
import {
  Receipt,
  Plus,
  Loader2,
  DollarSign,
  Building2,
  Calendar,
  FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/expenses/')({
  component: ExpensesPage,
})

const EXPENSE_TYPES = [
  'Software',
  'Travel',
  'Materials',
  'Subcontractor',
  'Other',
] as const
type ExpenseType = (typeof EXPENSE_TYPES)[number]

// Format currency in dollars
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

// Format date
function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp))
}

// Get status badge variant
function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'Approved':
      return 'default'
    case 'Submitted':
      return 'secondary'
    case 'Draft':
      return 'outline'
    case 'Rejected':
      return 'destructive'
    default:
      return 'outline'
  }
}

// Get expense type icon/color
function getExpenseTypeColor(type: ExpenseType): string {
  switch (type) {
    case 'Software':
      return 'bg-blue-100 text-blue-700'
    case 'Travel':
      return 'bg-green-100 text-green-700'
    case 'Materials':
      return 'bg-amber-100 text-amber-700'
    case 'Subcontractor':
      return 'bg-purple-100 text-purple-700'
    case 'Other':
      return 'bg-gray-100 text-gray-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

// Expense Modal Component
function ExpenseModal({
  isOpen,
  onClose,
  projects,
  existingExpense,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  projects: Array<{ _id: Id<'projects'>; name: string }> | undefined
  existingExpense?: Doc<'expenses'>
  onSave: (expense: {
    projectId: Id<'projects'>
    type: ExpenseType
    amount: number
    currency: string
    description: string
    date: number
    billable: boolean
    markupRate?: number
    vendorInfo?: { name: string; taxId?: string }
  }) => Promise<void>
}) {
  const [projectId, setProjectId] = useState<string>(
    existingExpense?.projectId ?? ''
  )
  const [expenseType, setExpenseType] = useState<ExpenseType>(
    (existingExpense?.type as ExpenseType) ?? 'Other'
  )
  const [amount, setAmount] = useState<string>(
    existingExpense ? (existingExpense.amount / 100).toFixed(2) : ''
  )
  const [description, setDescription] = useState<string>(
    existingExpense?.description ?? ''
  )
  const [date, setDate] = useState<string>(() => {
    if (existingExpense) {
      return new Date(existingExpense.date).toISOString().split('T')[0]
    }
    return new Date().toISOString().split('T')[0]
  })
  const [billable, setBillable] = useState<boolean>(
    existingExpense?.billable ?? true
  )
  const [markupRate, setMarkupRate] = useState<string>(
    existingExpense?.markupRate
      ? ((existingExpense.markupRate - 1) * 100).toString()
      : '0'
  )
  const [vendorName, setVendorName] = useState<string>(
    existingExpense?.vendorInfo?.name ?? ''
  )
  const [vendorTaxId, setVendorTaxId] = useState<string>(
    existingExpense?.vendorInfo?.taxId ?? ''
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSave = async () => {
    if (!projectId) {
      toast.error('Please select a project')
      return
    }
    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Amount must be greater than 0')
      return
    }
    if (!description || description.trim().length < 5) {
      toast.error('Description must be at least 5 characters')
      return
    }
    if (description.length > 200) {
      toast.error('Description must be at most 200 characters')
      return
    }

    // Check receipt requirement (> $25)
    if (parsedAmount > 25 && !existingExpense?.receiptUrl) {
      // For now, we'll just warn - full file upload would require storage implementation
      console.warn('Receipt required for expenses over $25')
    }

    setIsSubmitting(true)
    try {
      const parsedMarkup = parseFloat(markupRate)
      const markupMultiplier = billable && parsedMarkup > 0 ? 1 + parsedMarkup / 100 : undefined

      await onSave({
        projectId: projectId as Id<'projects'>,
        type: expenseType,
        amount: Math.round(parsedAmount * 100), // Convert to cents
        currency: 'USD',
        description: description.trim(),
        date: new Date(date).getTime(),
        billable,
        markupRate: markupMultiplier,
        vendorInfo:
          expenseType === 'Subcontractor' && vendorName
            ? { name: vendorName, taxId: vendorTaxId || undefined }
            : undefined,
      })
      onClose()
      toast.success('Expense saved')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save expense'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const isReadOnly =
    existingExpense &&
    (existingExpense.status === 'Submitted' ||
      existingExpense.status === 'Approved')

  const billedAmount = billable
    ? (parseFloat(amount) || 0) * (1 + (parseFloat(markupRate) || 0) / 100)
    : 0

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {existingExpense ? 'Edit Expense' : 'New Expense'}
          </DialogTitle>
          <DialogDescription>
            {isReadOnly && (
              <span className="text-amber-600">
                {existingExpense?.status} - read only
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-2">
            <Label htmlFor="project">Project *</Label>
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={isReadOnly}
            >
              <SelectTrigger id="project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((project) => (
                  <SelectItem key={project._id} value={project._id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="type">Expense Type *</Label>
            <Select
              value={expenseType}
              onValueChange={(v) => setExpenseType(v as ExpenseType)}
              disabled={isReadOnly}
            >
              <SelectTrigger id="type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description *</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this expense for?"
              maxLength={200}
              disabled={isReadOnly}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/200 characters
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (USD) *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-8"
                  disabled={isReadOnly}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                disabled={isReadOnly}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked as boolean)}
              disabled={isReadOnly}
            />
            <Label htmlFor="billable">Billable to client</Label>
          </div>

          {billable && (
            <div className="grid gap-2 pl-6">
              <Label htmlFor="markup">Markup Rate</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={markupRate}
                  onValueChange={setMarkupRate}
                  disabled={isReadOnly}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0% (pass-through)</SelectItem>
                    <SelectItem value="10">10%</SelectItem>
                    <SelectItem value="15">15%</SelectItem>
                    <SelectItem value="25">25%</SelectItem>
                  </SelectContent>
                </Select>
                {amount && parseFloat(amount) > 0 && (
                  <span className="text-sm text-muted-foreground">
                    Billed: {formatCurrency(billedAmount * 100)}
                  </span>
                )}
              </div>
            </div>
          )}

          {expenseType === 'Subcontractor' && (
            <div className="grid gap-4 border-t pt-4">
              <h4 className="text-sm font-medium">Vendor Information</h4>
              <div className="grid gap-2">
                <Label htmlFor="vendorName">Vendor Name *</Label>
                <Input
                  id="vendorName"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Company or individual name"
                  disabled={isReadOnly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="taxId">Tax ID (required for &gt; $600)</Label>
                <Input
                  id="taxId"
                  value={vendorTaxId}
                  onChange={(e) => setVendorTaxId(e.target.value)}
                  placeholder="XX-XXXXXXX"
                  disabled={isReadOnly}
                />
              </div>
            </div>
          )}

          {existingExpense?.status === 'Rejected' &&
            existingExpense.rejectionComments && (
              <div className="p-3 bg-destructive/10 rounded-md">
                <p className="text-sm font-medium text-destructive">
                  Rejection reason:
                </p>
                <p className="text-sm text-destructive mt-1">
                  {existingExpense.rejectionComments}
                </p>
              </div>
            )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!isReadOnly && (
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExpensesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<
    Doc<'expenses'> | undefined
  >()
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Get current user's expenses
  const expenses = useQuery(api.workflows.dealToDelivery.api.expenses.listExpenses, {})

  // Get projects for the dropdown
  const projectsData = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjects,
    {}
  )
  const projects = projectsData?.map((p) => ({ _id: p._id, name: p.name }))

  // Mutations
  const createExpense = useMutation(
    api.workflows.dealToDelivery.api.expenses.createExpense
  )
  const updateExpense = useMutation(
    api.workflows.dealToDelivery.api.expenses.updateExpense
  )
  const submitExpenseMutation = useMutation(
    api.workflows.dealToDelivery.api.expenses.submitExpense
  )

  // Handle save (create or update)
  const handleSaveExpense = async (expense: {
    projectId: Id<'projects'>
    type: ExpenseType
    amount: number
    currency: string
    description: string
    date: number
    billable: boolean
    markupRate?: number
    vendorInfo?: { name: string; taxId?: string }
  }) => {
    if (selectedExpense) {
      const { projectId: _projectId, ...updates } = expense
      await updateExpense({
        expenseId: selectedExpense._id,
        ...updates,
      })
    } else {
      await createExpense(expense)
    }
    setIsModalOpen(false)
    setSelectedExpense(undefined)
  }

  // Handle submit
  const handleSubmitExpense = async (expenseId: Id<'expenses'>) => {
    try {
      await submitExpenseMutation({ expenseId })
      toast.success('Expense submitted for approval')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to submit expense'
      )
    }
  }

  // Filter expenses
  const filteredExpenses =
    statusFilter === 'all'
      ? expenses
      : expenses?.filter((e) => e.status === statusFilter)

  // Calculate totals
  const totals = {
    all: expenses?.length ?? 0,
    draft: expenses?.filter((e) => e.status === 'Draft').length ?? 0,
    submitted: expenses?.filter((e) => e.status === 'Submitted').length ?? 0,
    approved: expenses?.filter((e) => e.status === 'Approved').length ?? 0,
    rejected: expenses?.filter((e) => e.status === 'Rejected').length ?? 0,
    totalAmount: expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0,
  }

  const isLoading = expenses === undefined

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Receipt className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Expenses
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Track and submit project expenses.
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              setSelectedExpense(undefined)
              setIsModalOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Expense
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total</div>
              <div className="text-2xl font-bold">{totals.all}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Draft</div>
              <div className="text-2xl font-bold">{totals.draft}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Submitted</div>
              <div className="text-2xl font-bold">{totals.submitted}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Approved</div>
              <div className="text-2xl font-bold">{totals.approved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Amount</div>
              <div className="text-2xl font-bold">
                {formatCurrency(totals.totalAmount)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'Draft', 'Submitted', 'Approved', 'Rejected'].map(
            (status) => (
              <Button
                key={status}
                variant={statusFilter === status ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(status)}
              >
                {status === 'all' ? 'All' : status}
                <Badge variant="secondary" className="ml-2">
                  {status === 'all'
                    ? totals.all
                    : expenses?.filter((e) => e.status === status).length ?? 0}
                </Badge>
              </Button>
            )
          )}
        </div>

        {/* Expenses List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading expenses...
          </div>
        ) : !filteredExpenses || filteredExpenses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Receipt className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No expenses yet</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                Create your first expense to get started.
              </p>
              <Button
                onClick={() => {
                  setSelectedExpense(undefined)
                  setIsModalOpen(true)
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Expense
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredExpenses.map((expense) => {
              const project = projectsData?.find(
                (p) => p._id === expense.projectId
              )
              return (
                <Card
                  key={expense._id}
                  className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30"
                  onClick={() => {
                    setSelectedExpense(expense)
                    setIsModalOpen(true)
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        {/* Type Badge */}
                        <div
                          className={cn(
                            'px-2 py-1 rounded text-xs font-medium',
                            getExpenseTypeColor(expense.type as ExpenseType)
                          )}
                        >
                          {expense.type}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">
                            {expense.description}
                          </h4>
                          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                            {project && (
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5" />
                                {project.name}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(expense.date)}
                            </span>
                            {expense.billable && (
                              <span className="flex items-center gap-1 text-green-600">
                                <FileText className="h-3.5 w-3.5" />
                                Billable
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Amount & Status */}
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatCurrency(expense.amount)}
                          </div>
                          {expense.billable &&
                            expense.markupRate &&
                            expense.markupRate > 1 && (
                              <div className="text-xs text-muted-foreground">
                                Billed:{' '}
                                {formatCurrency(
                                  expense.amount * expense.markupRate
                                )}
                              </div>
                            )}
                        </div>
                        <Badge variant={getStatusBadgeVariant(expense.status)}>
                          {expense.status}
                        </Badge>
                        {expense.status === 'Draft' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSubmitExpense(expense._id)
                            }}
                          >
                            Submit
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Expense Modal */}
        <ExpenseModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false)
            setSelectedExpense(undefined)
          }}
          projects={projects}
          existingExpense={selectedExpense}
          onSave={handleSaveExpense}
        />
      </div>
    </div>
  )
}
