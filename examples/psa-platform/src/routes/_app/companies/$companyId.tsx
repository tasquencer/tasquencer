import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@repo/ui/components/button'
import { Badge } from '@repo/ui/components/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@repo/ui/components/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table'
import { Separator } from '@repo/ui/components/separator'
import {
  Building2,
  ArrowLeft,
  MapPin,
  CreditCard,
  Plus,
  Mail,
  Phone,
  Star,
  Users,
  Briefcase,
  Edit,
} from 'lucide-react'

export const Route = createFileRoute('/_app/companies/$companyId')({
  component: CompanyDetail,
  loader: () => ({ crumb: 'Company' }),
})

function CompanyDetail() {
  const { companyId } = Route.useParams()

  const company = useQuery(
    api.workflows.dealToDelivery.api.companies.getCompany,
    { companyId: companyId as Id<'companies'> }
  )

  // Get deals for this company
  const dealsData = useQuery(
    api.workflows.dealToDelivery.api.deals.listDeals,
    { companyId: companyId as Id<'companies'> }
  )

  const isLoading = company === undefined

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading company...
      </div>
    )
  }

  if (company === null) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="p-6 md:p-8 lg:p-10 max-w-6xl mx-auto">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">Company not found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                The company you&apos;re looking for doesn&apos;t exist or has been removed.
              </p>
              <Button asChild>
                <Link to="/companies">Back to Companies</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // dealsData is an array directly from listDeals
  const deals = dealsData ?? []

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-6xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          to="/companies"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Companies
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Building2 className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {company.name}
                </h1>
                <Badge variant="outline">Net {company.paymentTerms} days</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {company.contacts.length} contact{company.contacts.length !== 1 ? 's' : ''}
                </span>
                <span className="flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4" />
                  {deals.length} deal{deals.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/companies/$companyId/edit" params={{ companyId }}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
            <Button asChild>
              <Link to="/deals/new">
                <Plus className="h-4 w-4 mr-2" />
                New Deal
              </Link>
            </Button>
          </div>
        </div>

        <Separator />

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Company Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Billing Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>{company.billingAddress.street}</p>
              <p>
                {company.billingAddress.city}, {company.billingAddress.state}{' '}
                {company.billingAddress.postalCode}
              </p>
              <p>{company.billingAddress.country}</p>
            </CardContent>
          </Card>

          {/* Payment Terms Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payment Terms
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{company.paymentTerms}</span>
                <span className="text-muted-foreground">days (Net terms)</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contacts Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Contacts
              </CardTitle>
              <CardDescription>
                Manage contacts for this company
              </CardDescription>
            </div>
            <Button asChild>
              <Link to="/companies/$companyId/contacts/new" params={{ companyId }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {company.contacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground mb-4">
                  No contacts yet. Add the first contact for this company.
                </p>
                <Button variant="outline" asChild>
                  <Link to="/companies/$companyId/contacts/new" params={{ companyId }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Contact
                  </Link>
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Name
                    </TableHead>
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Email
                    </TableHead>
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Phone
                    </TableHead>
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Primary
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.contacts.map((contact) => (
                    <TableRow key={contact._id} className="group transition-colors">
                      <TableCell className="px-6 py-4 font-medium">
                        {contact.name}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <a
                          href={`mailto:${contact.email}`}
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {contact.email}
                        </a>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <a
                          href={`tel:${contact.phone}`}
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {contact.phone}
                        </a>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {contact.isPrimary && (
                          <Badge variant="secondary" className="gap-1">
                            <Star className="h-3 w-3" />
                            Primary
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Deals Section */}
        {deals.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  Deals
                </CardTitle>
                <CardDescription>
                  Deals associated with this company
                </CardDescription>
              </div>
              <Button variant="outline" asChild>
                <Link to="/deals">
                  View All Deals
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Deal Name
                    </TableHead>
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Stage
                    </TableHead>
                    <TableHead className="h-11 px-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Value
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((deal) => (
                    <TableRow key={deal._id} className="group transition-colors cursor-pointer hover:bg-muted/50">
                      <TableCell className="px-6 py-4 font-medium">
                        <Link
                          to="/deals/$dealId"
                          params={{ dealId: deal._id }}
                          className="hover:underline"
                        >
                          {deal.name}
                        </Link>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge variant="outline">{deal.stage}</Badge>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {formatCurrency(deal.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Outlet for nested routes */}
        <Outlet />
      </div>
    </div>
  )
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}
