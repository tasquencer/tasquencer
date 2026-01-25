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
  Key,
  Shield,
  Layers,
  ArrowLeft,
  Check,
  Loader2,
  Info,
} from 'lucide-react'

export const Route = createFileRoute('/_app/admin/roles/$roleId')({
  component: RouteComponent,
  loader: () => ({
    crumb: 'Edit Role',
  }),
})

type AvailableScope = {
  scope: string
  description: string
  type: 'system' | 'domain'
  tags: string[]
  deprecated: boolean
}

function RouteComponent() {
  const { roleId } = Route.useParams()
  const navigate = useNavigate()

  const roles = useQuery(api.admin.authorization.listAuthRoles)
  const availableScopes = useQuery(api.admin.authorization.listAvailableScopes)
  const updateRole = useMutation(api.admin.authorization.updateAuthRole)

  const role = useMemo(() => {
    return roles?.find((r) => r._id === roleId)
  }, [roles, roleId])

  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (role) {
      setFormName(role.name)
      setFormDescription(role.description)
      setFormIsActive(role.isActive)
      setSelectedScopes(new Set(role.scopes))
    }
  }, [role])

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

  const toggleScope = (scope: string, checked: boolean | 'indeterminate') => {
    const newSelected = new Set(selectedScopes)
    if (checked === true) {
      newSelected.add(scope)
    } else {
      newSelected.delete(scope)
    }
    setSelectedScopes(newSelected)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formDescription.trim()) return

    setIsSaving(true)
    try {
      await updateRole({
        roleId: roleId,
        name: formName.trim(),
        description: formDescription.trim(),
        isActive: formIsActive,
        scopes: Array.from(selectedScopes),
      })
      navigate({ to: '/admin/roles' })
    } catch (error) {
      alert(`Error updating role: ${error}`)
      setIsSaving(false)
    }
  }

  if (roles === undefined || availableScopes === undefined) {
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

  if (!role) {
    return (
      <div className="p-6 lg:p-8">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Key className="h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Role not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The role you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/admin/roles">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Roles
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
          to="/admin/roles"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Roles
        </Link>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Key className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Edit Role</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Role:</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {role.name}
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
              <CardTitle className="text-base">Role Details</CardTitle>
              <CardDescription className="text-xs">
                Update the role name and description
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., admin_role"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g., Full administrative access"
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

          {/* Scopes Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Scope Assignments</CardTitle>
                  <CardDescription className="text-xs">
                    Select the scopes this role should grant
                  </CardDescription>
                </div>
                {selectedScopes.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedScopes.size} selected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/50">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-blue-800 dark:text-blue-200 text-xs">
                  Scopes define what actions users with this role can perform.
                  System scopes grant platform-wide permissions, while domain
                  scopes are specific to workflows.
                </p>
              </div>

              <ScopePicker
                scopesByType={scopesByType}
                selectedScopes={selectedScopes}
                onToggleScope={toggleScope}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Selected Scopes Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                Selected Scopes
              </CardTitle>
              <CardDescription className="text-xs">
                Permissions this role will grant
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedScopes.size === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No scopes selected
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {Array.from(selectedScopes).map((scope) => (
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
    <div className="space-y-4">
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
