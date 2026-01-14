import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useState, useEffect, useMemo } from 'react'
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
import { Checkbox } from '@repo/ui/components/checkbox'
import { Separator } from '@repo/ui/components/separator'
import {
  Key,
  Shield,
  Layers,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
} from 'lucide-react'

export const Route = createFileRoute('/_app/admin/roles/')({
  component: RouteComponent,
})

type Role = {
  _id: string
  name: string
  description: string
  scopes: string[]
  isActive: boolean
}

type AvailableScope = {
  scope: string
  description: string
  type: 'system' | 'domain'
  tags: string[]
  deprecated: boolean
}

function RouteComponent() {
  const roles = useQuery(api.admin.authorization.listAuthRoles)
  const availableScopes = useQuery(api.admin.authorization.listAvailableScopes)

  // Mutations
  const createRole = useMutation(api.admin.authorization.createAuthRole)
  const deleteRole = useMutation(api.admin.authorization.deleteAuthRole)

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  // Form states
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())

  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Group scopes by type
  const scopesByType = useMemo(() => {
    if (!availableScopes) return { system: [], domain: [] }

    const system: AvailableScope[] = []
    const domain: AvailableScope[] = []

    for (const scope of availableScopes) {
      if (scope.type === 'system') {
        system.push(scope)
      } else {
        domain.push(scope)
      }
    }

    return { system, domain }
  }, [availableScopes])

  // Reset form when dialogs open/close
  useEffect(() => {
    if (createDialogOpen) {
      setFormName('')
      setFormDescription('')
      setFormIsActive(true)
      setSelectedScopes(new Set())
    }
  }, [createDialogOpen])


  const handleCreate = async () => {
    if (!formName.trim() || !formDescription.trim()) return

    setIsSubmitting(true)
    try {
      await createRole({
        name: formName.trim(),
        description: formDescription.trim(),
        scopes: Array.from(selectedScopes),
      })
      setCreateDialogOpen(false)
    } catch (error) {
      alert(`Error creating role: ${error}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedRole) return

    setIsSubmitting(true)
    try {
      await deleteRole({
        roleId: selectedRole._id,
      })
      setDeleteDialogOpen(false)
      setSelectedRole(null)
    } catch (error) {
      alert(`Error deleting role: ${error}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openDeleteDialog = (role: Role) => {
    setSelectedRole(role)
    setDeleteDialogOpen(true)
  }

  const toggleScope = (scope: string, checked: boolean | 'indeterminate') => {
    const newSelected = new Set(selectedScopes)
    if (checked === true) {
      newSelected.add(scope)
    } else {
      newSelected.delete(scope)
    }
    setSelectedScopes(newSelected)
  }

  if (roles === undefined || availableScopes === undefined) {
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

  const uniqueScopes = new Set(roles.flatMap((r) => r.scopes))

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
            <p className="text-sm text-muted-foreground">
              Manage permission roles and their associated scopes
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Role
        </Button>
      </div>

      <Separator />

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
              Scopes in Use
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{uniqueScopes.size}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Available Scopes
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {availableScopes.length}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Active
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {roles.filter((r) => r.isActive).length}
          </p>
        </div>
      </div>

      {/* Roles Table */}
      <Card>
        <CardHeader className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Key className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Auth Roles</CardTitle>
              <CardDescription className="text-xs">
                Permission bundles that define user capabilities
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">No roles configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a role to get started
              </p>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="mt-4 gap-2"
                size="sm"
              >
                <Plus className="h-4 w-4" />
                Create Role
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    Description
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Scopes
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
                {roles.map((role) => (
                  <TableRow key={role._id} className="group transition-colors">
                    <TableCell className="px-6 py-4">
                      <span className="font-medium">{role.name}</span>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-muted-foreground hidden md:table-cell">
                      <span className="line-clamp-1">{role.description}</span>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {role.scopes.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">
                            None
                          </span>
                        ) : (
                          role.scopes.map((scope) => (
                            <Badge
                              key={scope}
                              variant="outline"
                              className="text-xs font-mono font-normal bg-muted/50"
                            >
                              {scope}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      {role.isActive ? (
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
                          <Link to="/admin/roles/$roleId" params={{ roleId: role._id }}>
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteDialog(role)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Role</DialogTitle>
            <DialogDescription>
              Create a new permission role and assign scopes to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="create-name">Name</Label>
                <Input
                  id="create-name"
                  placeholder="e.g., admin_role"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-description">Description</Label>
                <Input
                  id="create-description"
                  placeholder="e.g., Full administrative access"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Scopes</Label>
                {selectedScopes.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedScopes.size} selected
                  </Badge>
                )}
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/50">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-blue-800 dark:text-blue-200 text-xs">
                  Select the scopes this role should grant. Scopes define what
                  actions users with this role can perform.
                </p>
              </div>

              <ScopePicker
                scopesByType={scopesByType}
                selectedScopes={selectedScopes}
                onToggleScope={toggleScope}
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
              Create Role
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
              Delete Role
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the role{' '}
              <strong>{selectedRole?.name}</strong>? This action cannot be
              undone. Any groups or users with this role will lose the
              associated permissions.
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
              Delete Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Scope Picker Component
function ScopePicker({
  scopesByType,
  selectedScopes,
  onToggleScope,
}: {
  scopesByType: { system: AvailableScope[]; domain: AvailableScope[] }
  selectedScopes: Set<string>
  onToggleScope: (scope: string, checked: boolean | 'indeterminate') => void
}) {
  const renderScopeSection = (
    title: string,
    scopes: AvailableScope[],
    icon: React.ReactNode,
  ) => {
    if (scopes.length === 0) return null

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          <span>{title}</span>
          <Badge variant="outline" className="text-xs font-normal">
            {scopes.length}
          </Badge>
        </div>
        <div className="divide-y rounded-lg border">
          {scopes.map((scopeInfo) => {
            const isChecked = selectedScopes.has(scopeInfo.scope)
            return (
              <label
                key={scopeInfo.scope}
                htmlFor={`scope-${scopeInfo.scope}`}
                className={`flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/50 ${
                  isChecked ? 'bg-primary/5' : ''
                } ${scopeInfo.deprecated ? 'opacity-60' : ''}`}
              >
                <Checkbox
                  id={`scope-${scopeInfo.scope}`}
                  checked={isChecked}
                  onCheckedChange={(checked) =>
                    onToggleScope(scopeInfo.scope, checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
                      {scopeInfo.scope}
                    </code>
                    {scopeInfo.deprecated && (
                      <Badge
                        variant="outline"
                        className="text-xs text-amber-600 border-amber-300"
                      >
                        Deprecated
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {scopeInfo.description}
                  </p>
                  {scopeInfo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {scopeInfo.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-h-64 overflow-y-auto">
      {renderScopeSection(
        'System Scopes',
        scopesByType.system,
        <Shield className="h-4 w-4" />,
      )}
      {renderScopeSection(
        'Domain Scopes',
        scopesByType.domain,
        <Layers className="h-4 w-4" />,
      )}
      {scopesByType.system.length === 0 && scopesByType.domain.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No scopes available
        </p>
      )}
    </div>
  )
}
