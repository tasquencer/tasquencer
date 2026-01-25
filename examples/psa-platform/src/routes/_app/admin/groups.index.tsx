import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useState, useEffect } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'
import { Badge } from '@repo/ui/components/badge'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Separator } from '@repo/ui/components/separator'
import {
  Users,
  Shield,
  Key,
  Layers,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react'

export const Route = createFileRoute('/_app/admin/groups/')({
  component: RouteComponent,
})

type Group = {
  _id: string
  name: string
  description: string
  isActive: boolean
}

function RouteComponent() {
  const groups = useQuery(api.admin.authorization.listAuthGroups)
  const roles = useQuery(api.admin.authorization.listAuthRoles, {})
  const groupRoles = useQuery(
    api.admin.authorization.listAuthGroupRoleAssignments,
    {},
  )

  // Mutations
  const createGroup = useMutation(api.admin.authorization.createAuthGroup)
  const deleteGroup = useMutation(api.admin.authorization.deleteAuthGroup)

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)

  // Form states
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form when dialogs open/close
  useEffect(() => {
    if (createDialogOpen) {
      setFormName('')
      setFormDescription('')
    }
  }, [createDialogOpen])

  const handleCreate = async () => {
    if (!formName.trim() || !formDescription.trim()) return

    setIsSubmitting(true)
    try {
      await createGroup({
        name: formName.trim(),
        description: formDescription.trim(),
      })
      setCreateDialogOpen(false)
    } catch (error) {
      alert(`Error creating group: ${error}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedGroup) return

    setIsSubmitting(true)
    try {
      await deleteGroup({
        groupId: selectedGroup._id,
      })
      setDeleteDialogOpen(false)
      setSelectedGroup(null)
    } catch (error) {
      alert(`Error deleting group: ${error}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openDeleteDialog = (group: Group) => {
    setSelectedGroup(group)
    setDeleteDialogOpen(true)
  }

  if (groups === undefined || roles === undefined || groupRoles === undefined) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-8">
          <div className="space-y-2">
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-4 w-96 bg-muted rounded" />
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  const groupToRoles = new Map<string, string[]>()
  for (const assignment of groupRoles) {
    const role = roles.find((r) => r._id === assignment.roleId)
    if (!role) continue

    const existing = groupToRoles.get(assignment.groupId) || []
    groupToRoles.set(assignment.groupId, [...existing, role.name])
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <p className="text-sm text-muted-foreground">
              Manage user groups and their role assignments
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Group
        </Button>
      </div>

      <Separator />

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Groups
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{groups.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Key className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Roles
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{roles.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Assignments
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{groupRoles.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Active
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {groups.filter((g) => g.isActive).length}
          </p>
        </div>
      </div>

      {/* Groups Table */}
      <Card>
        <CardHeader className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Auth Groups</CardTitle>
              <CardDescription className="text-xs">
                Collections of users with shared permissions
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">No groups configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a group to get started
              </p>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="mt-4 gap-2"
                size="sm"
              >
                <Plus className="h-4 w-4" />
                Create Group
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    Description
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Roles
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const assignedRoles = groupToRoles.get(group._id) || []
                  return (
                    <TableRow
                      key={group._id}
                      className="group transition-colors"
                    >
                      <TableCell className="px-6 py-4">
                        <span className="font-medium">{group.name}</span>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground hidden sm:table-cell">
                        <span className="line-clamp-1">
                          {group.description}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {assignedRoles.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic">
                              None
                            </span>
                          ) : (
                            assignedRoles.map((roleName) => (
                              <Badge
                                key={roleName}
                                variant="secondary"
                                className="text-xs font-normal"
                              >
                                {roleName}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {group.isActive ? (
                          <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/15">
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-muted-foreground"
                          >
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-8 w-8 p-0"
                          >
                            <Link to="/admin/groups/$groupId" params={{ groupId: group._id }}>
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Edit</span>
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(group)}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
            <DialogDescription>
              Create a new authorization group. You can assign roles after
              creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                placeholder="e.g., admin_team"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-description">Description</Label>
              <Input
                id="create-description"
                placeholder="e.g., Administrative team members"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                isSubmitting || !formName.trim() || !formDescription.trim()
              }
              className="gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Group
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the group{' '}
              <strong>{selectedGroup?.name}</strong>? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
