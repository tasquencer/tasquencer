import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id, Doc } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui/components/dialog'
import { Textarea } from '@repo/ui/components/textarea'
import { Label } from '@repo/ui/components/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@repo/ui/components/collapsible'
import {
  ClipboardCheck,
  ChevronDown,
  Clock,
  DollarSign,
  Loader2,
  Check,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/approvals/timesheets')({
  component: TimesheetApprovalPage,
})

type ApprovalStatus = 'Submitted' | 'Approved' | 'Rejected'

// Format week range as "Jan 6-12, 2025"
function formatWeekRange(weekStart: number): string {
  const start = new Date(weekStart)
  const end = new Date(weekStart + 6 * 24 * 60 * 60 * 1000)

  const startMonth = start.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' })
  const startDay = start.getDate()
  const endDay = end.getDate()
  const year = end.getFullYear()

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${year}`
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`
}

// Format date as "Jan 10, 2025"
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Format hours
function formatHours(hours: number): string {
  return hours.toFixed(hours % 1 === 0 ? 0 : 1)
}

// Get day of week abbreviation
function getDayName(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', { weekday: 'short' })
}

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// Rejection Modal
function RejectionModal({
  isOpen,
  onClose,
  timesheet,
  onReject,
}: {
  isOpen: boolean
  onClose: () => void
  timesheet: {
    user: { name: string } | null
    weekStart: number
    totalHours: number
    entries: Array<{ _id: Id<'timeEntries'> }>
  } | null
  onReject: (comments: string) => Promise<void>
}) {
  const [comments, setComments] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleReject = async () => {
    if (!comments.trim()) {
      toast.error('Please provide a reason for rejection')
      return
    }

    setIsSubmitting(true)
    try {
      await onReject(comments)
      setComments('')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reject timesheet'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Reject Timesheet</DialogTitle>
          <DialogDescription>
            {timesheet?.user?.name && (
              <>
                Rejecting timesheet for: <strong>{timesheet.user.name}</strong>
                <br />
                Week of {formatWeekRange(timesheet.weekStart)} (
                {formatHours(timesheet.totalHours)} hours)
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Label htmlFor="rejection-comments">Reason for Rejection *</Label>
          <Textarea
            id="rejection-comments"
            className="mt-2"
            rows={4}
            placeholder="Please explain why this timesheet is being rejected..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting || !comments.trim()}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send Rejection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Bulk Rejection Modal
function BulkRejectionModal({
  isOpen,
  onClose,
  selectedCount,
  totalHours,
  onReject,
}: {
  isOpen: boolean
  onClose: () => void
  selectedCount: number
  totalHours: number
  onReject: (comments: string) => Promise<void>
}) {
  const [comments, setComments] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleReject = async () => {
    if (!comments.trim()) {
      toast.error('Please provide a reason for rejection')
      return
    }

    setIsSubmitting(true)
    try {
      await onReject(comments)
      setComments('')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reject timesheets'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Reject Selected Timesheets</DialogTitle>
          <DialogDescription>
            Rejecting <strong>{selectedCount}</strong> timesheet{selectedCount !== 1 ? 's' : ''} (
            {formatHours(totalHours)} hours total)
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Label htmlFor="bulk-rejection-comments">Reason for Rejection *</Label>
          <Textarea
            id="bulk-rejection-comments"
            className="mt-2"
            rows={4}
            placeholder="Please explain why these timesheets are being rejected..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-2">
            This reason will be sent to all affected team members.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting || !comments.trim()}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reject {selectedCount} Timesheet{selectedCount !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Timesheet Card Component
function TimesheetCard({
  timesheet,
  isSelected,
  onSelect,
  onApprove,
  onReject,
}: {
  timesheet: {
    id: string
    user: { _id: Id<'users'>; name: string } | null
    weekStart: number
    weekEnd: number
    submittedAt: number
    totalHours: number
    billableHours: number
    entries: Array<
      Doc<'timeEntries'> & { project: { _id: Id<'projects'>; name: string } | null }
    >
    projectSummary: Array<{
      projectId: Id<'projects'>
      projectName: string
      hours: number
    }>
  }
  isSelected: boolean
  onSelect: (selected: boolean) => void
  onApprove: () => void
  onReject: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Group entries by project and day
  const entriesByProjectDay = new Map<
    string,
    Map<string, { hours: number; billable: boolean; notes?: string }>
  >()

  for (const entry of timesheet.entries) {
    const projectKey = entry.project?.name ?? 'Unknown'
    if (!entriesByProjectDay.has(projectKey)) {
      entriesByProjectDay.set(projectKey, new Map())
    }
    const day = getDayName(entry.date)
    const existing = entriesByProjectDay.get(projectKey)!.get(day)
    if (existing) {
      existing.hours += entry.hours
    } else {
      entriesByProjectDay.get(projectKey)!.set(day, {
        hours: entry.hours,
        billable: entry.billable,
        notes: entry.notes,
      })
    }
  }

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

  return (
    <Card className={cn('transition-all', isSelected && 'ring-2 ring-primary')}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Selection Checkbox */}
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            className="mt-1"
          />

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Header Row */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                    {timesheet.user?.name ? getInitials(timesheet.user.name) : '?'}
                  </div>
                  <div>
                    <h4 className="font-medium">
                      {timesheet.user?.name ?? 'Unknown User'}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Week of {formatWeekRange(timesheet.weekStart)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                Submitted {formatDate(timesheet.submittedAt)}
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-6 mt-3 text-sm">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>
                  Total: <strong>{formatHours(timesheet.totalHours)} hrs</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span>
                  Billable:{' '}
                  <strong>{formatHours(timesheet.billableHours)} hrs</strong>
                </span>
              </div>
            </div>

            {/* Project Summary */}
            <div className="flex flex-wrap gap-2 mt-2">
              {timesheet.projectSummary.map((ps) => (
                <Badge key={ps.projectId} variant="secondary">
                  {ps.projectName} ({formatHours(ps.hours)}h)
                </Badge>
              ))}
            </div>

            {/* Expandable Details */}
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2 text-muted-foreground"
                >
                  {isExpanded ? 'Hide Details' : 'View Details'}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 ml-1 transition-transform',
                      isExpanded && 'rotate-180'
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Project</th>
                        {weekDays.map((day) => (
                          <th key={day} className="text-center p-2 font-medium w-16">
                            {day}
                          </th>
                        ))}
                        <th className="text-center p-2 font-medium w-20">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(entriesByProjectDay.entries()).map(
                        ([projectName, dayMap]) => {
                          const rowTotal = Array.from(dayMap.values()).reduce(
                            (sum, d) => sum + d.hours,
                            0
                          )
                          return (
                            <tr key={projectName} className="border-t">
                              <td className="p-2">{projectName}</td>
                              {weekDays.map((day) => {
                                const entry = dayMap.get(day)
                                return (
                                  <td
                                    key={day}
                                    className="text-center p-2"
                                    title={entry?.notes}
                                  >
                                    {entry ? formatHours(entry.hours) : '-'}
                                  </td>
                                )
                              })}
                              <td className="text-center p-2 font-medium">
                                {formatHours(rowTotal)}
                              </td>
                            </tr>
                          )
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={onReject}>
                <X className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button size="sm" onClick={onApprove}>
                <Check className="h-4 w-4 mr-1" />
                Approve
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TimesheetApprovalPage() {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus>('Submitted')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [rejectionTarget, setRejectionTarget] = useState<{
    user: { name: string } | null
    weekStart: number
    totalHours: number
    entries: Array<{ _id: Id<'timeEntries'> }>
  } | null>(null)
  const [bulkRejectionEntries, setBulkRejectionEntries] = useState<Array<{ _id: Id<'timeEntries'> }> | null>(null)

  // Fetch timesheets for approval
  const data = useQuery(
    api.workflows.dealToDelivery.api.time.getTimesheetsForApproval,
    { status: statusFilter }
  )

  // Mutations
  const approveEntries = useMutation(
    api.workflows.dealToDelivery.api.time.approveTimeEntries
  )
  const rejectEntries = useMutation(
    api.workflows.dealToDelivery.api.time.rejectTimeEntries
  )

  const isLoading = data === undefined

  // Toggle selection
  const toggleSelection = (id: string, selected: boolean) => {
    const newSelected = new Set(selectedIds)
    if (selected) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedIds(newSelected)
  }

  // Select all
  const selectAll = () => {
    setSelectedIds(new Set(data?.timesheets.map((ts) => ts.id) ?? []))
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  // Approve a single timesheet
  const handleApprove = async (
    timesheet: NonNullable<typeof data>['timesheets'][0]
  ) => {
    try {
      const entryIds = timesheet.entries.map((e) => e._id)
      await approveEntries({ timeEntryIds: entryIds })
      toast.success(`Timesheet approved for ${timesheet.user?.name ?? 'user'}`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to approve timesheet'
      )
    }
  }

  // Reject a single timesheet
  const handleReject = async (comments: string) => {
    if (!rejectionTarget) return

    try {
      const entryIds = rejectionTarget.entries.map((e) => e._id)
      await rejectEntries({ timeEntryIds: entryIds, comments })
      toast.success('Timesheet rejected - user notified')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reject timesheet'
      )
    }
  }

  // Bulk approve selected
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0 || !data) return

    try {
      const selectedTimesheets = data.timesheets.filter((ts) =>
        selectedIds.has(ts.id)
      )
      const allEntryIds = selectedTimesheets.flatMap((ts) =>
        ts.entries.map((e) => e._id)
      )
      await approveEntries({ timeEntryIds: allEntryIds })
      toast.success(`Approved ${selectedIds.size} timesheets`)
      setSelectedIds(new Set())
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to approve timesheets'
      )
    }
  }

  // Bulk reject selected
  const handleBulkReject = () => {
    if (selectedIds.size === 0 || !data) return

    const selectedTimesheets = data.timesheets.filter((ts) =>
      selectedIds.has(ts.id)
    )
    const allEntries = selectedTimesheets.flatMap((ts) =>
      ts.entries.map((e) => ({ _id: e._id }))
    )
    setBulkRejectionEntries(allEntries)
  }

  // Handle bulk rejection submit
  const handleBulkRejectSubmit = async (comments: string) => {
    if (!bulkRejectionEntries || bulkRejectionEntries.length === 0) return

    try {
      const entryIds = bulkRejectionEntries.map((e) => e._id)
      await rejectEntries({ timeEntryIds: entryIds, comments })
      toast.success(`Rejected ${selectedIds.size} timesheets`)
      setSelectedIds(new Set())
      setBulkRejectionEntries(null)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to reject timesheets'
      )
    }
  }

  // Calculate selected stats
  const selectedHours =
    data?.timesheets
      .filter((ts) => selectedIds.has(ts.id))
      .reduce((sum, ts) => sum + ts.totalHours, 0) ?? 0

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <ClipboardCheck className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Timesheet Approvals
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Review and approve team timesheets.
              </p>
            </div>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {(['Submitted', 'Approved', 'Rejected'] as ApprovalStatus[]).map(
              (status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setStatusFilter(status)
                    setSelectedIds(new Set())
                  }}
                >
                  {status === 'Submitted' ? 'Pending' : status}
                  {status === 'Submitted' && data?.summary.pendingCount
                    ? ` (${data.summary.pendingCount})`
                    : ''}
                </Button>
              )
            )}
          </div>
          {data?.timesheets && data.timesheets.length > 0 && (
            <div className="flex gap-2">
              {selectedIds.size > 0 ? (
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  Clear ({selectedIds.size})
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Timesheets List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading timesheets...
          </div>
        ) : !data?.timesheets || data.timesheets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">
                {statusFilter === 'Submitted'
                  ? 'No timesheets pending approval'
                  : `No ${statusFilter.toLowerCase()} timesheets`}
              </h3>
              <p className="text-muted-foreground mt-1">
                {statusFilter === 'Submitted'
                  ? 'All caught up!'
                  : 'Timesheets will appear here when they match this filter.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.timesheets.map((timesheet) => (
              <TimesheetCard
                key={timesheet.id}
                timesheet={timesheet}
                isSelected={selectedIds.has(timesheet.id)}
                onSelect={(selected) => toggleSelection(timesheet.id, selected)}
                onApprove={() => handleApprove(timesheet)}
                onReject={() =>
                  setRejectionTarget({
                    user: timesheet.user,
                    weekStart: timesheet.weekStart,
                    totalHours: timesheet.totalHours,
                    entries: timesheet.entries,
                  })
                }
              />
            ))}
          </div>
        )}

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && statusFilter === 'Submitted' && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg p-4 flex items-center gap-4">
            <span className="text-sm">
              Selected: <strong>{selectedIds.size}</strong> timesheets (
              {formatHours(selectedHours)} hrs)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearSelection}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={handleBulkReject}>
                <X className="h-4 w-4 mr-1" />
                Reject Selected
              </Button>
              <Button size="sm" onClick={handleBulkApprove}>
                <Check className="h-4 w-4 mr-1" />
                Approve All
              </Button>
            </div>
          </div>
        )}

        {/* Single Timesheet Rejection Modal */}
        <RejectionModal
          isOpen={!!rejectionTarget}
          onClose={() => setRejectionTarget(null)}
          timesheet={rejectionTarget}
          onReject={handleReject}
        />

        {/* Bulk Rejection Modal */}
        <BulkRejectionModal
          isOpen={!!bulkRejectionEntries}
          onClose={() => setBulkRejectionEntries(null)}
          selectedCount={selectedIds.size}
          totalHours={selectedHours}
          onReject={handleBulkRejectSubmit}
        />
      </div>
    </div>
  )
}
