import { useState, useCallback } from 'react'
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
import { Textarea } from '@repo/ui/components/textarea'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select'
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Plus,
  Timer,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/timesheet/')({
  component: TimesheetPage,
})

// Get Monday of the week containing the given date
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Sunday
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Get all days of the week starting from the given Monday
function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart)
    day.setDate(weekStart.getDate() + i)
    days.push(day)
  }
  return days
}

// Format date as "Mon", "Tue", etc.
function formatDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// Format date as "Jan 6"
function formatDayDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format date range as "Jan 6-12, 2025"
function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' })
  const startDay = weekStart.getDate()
  const endDay = weekEnd.getDate()
  const year = weekEnd.getFullYear()

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${year}`
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`
}

// Format hours as "4.5" or "0"
function formatHours(hours: number): string {
  return hours > 0 ? hours.toFixed(hours % 1 === 0 ? 0 : 1) : ''
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

// Round hours to nearest 0.25
function roundHours(hours: number): number {
  return Math.round(hours * 4) / 4
}

// Group entries by project/service
type GroupedEntry = {
  projectId: Id<'projects'>
  projectName: string
  serviceId?: Id<'services'>
  serviceName?: string
  entriesByDate: Record<number, Doc<'timeEntries'>>
  rowTotal: number
}

function groupEntriesByProjectService(
  entries: Doc<'timeEntries'>[],
  projects: Array<{ _id: Id<'projects'>; name: string }> | undefined
): GroupedEntry[] {
  const groups: Record<string, GroupedEntry> = {}

  for (const entry of entries) {
    const key = entry.serviceId
      ? `${entry.projectId}_${entry.serviceId}`
      : entry.projectId

    if (!groups[key]) {
      const project = projects?.find((p) => p._id === entry.projectId)
      groups[key] = {
        projectId: entry.projectId,
        projectName: project?.name ?? 'Unknown Project',
        serviceId: entry.serviceId,
        serviceName: entry.serviceId ? 'Service' : undefined,
        entriesByDate: {},
        rowTotal: 0,
      }
    }

    // Normalize to start of day for date key
    const dateKey = new Date(entry.date).setHours(0, 0, 0, 0)
    groups[key].entriesByDate[dateKey] = entry
    groups[key].rowTotal += entry.hours
  }

  return Object.values(groups)
}

// Time Entry Modal
function TimeEntryModal({
  isOpen,
  onClose,
  date,
  projects,
  existingEntry,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  date: Date
  projects: Array<{ _id: Id<'projects'>; name: string }> | undefined
  existingEntry?: Doc<'timeEntries'>
  onSave: (entry: {
    projectId: Id<'projects'>
    date: number
    hours: number
    billable: boolean
    notes?: string
  }) => Promise<void>
}) {
  const [projectId, setProjectId] = useState<string>(
    existingEntry?.projectId ?? ''
  )
  const [hours, setHours] = useState<string>(
    existingEntry?.hours?.toString() ?? ''
  )
  const [billable, setBillable] = useState<boolean>(
    existingEntry?.billable ?? true
  )
  const [notes, setNotes] = useState<string>(existingEntry?.notes ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSave = async () => {
    if (!projectId) {
      toast.error('Please select a project')
      return
    }
    const parsedHours = parseFloat(hours)
    if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      toast.error('Hours must be between 0.25 and 24')
      return
    }

    setIsSubmitting(true)
    try {
      await onSave({
        projectId: projectId as Id<'projects'>,
        date: date.getTime(),
        hours: roundHours(parsedHours),
        billable,
        notes: notes || undefined,
      })
      onClose()
      toast.success('Time entry saved')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save time entry'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const isReadOnly =
    existingEntry &&
    (existingEntry.status === 'Submitted' ||
      existingEntry.status === 'Approved' ||
      existingEntry.status === 'Locked')

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {existingEntry ? 'Edit Time Entry' : 'Add Time Entry'}
          </DialogTitle>
          <DialogDescription>
            {formatDayName(date)}, {formatDayDate(date)}
            {isReadOnly && (
              <span className="text-amber-600 ml-2">
                ({existingEntry?.status} - read only)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
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
            <Label htmlFor="hours">Hours *</Label>
            <div className="flex gap-2">
              <Input
                id="hours"
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0.00"
                disabled={isReadOnly}
              />
              <div className="flex gap-1">
                {[1, 2, 4, 8].map((h) => (
                  <Button
                    key={h}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHours(h.toString())}
                    disabled={isReadOnly}
                  >
                    {h}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="billable"
              checked={billable}
              onCheckedChange={(checked) => setBillable(checked as boolean)}
              disabled={isReadOnly}
            />
            <Label htmlFor="billable">Billable</Label>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you work on?"
              maxLength={500}
              disabled={isReadOnly}
            />
          </div>

          {existingEntry?.status === 'Rejected' &&
            existingEntry.rejectionComments && (
              <div className="p-3 bg-destructive/10 rounded-md">
                <p className="text-sm font-medium text-destructive">
                  Rejection reason:
                </p>
                <p className="text-sm text-destructive mt-1">
                  {existingEntry.rejectionComments}
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
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TimesheetPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<
    Doc<'timeEntries'> | undefined
  >()

  // Get current user
  const currentUser = useQuery(
    api.workflows.dealToDelivery.api.organizations.getCurrentUser
  )

  // Get projects for the dropdown
  const projectsData = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjects,
    {}
  )
  const projects = projectsData?.map((p) => ({ _id: p._id, name: p.name }))

  // Get timesheet for the current week
  const timesheet = useQuery(
    api.workflows.dealToDelivery.api.time.getTimesheet,
    currentUser
      ? { userId: currentUser._id, weekStartDate: weekStart.getTime() }
      : 'skip'
  )

  // Mutations
  const createTimeEntry = useMutation(
    api.workflows.dealToDelivery.api.time.createTimeEntry
  )
  const updateTimeEntry = useMutation(
    api.workflows.dealToDelivery.api.time.updateTimeEntryMutation
  )
  const submitTimeEntryMutation = useMutation(
    api.workflows.dealToDelivery.api.time.submitTimeEntry
  )

  const weekDays = getWeekDays(weekStart)

  // Group entries by project/service
  const groupedEntries = timesheet
    ? groupEntriesByProjectService(timesheet.entries, projects)
    : []

  // Calculate daily totals
  const dailyTotals = weekDays.map((day) => {
    const dateKey = day.getTime()
    return timesheet?.dailyTotals?.[dateKey]?.total ?? 0
  })

  // Navigate weeks
  const goToPreviousWeek = useCallback(() => {
    setWeekStart((prev) => {
      const newStart = new Date(prev)
      newStart.setDate(newStart.getDate() - 7)
      return newStart
    })
  }, [])

  const goToNextWeek = useCallback(() => {
    setWeekStart((prev) => {
      const newStart = new Date(prev)
      newStart.setDate(newStart.getDate() + 7)
      return newStart
    })
  }, [])

  const goToCurrentWeek = useCallback(() => {
    setWeekStart(getWeekStart(new Date()))
  }, [])

  // Open modal for new entry
  const handleCellClick = (
    date: Date,
    entry: Doc<'timeEntries'> | undefined
  ) => {
    setSelectedDate(date)
    setSelectedEntry(entry)
    setIsModalOpen(true)
  }

  // Handle save
  const handleSaveEntry = async (entry: {
    projectId: Id<'projects'>
    date: number
    hours: number
    billable: boolean
    notes?: string
  }) => {
    if (selectedEntry) {
      // Update existing entry
      await updateTimeEntry({
        timeEntryId: selectedEntry._id,
        hours: entry.hours,
        billable: entry.billable,
        notes: entry.notes,
      })
    } else {
      // Create new entry
      await createTimeEntry(entry)
    }
    setIsModalOpen(false)
    setSelectedEntry(undefined)
  }

  // Submit all draft entries for the week
  const handleSubmitWeek = async () => {
    if (!timesheet) return

    const draftEntries = timesheet.entries.filter((e) => e.status === 'Draft')
    if (draftEntries.length === 0) {
      toast.info('No draft entries to submit')
      return
    }

    try {
      for (const entry of draftEntries) {
        await submitTimeEntryMutation({ timeEntryId: entry._id })
      }
      toast.success(`Submitted ${draftEntries.length} entries for approval`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to submit entries'
      )
    }
  }

  // Count entries by status
  const statusCounts = {
    Draft: timesheet?.entries.filter((e) => e.status === 'Draft').length ?? 0,
    Submitted:
      timesheet?.entries.filter((e) => e.status === 'Submitted').length ?? 0,
    Approved:
      timesheet?.entries.filter((e) => e.status === 'Approved').length ?? 0,
    Rejected:
      timesheet?.entries.filter((e) => e.status === 'Rejected').length ?? 0,
  }

  const isLoading = currentUser === undefined || timesheet === undefined

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Clock className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Timesheet
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Track your time by project and service.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={goToCurrentWeek}>
              Today
            </Button>
            <Button variant="outline" size="icon" disabled>
              <Timer className="h-4 w-4" />
            </Button>
            <Button onClick={() => handleCellClick(new Date(), undefined)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Button>
          </div>
        </div>

        {/* Week Navigator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-lg font-medium min-w-[200px] text-center">
              {formatWeekRange(weekStart)}
            </span>
            <Button variant="outline" size="icon" onClick={goToNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {timesheet?.weeklyTotals.total?.toFixed(1) ?? '0'}
              </span>
              {' / 40 hrs'}
            </div>
            <div className="text-sm text-muted-foreground">
              Billable:{' '}
              <span className="font-medium text-foreground">
                {timesheet?.weeklyTotals.billable?.toFixed(1) ?? '0'} hrs
              </span>
              {timesheet && timesheet.weeklyTotals.total > 0 && (
                <span className="ml-1">
                  (
                  {Math.round(
                    (timesheet.weeklyTotals.billable /
                      timesheet.weeklyTotals.total) *
                      100
                  )}
                  %)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Timesheet Grid */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Loading timesheet...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-3 min-w-[200px] font-medium text-muted-foreground">
                        Project / Service
                      </th>
                      {weekDays.map((day) => (
                        <th
                          key={day.getTime()}
                          className={cn(
                            'text-center p-3 min-w-[80px] font-medium',
                            day.toDateString() === new Date().toDateString()
                              ? 'bg-primary/5'
                              : ''
                          )}
                        >
                          <div className="text-xs text-muted-foreground">
                            {formatDayName(day)}
                          </div>
                          <div className="text-sm">{day.getDate()}</div>
                        </th>
                      ))}
                      <th className="text-center p-3 min-w-[60px] font-medium text-muted-foreground">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedEntries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="text-center py-12 text-muted-foreground"
                        >
                          No time entries this week. Click a cell or use the Add
                          Entry button to log time.
                        </td>
                      </tr>
                    ) : (
                      groupedEntries.map((group) => (
                        <tr
                          key={`${group.projectId}_${group.serviceId ?? ''}`}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3">
                            <div className="font-medium">{group.projectName}</div>
                            {group.serviceName && (
                              <div className="text-sm text-muted-foreground">
                                {group.serviceName}
                              </div>
                            )}
                          </td>
                          {weekDays.map((day) => {
                            const dateKey = day.getTime()
                            const entry = group.entriesByDate[dateKey]
                            const isToday =
                              day.toDateString() === new Date().toDateString()

                            return (
                              <td
                                key={dateKey}
                                className={cn(
                                  'text-center p-1 cursor-pointer hover:bg-muted transition-colors',
                                  isToday ? 'bg-primary/5' : ''
                                )}
                                onClick={() => handleCellClick(day, entry)}
                              >
                                {entry ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="font-medium">
                                      {formatHours(entry.hours)}
                                    </span>
                                    <span
                                      className={cn(
                                        'text-xs',
                                        entry.billable
                                          ? 'text-green-600'
                                          : 'text-muted-foreground'
                                      )}
                                    >
                                      {entry.billable ? '●' : '○'}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/50 opacity-0 group-hover:opacity-100">
                                    +
                                  </span>
                                )}
                              </td>
                            )
                          })}
                          <td className="text-center p-3 font-medium">
                            {formatHours(group.rowTotal)}
                          </td>
                        </tr>
                      ))
                    )}
                    {/* Daily totals row */}
                    <tr className="bg-muted/30 font-medium">
                      <td className="p-3">Daily Total</td>
                      {dailyTotals.map((total, i) => (
                        <td
                          key={weekDays[i].getTime()}
                          className={cn(
                            'text-center p-3',
                            weekDays[i].toDateString() ===
                              new Date().toDateString()
                              ? 'bg-primary/10'
                              : ''
                          )}
                        >
                          {formatHours(total)}
                        </td>
                      ))}
                      <td className="text-center p-3">
                        {formatHours(timesheet?.weeklyTotals.total ?? 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Bar & Submit */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {Object.entries(statusCounts).map(([status, count]) =>
              count > 0 ? (
                <Badge
                  key={status}
                  variant={getStatusBadgeVariant(status)}
                  className="gap-1"
                >
                  {status}: {count}
                </Badge>
              ) : null
            )}
          </div>
          {statusCounts.Draft > 0 && (
            <Button onClick={handleSubmitWeek}>
              Submit Week ({statusCounts.Draft} entries)
            </Button>
          )}
        </div>

        {/* Entry Modal */}
        {selectedDate && (
          <TimeEntryModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false)
              setSelectedEntry(undefined)
            }}
            date={selectedDate}
            projects={projects}
            existingEntry={selectedEntry}
            onSave={handleSaveEntry}
          />
        )}
      </div>
    </div>
  )
}
