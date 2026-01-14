import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import { Button } from '@repo/ui/components/button'
import { useState, useMemo, useEffect } from 'react'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui/components/tabs'
import { Badge } from '@repo/ui/components/badge'
import { Separator } from '@repo/ui/components/separator'
import {
  UserCog,
  Users,
  Key,
  Shield,
  Check,
  Loader2,
  ArrowLeft,
  Info,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin/users/$userId/assign')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Assign Groups & Roles',
  }),
})

function RouteComponent() {
  const { userId } = Route.useParams()
  const navigate = useNavigate()
  const groups = useQuery(api.admin.authorization.listAuthGroups)
  const roles = useQuery(api.admin.authorization.listAuthRoles)
  const groupRoles = useQuery(
    api.admin.authorization.listAuthGroupRoleAssignments,
  )

  const updateUserGroupMemberships = useMutation(
    api.admin.authorization.updateUserAuthGroupMemberships,
  )
  const updateUserRoleAssignments = useMutation(
    api.admin.authorization.updateUserAuthRoleAssignments,
  )

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  )
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  const userMemberships = useQuery(
    api.admin.authorization.getUserAuthGroupMemberships,
    { userId: userId },
  )

  const userRoles = useQuery(
    api.admin.authorization.getUserAuthRoleAssignments,
    {
      userId: userId,
    },
  )

  useEffect(() => {
    if (userMemberships) {
      setSelectedGroupIds(new Set(userMemberships.map((m) => m.groupId)))
    }
  }, [userMemberships])

  useEffect(() => {
    if (userRoles) {
      setSelectedRoleIds(new Set(userRoles.map((r) => r.roleId)))
    }
  }, [userRoles])

  const rolesViaGroups = useMemo(() => {
    if (!groupRoles) return new Set<string>()

    const roleIds = new Set<string>()
    for (const groupId of selectedGroupIds) {
      const assignments = groupRoles.filter((gr) => gr.groupId === groupId)
      assignments.forEach((a) => roleIds.add(a.roleId))
    }

    return roleIds
  }, [selectedGroupIds, groupRoles])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateUserGroupMemberships({
        userId: userId,
        groupIds: Array.from(selectedGroupIds),
      })

      await updateUserRoleAssignments({
        userId: userId,
        roleIds: Array.from(selectedRoleIds),
      })

      navigate({ to: '/admin/users' })
    } catch (error) {
      alert(`Error: ${error}`)
      setIsSaving(false)
    }
  }

  if (
    groups === undefined ||
    roles === undefined ||
    userMemberships === undefined ||
    userRoles === undefined ||
    groupRoles === undefined
  ) {
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

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Page Header */}
      <div className="space-y-4">
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Link>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCog className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Manage User Access
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>User ID:</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {userId}
              </code>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tabs Section */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden">
            <Tabs defaultValue="groups" className="w-full">
              <CardHeader className="border-b px-6 py-0">
                <TabsList className="h-14 w-full justify-start gap-4 bg-transparent p-0">
                  <TabsTrigger
                    value="groups"
                    className="relative h-14 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none data-[state=active]:border-x-transparent data-[state=active]:border-t-transparent data-[state=active]:border-b-primary data-[state=active]:!bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:!bg-transparent dark:data-[state=active]:!border-x-transparent dark:data-[state=active]:!border-t-transparent dark:data-[state=active]:border-b-primary"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    Group Memberships
                    {selectedGroupIds.size > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-2 h-5 px-1.5 text-xs"
                      >
                        {selectedGroupIds.size}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="roles"
                    className="relative h-14 rounded-none border-b-2 border-transparent bg-transparent px-4 font-medium text-muted-foreground shadow-none data-[state=active]:border-x-transparent data-[state=active]:border-t-transparent data-[state=active]:border-b-primary data-[state=active]:!bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:!bg-transparent dark:data-[state=active]:!border-x-transparent dark:data-[state=active]:!border-t-transparent dark:data-[state=active]:border-b-primary"
                  >
                    <Key className="mr-2 h-4 w-4" />
                    Direct Roles
                    {selectedRoleIds.size > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-2 h-5 px-1.5 text-xs"
                      >
                        {selectedRoleIds.size}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent className="p-6">
                <TabsContent value="groups" className="mt-0 space-y-4">
                  <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/50">
                    <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-blue-800 dark:text-blue-200">
                      Users inherit all roles assigned to their groups. Select
                      groups below to grant permissions.
                    </p>
                  </div>

                  <div className="space-y-1">
                    {groups.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Users className="h-10 w-10 text-muted-foreground/50" />
                        <p className="mt-3 text-sm font-medium">
                          No groups available
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Create groups in the Groups page to assign users
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        {groups.map((group) => {
                          const isChecked = selectedGroupIds.has(group._id)
                          const groupRoleNames =
                            groupRoles
                              ?.filter((gr) => gr.groupId === group._id)
                              .map((gr) => {
                                const role = roles?.find(
                                  (r) => r._id === gr.roleId,
                                )
                                return role?.name
                              })
                              .filter(Boolean) || []

                          return (
                            <label
                              key={group._id}
                              htmlFor={group._id}
                              className={`flex cursor-pointer items-start gap-4 p-4 transition-colors hover:bg-muted/50 ${
                                isChecked ? 'bg-primary/5' : ''
                              }`}
                            >
                              <Checkbox
                                id={group._id}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  const newSelectedGroupIds = new Set(
                                    selectedGroupIds,
                                  )
                                  if (checked) {
                                    newSelectedGroupIds.add(group._id)
                                  } else {
                                    newSelectedGroupIds.delete(group._id)
                                  }
                                  setSelectedGroupIds(newSelectedGroupIds)
                                }}
                                className="mt-0.5"
                              />
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {group.name}
                                  </span>
                                  {!group.isActive && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      Inactive
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {group.description}
                                </p>
                                {groupRoleNames.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    {groupRoleNames.map((roleName) => (
                                      <Badge
                                        key={roleName}
                                        variant="outline"
                                        className="text-xs font-normal"
                                      >
                                        <Shield className="mr-1 h-3 w-3" />
                                        {roleName}
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
                  </div>
                </TabsContent>

                <TabsContent value="roles" className="mt-0 space-y-4">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/50">
                    <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-amber-800 dark:text-amber-200">
                      Direct role assignments are for temporary or exception
                      cases. Prefer using groups for standard permissions.
                    </p>
                  </div>

                  <div className="space-y-1">
                    {roles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Key className="h-10 w-10 text-muted-foreground/50" />
                        <p className="mt-3 text-sm font-medium">
                          No roles available
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Roles will appear here once configured
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        {roles.map((role) => {
                          const grantedViaGroup = rolesViaGroups.has(role._id)
                          const isChecked = selectedRoleIds.has(role._id)

                          return (
                            <label
                              key={role._id}
                              htmlFor={`role-${role._id}`}
                              className={`flex cursor-pointer items-start gap-4 p-4 transition-colors hover:bg-muted/50 ${
                                isChecked || grantedViaGroup
                                  ? 'bg-primary/5'
                                  : ''
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
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium">
                                    {role.name}
                                  </span>
                                  {grantedViaGroup && (
                                    <Badge className="bg-primary/15 text-primary border-primary/20 text-xs">
                                      <Users className="mr-1 h-3 w-3" />
                                      Via Group
                                    </Badge>
                                  )}
                                  {!role.isActive && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      Inactive
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {role.description}
                                </p>
                                {role.scopes.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
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
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>

        {/* Summary Sidebar */}
        <div className="space-y-4">
          {/* Effective Permissions Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-primary" />
                Effective Permissions
              </CardTitle>
              <CardDescription className="text-xs">
                Combined roles from groups and direct assignments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rolesViaGroups.size === 0 && selectedRoleIds.size === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No permissions assigned
                </p>
              ) : (
                <div className="space-y-3">
                  {rolesViaGroups.size > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Via Groups
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(rolesViaGroups).map((roleId) => {
                          const role = roles.find((r) => r._id === roleId)
                          return role ? (
                            <Badge
                              key={roleId}
                              variant="secondary"
                              className="text-xs"
                            >
                              {role.name}
                            </Badge>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}
                  {selectedRoleIds.size > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Direct
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(selectedRoleIds).map((roleId) => {
                          const role = roles.find((r) => r._id === roleId)
                          return role ? (
                            <Badge
                              key={roleId}
                              variant="outline"
                              className="text-xs"
                            >
                              {role.name}
                            </Badge>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Save Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <Button
                onClick={handleSave}
                disabled={isSaving}
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
