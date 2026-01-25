import { useEffect, useState, useCallback, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip'
import {
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@repo/ui/lib/utils'

export const Route = createFileRoute('/_app/resources/')({
  component: ResourceSchedulerPage,
})

// Get Monday of the week containing the given date
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Get all days of a 4-week period starting from the given Monday
function get4WeekDays(weekStart: Date): Date[] {
  const days: Date[] = []
  for (let i = 0; i < 28; i++) {
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

// Format date range as "Jan 6 - Feb 2, 2025"
function formatDateRange(startDate: Date, endDate: Date): string {
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' })
  const startDay = startDate.getDate()
  const endDay = endDate.getDate()
  const year = endDate.getFullYear()

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${year}`
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`
}

// Get color class for booking type
function getBookingColor(type: string): string {
  switch (type) {
    case 'Confirmed':
      return 'bg-primary'
    case 'Tentative':
      return 'bg-primary/50 bg-stripes'
    case 'TimeOff':
      return 'bg-muted-foreground/30'
    default:
      return 'bg-muted'
  }
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

type BookingWithProject = {
  _id: Id<'bookings'>
  projectId?: Id<'projects'>
  projectName?: string
  type: 'Tentative' | 'Confirmed' | 'TimeOff'
  startDate: number
  endDate: number
  hoursPerDay: number
}

type TeamMember = {
  user: {
    _id: Id<'users'>
    name: string
    email: string
    role: string
    skills: string[]
    department: string
    billRate?: number
    costRate?: number
  }
  availability: {
    totalAvailableHours: number
    bookedHours: number
    remainingHours: number
    utilization: number
    isOverallocated: boolean
  }
  bookings: BookingWithProject[]
}

// Create Booking Modal
function CreateBookingModal({
  isOpen,
  onClose,
  selectedPerson,
  selectedDate,
  teamMembers,
  onSelectPerson,
  projects,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  selectedPerson: TeamMember | null
  selectedDate: Date | null
  teamMembers: TeamMember[]
  onSelectPerson: (member: TeamMember | null) => void
  projects: Array<{ _id: Id<'projects'>; name: string }> | undefined
  onSave: (booking: {
    userId: Id<'users'>
    projectId?: Id<'projects'>
    startDate: number
    endDate: number
    hoursPerDay: number
    type: 'Tentative' | 'Confirmed' | 'TimeOff'
    notes?: string
  }) => Promise<void>
}) {
  const [projectId, setProjectId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [hoursPerDay, setHoursPerDay] = useState<string>('8')
  const [bookingType, setBookingType] = useState<
    'Tentative' | 'Confirmed' | 'TimeOff'
  >('Confirmed')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when modal opens
  const resetForm = useCallback(() => {
    setProjectId('')
    if (selectedDate) {
      const dateStr = selectedDate.toISOString().split('T')[0]
      setStartDate(dateStr)
      // Default end date is 2 weeks from start
      const end = new Date(selectedDate)
      end.setDate(end.getDate() + 13)
      setEndDate(end.toISOString().split('T')[0])
    } else {
      setStartDate('')
      setEndDate('')
    }
    setHoursPerDay('8')
    setBookingType('Confirmed')
    setSelectedUserId(selectedPerson?.user._id ?? '')
    setNotes('')
  }, [selectedDate, selectedPerson?.user._id])

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      resetForm()
    }
  }, [isOpen, resetForm])

  const handleSave = async () => {
    if (!selectedPerson) {
      toast.error('Please select a person')
      return
    }
    if (bookingType !== 'TimeOff' && !projectId) {
      toast.error('Please select a project')
      return
    }
    if (!startDate || !endDate) {
      toast.error('Please select date range')
      return
    }
    const parsedHours = parseFloat(hoursPerDay)
    if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      toast.error('Hours per day must be between 0.5 and 24')
      return
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) {
      toast.error('End date must be after start date')
      return
    }

    setIsSubmitting(true)
    try {
      await onSave({
        userId: selectedPerson.user._id,
        projectId: bookingType !== 'TimeOff' ? (projectId as Id<'projects'>) : undefined,
        startDate: start.getTime(),
        endDate: end.getTime(),
        hoursPerDay: parsedHours,
        type: bookingType,
        notes: notes || undefined,
      })
      onClose()
      toast.success('Booking created')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create booking'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Booking</DialogTitle>
          <DialogDescription>
            {selectedPerson
              ? `Booking for ${selectedPerson.user.name} (${selectedPerson.user.role})`
              : 'Select a team member to create a booking'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {!selectedPerson && (
            <div className="grid gap-2">
              <Label htmlFor="teamMember">Team Member *</Label>
              <Select
                value={selectedUserId}
                onValueChange={(value) => {
                  setSelectedUserId(value)
                  const member =
                    teamMembers.find((m) => m.user._id === value) ?? null
                  onSelectPerson(member)
                }}
              >
                <SelectTrigger id="teamMember">
                  <SelectValue placeholder="Select a team member" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.user._id} value={member.user._id}>
                      {member.user.name} ({member.user.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="bookingType">Booking Type *</Label>
            <Select
              value={bookingType}
              onValueChange={(v) =>
                setBookingType(v as 'Tentative' | 'Confirmed' | 'TimeOff')
              }
            >
              <SelectTrigger id="bookingType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Confirmed">
                  Confirmed (active projects)
                </SelectItem>
                <SelectItem value="Tentative">
                  Tentative (pipeline deals)
                </SelectItem>
                <SelectItem value="TimeOff">Time Off</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {bookingType !== 'TimeOff' && (
            <div className="grid gap-2">
              <Label htmlFor="project">Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
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
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endDate">End Date *</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hoursPerDay">Hours per Day *</Label>
            <div className="flex gap-2">
              <Input
                id="hoursPerDay"
                type="number"
                min="0.5"
                max="24"
                step="0.5"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
                placeholder="8"
              />
              <div className="flex gap-1">
                {[2, 4, 6, 8].map((h) => (
                  <Button
                    key={h}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHoursPerDay(h.toString())}
                  >
                    {h}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Available: 8 hrs/day | This booking: {hoursPerDay || '0'} hrs/day
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this booking..."
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !selectedPerson}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResourceSchedulerPage() {
  const [viewStart, setViewStart] = useState(() => getWeekStart(new Date()))
  const [selectedPerson, setSelectedPerson] = useState<TeamMember | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Filter state
  const [skillFilter, setSkillFilter] = useState<string>('all')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const viewEnd = useMemo(() => {
    const end = new Date(viewStart)
    end.setDate(end.getDate() + 27)
    return end
  }, [viewStart])

  const days = useMemo(() => get4WeekDays(viewStart), [viewStart])

  // Get team availability data
  const teamData = useQuery(
    api.workflows.dealToDelivery.api.resources.getTeamAvailability,
    {
      startDate: viewStart.getTime(),
      endDate: viewEnd.getTime(),
      skills: skillFilter === 'all' ? undefined : [skillFilter],
      roles: roleFilter === 'all' ? undefined : [roleFilter],
      departments: deptFilter === 'all' ? undefined : [deptFilter],
    }
  )

  // Get projects for dropdown
  const projectsData = useQuery(
    api.workflows.dealToDelivery.api.projects.listProjects,
    {}
  )
  const projects = projectsData?.map((p) => ({ _id: p._id, name: p.name }))

  // Create booking mutation
  const createBooking = useMutation(
    api.workflows.dealToDelivery.api.resources.createBooking
  )

  // Collect unique values for filters
  const filterOptions = useMemo(() => {
    if (!teamData) return { skills: [], roles: [], departments: [] }

    const skills = new Set<string>()
    const roles = new Set<string>()
    const departments = new Set<string>()

    teamData.forEach((member) => {
      member.user.skills.forEach((s) => skills.add(s))
      if (member.user.role) roles.add(member.user.role)
      if (member.user.department) departments.add(member.user.department)
    })

    return {
      skills: Array.from(skills).sort(),
      roles: Array.from(roles).sort(),
      departments: Array.from(departments).sort(),
    }
  }, [teamData])

  // Navigation
  const goToPreviousMonth = useCallback(() => {
    setViewStart((prev) => {
      const newStart = new Date(prev)
      newStart.setDate(newStart.getDate() - 28)
      return newStart
    })
  }, [])

  const goToNextMonth = useCallback(() => {
    setViewStart((prev) => {
      const newStart = new Date(prev)
      newStart.setDate(newStart.getDate() + 28)
      return newStart
    })
  }, [])

  const goToToday = useCallback(() => {
    setViewStart(getWeekStart(new Date()))
  }, [])

  // Handle creating booking
  const handleCreateBooking = async (booking: {
    userId: Id<'users'>
    projectId?: Id<'projects'>
    startDate: number
    endDate: number
    hoursPerDay: number
    type: 'Tentative' | 'Confirmed' | 'TimeOff'
    notes?: string
  }) => {
    await createBooking(booking)
  }

  // Handle clicking on a person row
  const handlePersonClick = (member: TeamMember) => {
    setSelectedPerson(member)
    setSelectedDate(new Date())
    setIsModalOpen(true)
  }

  // Handle clicking on an empty cell
  const handleCellClick = (member: TeamMember, date: Date) => {
    setSelectedPerson(member)
    setSelectedDate(date)
    setIsModalOpen(true)
  }

  const isLoading = teamData === undefined
  const dayWidth = 32 // Width per day in pixels

  // Group days by week for header
  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  return (
    <TooltipProvider>
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
                <Users className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Resource Scheduler
                </h1>
                <p className="text-base md:text-lg text-muted-foreground">
                  View team availability and manage resource bookings.
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                setSelectedPerson(null)
                setSelectedDate(new Date())
                setIsModalOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Booking
            </Button>
          </div>

          {/* Navigation and Filters */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={goToToday}>
                Today
              </Button>
              <span className="text-lg font-medium min-w-[220px] text-center">
                {formatDateRange(viewStart, viewEnd)}
              </span>
              <Button variant="outline" size="icon" onClick={goToNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={skillFilter} onValueChange={setSkillFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Skills" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Skills</SelectItem>
                  {filterOptions.skills.map((skill) => (
                    <SelectItem key={skill} value={skill}>
                      {skill}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {filterOptions.roles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depts</SelectItem>
                  {filterOptions.departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Timeline Grid */}
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Loading resources...
                </div>
              ) : teamData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium">No team members found</h3>
                  <p className="text-muted-foreground mt-1">
                    {(skillFilter !== 'all' ||
                      roleFilter !== 'all' ||
                      deptFilter !== 'all')
                      ? 'Try adjusting your filters.'
                      : 'Add team members to start scheduling.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    {/* Header */}
                    <thead>
                      {/* Week labels row */}
                      <tr className="border-b bg-muted/30">
                        <th className="text-left p-3 min-w-[180px] font-medium text-muted-foreground sticky left-0 bg-muted/30 z-10">
                          Team Member
                        </th>
                        {weeks.map((week, weekIdx) => (
                          <th
                            key={weekIdx}
                            colSpan={7}
                            className="text-center p-2 font-medium text-xs text-muted-foreground border-l"
                          >
                            Week {weekIdx + 1} ({formatDayName(week[0])}{' '}
                            {week[0].getDate()})
                          </th>
                        ))}
                        <th className="text-center p-2 min-w-[60px] font-medium text-muted-foreground border-l">
                          Util %
                        </th>
                      </tr>
                      {/* Day labels row */}
                      <tr className="border-b">
                        <th className="sticky left-0 bg-background z-10"></th>
                        {days.map((day) => {
                          const isToday =
                            day.toDateString() === new Date().toDateString()
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6
                          return (
                            <th
                              key={day.getTime()}
                              className={cn(
                                'text-center p-1 font-normal text-xs',
                                isToday && 'bg-primary/10',
                                isWeekend && 'bg-muted/50'
                              )}
                              style={{ width: dayWidth, minWidth: dayWidth }}
                            >
                              <div className="text-muted-foreground">
                                {formatDayName(day).charAt(0)}
                              </div>
                              <div className={cn(isToday && 'font-bold')}>
                                {day.getDate()}
                              </div>
                            </th>
                          )
                        })}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamData.map((member) => (
                        <tr
                          key={member.user._id}
                          className={cn(
                            'border-b hover:bg-muted/30 transition-colors',
                            selectedPerson?.user._id === member.user._id &&
                              'bg-primary/5'
                          )}
                        >
                          {/* Person info */}
                          <td
                            className="p-3 sticky left-0 bg-background z-10 cursor-pointer hover:bg-muted/50"
                            onClick={() => handlePersonClick(member)}
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium">
                                {getInitials(member.user.name)}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">
                                  {member.user.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {member.user.role}
                                </div>
                              </div>
                            </div>
                          </td>
                          {/* Timeline cells with bookings */}
                          {days.map((day) => {
                            const isToday =
                              day.toDateString() === new Date().toDateString()
                            const isWeekend =
                              day.getDay() === 0 || day.getDay() === 6
                            // Check if any booking covers this day
                            const dayTime = day.getTime()
                            const booking = member.bookings.find(
                              (b) => dayTime >= b.startDate && dayTime <= b.endDate
                            )
                            return (
                              <td
                                key={day.getTime()}
                                className={cn(
                                  'p-0 cursor-pointer relative',
                                  isToday && 'bg-primary/5',
                                  isWeekend && 'bg-muted/30',
                                  !booking && 'hover:bg-muted/50'
                                )}
                                style={{ width: dayWidth, minWidth: dayWidth }}
                                onClick={() => handleCellClick(member, day)}
                              >
                                {booking && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={cn(
                                          'absolute inset-y-1 left-0 right-0 rounded-sm',
                                          getBookingColor(booking.type)
                                        )}
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="text-sm">
                                        <p className="font-medium">
                                          {booking.type === 'TimeOff'
                                            ? 'Time Off'
                                            : booking.projectName || 'Project'}
                                        </p>
                                        <p className="text-muted-foreground">
                                          {booking.hoursPerDay}h/day •{' '}
                                          {booking.type}
                                        </p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </td>
                            )
                          })}
                          {/* Utilization */}
                          <td className="text-center p-2 border-l">
                            <div
                              className={cn(
                                'font-medium text-sm',
                                member.availability.utilization >= 100 &&
                                  'text-red-600',
                                member.availability.utilization >= 80 &&
                                  member.availability.utilization < 100 &&
                                  'text-yellow-600',
                                member.availability.utilization < 80 &&
                                  'text-green-600'
                              )}
                            >
                              {member.availability.utilization}%
                            </div>
                            {member.availability.isOverallocated && (
                              <AlertTriangle className="h-3 w-3 text-red-500 mx-auto mt-0.5" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded-sm bg-primary" />
              <span>Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded-sm bg-primary/50" />
              <span>Tentative</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded-sm bg-muted-foreground/30" />
              <span>Time Off</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 rounded-sm bg-muted" />
              <span>Available</span>
            </div>
          </div>

          {/* Create Booking Modal */}
          <CreateBookingModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false)
              setSelectedPerson(null)
            }}
            selectedPerson={selectedPerson}
            selectedDate={selectedDate}
            teamMembers={teamData ?? []}
            onSelectPerson={setSelectedPerson}
            projects={projects}
            onSave={handleCreateBooking}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
