import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useState, useEffect, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { Checkbox } from '@repo/ui/components/checkbox'
import { Badge } from '@repo/ui/components/badge'
import { Separator } from '@repo/ui/components/separator'
import {
  Users,
  Key,
  ArrowLeft,
  Check,
  Loader2,
  Info,
} from 'lucide-react'

export const Route = createFileRoute('/_app/admin/groups/$groupId')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Edit Group',
  }),
})

function RouteComponent() {
  const { groupId } = Route.useParams()
  const navigate = useNavigate()

  const groups = useQuery(api.admin.authorization.listAuthGroups)
  const roles = useQuery(api.admin.authorization.listAuthRoles, {})
  const groupRoles = useQuery(
    api.admin.authorization.listAuthGroupRoleAssignments,
    {},
  )

  const updateGroup = useMutation(api.admin.authorization.updateAuthGroup)
  const assignRoleToGroup = useMutation(
    api.admin.authorization.assignAuthRoleToGroup,
  )
  const removeRoleFromGroup = useMutation(
    api.admin.authorization.removeAuthRoleFromGroup,
  )

  const group = useMemo(() => {
    return groups?.find((g) => g._id === groupId)
  }, [groups, groupId])

  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (group && groupRoles) {
      setFormName(group.name)
      setFormDescription(group.description)
      setFormIsActive(group.isActive)
      const currentRoleIds =
        groupRoles
          .filter((gr) => gr.groupId === group._id)
          .map((gr) => gr.roleId) || []
      setSelectedRoleIds(new Set(currentRoleIds))
    }
  }, [group, groupRoles])

  const handleSave = async () => {
    if (!group || !formName.trim() || !formDescription.trim()) return

    setIsSaving(true)
    try {
      await updateGroup({
        groupId: group._id,
        name: formName.trim(),
        description: formDescription.trim(),
        isActive: formIsActive,
      })

      const currentRoleIds = new Set(
        groupRoles
          ?.filter((gr) => gr.groupId === group._id)
          .map((gr) => gr.roleId) || [],
      )

      for (const roleId of selectedRoleIds) {
        if (!currentRoleIds.has(roleId)) {
          await assignRoleToGroup({
            groupId: group._id,
            roleId: roleId,
          })
        }
      }

      for (const roleId of currentRoleIds) {
        if (!selectedRoleIds.has(roleId)) {
          await removeRoleFromGroup({
            groupId: group._id,
            roleId: roleId,
          })
        }
      }

      navigate({ to: '/admin/groups' })
    } catch (error) {
      alert(`Error updating group: ${error}`)
      setIsSaving(false)
    }
  }

  if (groups === undefined || roles === undefined || groupRoles === undefined) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-8">
          <div className="space-y-2">
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-4 w-96 bg-muted rounded" />
          </div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="p-6 lg:p-8">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Group not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The group you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/admin/groups">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Groups
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Page Header */}
      <div className="space-y-4">
        <Link
          to="/admin/groups"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Groups
        </Link>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Edit Group</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Group:</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {group.name}
              </code>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Group Details</CardTitle>
              <CardDescription className="text-xs">
                Update the group name and description
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., admin_team"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g., Administrative team members"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-active"
                  checked={formIsActive}
                  onCheckedChange={(checked) =>
                    setFormIsActive(checked === true)
                  }
                />
                <Label htmlFor="edit-active" className="font-normal">
                  Active
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Roles Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Role Assignments</CardTitle>
                  <CardDescription className="text-xs">
                    Select which roles members of this group should have
                  </CardDescription>
                </div>
                {selectedRoleIds.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedRoleIds.size} selected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/50">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-blue-800 dark:text-blue-200 text-xs">
                  All users in this group will inherit the permissions from
                  assigned roles. Roles grant specific scopes that define what
                  actions users can perform.
                </p>
              </div>

              {roles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Key className="h-8 w-8 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-medium">No roles available</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create roles first to assign them to groups
                  </p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {roles.map((role) => {
                    const isChecked = selectedRoleIds.has(role._id)
                    return (
                      <label
                        key={role._id}
                        htmlFor={`role-${role._id}`}
                        className={`flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/50 ${
                          isChecked ? 'bg-primary/5' : ''
                        }`}
                      >
                        <Checkbox
                          id={`role-${role._id}`}
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedRoleIds)
                            if (checked) {
                              newSelected.add(role._id)
                            } else {
                              newSelected.delete(role._id)
                            }
                            setSelectedRoleIds(newSelected)
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {role.name}
                            </span>
                            {!role.isActive && (
                              <Badge variant="secondary" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {role.description}
                          </p>
                          {role.scopes.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {role.scopes.map((scope) => (
                                <Badge
                                  key={scope}
                                  variant="outline"
                                  className="text-xs font-mono font-normal bg-muted/50"
                                >
                                  {scope}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Assigned Roles Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="h-4 w-4 text-primary" />
                Assigned Roles
              </CardTitle>
              <CardDescription className="text-xs">
                Roles this group will grant to members
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedRoleIds.size === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No roles assigned
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selectedRoleIds).map((roleId) => {
                    const role = roles.find((r) => r._id === roleId)
                    return role ? (
                      <Badge key={roleId} variant="secondary" className="text-xs">
                        {role.name}
                      </Badge>
                    ) : null
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Save Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <Button
                onClick={handleSave}
                disabled={
                  isSaving || !formName.trim() || !formDescription.trim()
                }
                className="w-full gap-2"
                size="lg"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving Changes...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Changes will take effect immediately
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
