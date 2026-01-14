import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
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
import { Button } from '@repo/ui/components/button'
import { Badge } from '@repo/ui/components/badge'
import { Separator } from '@repo/ui/components/separator'
import { Users, UserCog, ChevronRight, Hash } from 'lucide-react'

export const Route = createFileRoute('/_app/admin/users/')({
  component: RouteComponent,
})

function RouteComponent() {
  const users = useQuery(api.admin.authorization.listUsers)

  if (users === undefined) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-8">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="h-4 w-72 bg-muted rounded" />
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Page Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground">
              Manage user permissions and role assignments
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              Total Users
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold">{users.length}</p>
        </div>
      </div>

      {/* Users Table */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UserCog className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Registered Users</CardTitle>
              <CardDescription className="text-xs">
                Click on a user to manage their group memberships and roles
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="mt-4 text-sm font-medium">No users registered</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Users will appear here once they sign up
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground w-12">
                    <span className="sr-only">Number</span>
                    <Hash className="h-3.5 w-3.5" />
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    User ID
                  </TableHead>
                  <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user, index) => (
                  <TableRow key={user._id} className="group transition-colors">
                    <TableCell className="px-6 py-4 text-muted-foreground">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs tabular-nums"
                      >
                        {index + 1}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {user._id}
                      </code>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <Link
                        to="/admin/users/$userId/assign"
                        params={{ userId: user._id }}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          className="group/btn gap-1.5 transition-all hover:gap-2"
                        >
                          <UserCog className="h-3.5 w-3.5" />
                          <span>Manage Access</span>
                          <ChevronRight className="h-3.5 w-3.5 opacity-50 group-hover/btn:opacity-100 transition-opacity" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
