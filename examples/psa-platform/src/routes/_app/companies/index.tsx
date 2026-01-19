import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Button } from '@repo/ui/components/button'
import { Card, CardContent } from '@repo/ui/components/card'
import { Badge } from '@repo/ui/components/badge'
import { Building2, Plus, Users } from 'lucide-react'

export const Route = createFileRoute('/_app/companies/')({
  component: CompaniesPage,
  loader: () => ({ crumb: 'Companies' }),
})

function CompaniesPage() {
  const companies = useQuery(
    api.workflows.dealToDelivery.api.companies.listCompanies
  )

  const isLoading = companies === undefined

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
              <Building2 className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                Companies
              </h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Manage your client companies and contacts.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/companies/new">
              <Plus className="h-4 w-4 mr-2" />
              New Company
            </Link>
          </Button>
        </div>

        {/* Companies Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading companies...
          </div>
        ) : companies.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No companies yet</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                Create your first company to start managing clients.
              </p>
              <Button asChild>
                <Link to="/companies/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Company
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {companies.map((company) => (
              <Link
                key={company._id}
                to="/companies/$companyId"
                params={{ companyId: company._id }}
              >
                <Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30 h-full">
                  <CardContent className="p-5 space-y-4">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-base truncate">
                            {company.name}
                          </h3>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                            <Badge variant="outline" className="text-xs">
                              Net {company.paymentTerms} days
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Address */}
                    <div className="text-sm text-muted-foreground">
                      <p>{company.billingAddress.street}</p>
                      <p>
                        {company.billingAddress.city}, {company.billingAddress.state}{' '}
                        {company.billingAddress.postalCode}
                      </p>
                      <p>{company.billingAddress.country}</p>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 border-t text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        <span>View contacts</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
