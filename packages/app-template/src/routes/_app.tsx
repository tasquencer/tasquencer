import { AppSidebar } from '@/components/app-sidebar'
import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@repo/ui/components/breadcrumb'
import { Breadcrumb, BreadcrumbPage } from '@repo/ui/components/breadcrumb'
import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@repo/ui/components/dialog'
import { Separator } from '@repo/ui/components/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@repo/ui/components/sidebar'
import { WorkflowVisualizer } from '@repo/audit/components/workflow-visualizer'
import type { ExtractedWorkflowStructure } from '@repo/tasquencer'
import {
  createFileRoute,
  isMatch,
  Link,
  Outlet,
  redirect,
  useMatches,
} from '@tanstack/react-router'
import { Fragment } from 'react'

export const Route = createFileRoute('/_app')({
  component: RouteComponent,
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }
  },
})

function HeaderBreadcrumbs() {
  const matches = useMatches()
  const matchesWithCrumbs = matches.filter((match) =>
    isMatch(match, 'loaderData.crumb'),
  )

  const items = matchesWithCrumbs.map(({ pathname, loaderData }) => {
    return {
      href: pathname,
      label: loaderData?.crumb,
    }
  })

  const lastIndex = items.length - 1

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => (
          <Fragment key={index}>
            <BreadcrumbItem key={index}>
              {index === lastIndex ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <Link to={item.href} className="breadcrumb-link">
                  {item.label}
                </Link>
              )}
            </BreadcrumbItem>
            {index < lastIndex && <BreadcrumbSeparator />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function WorkflowVisualizeHeader({
  structure,
}: {
  structure: ExtractedWorkflowStructure
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Visualize</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[90vw] w-[90vw]">
        <DialogHeader>
          <DialogTitle>Workflow Visualizer</DialogTitle>
        </DialogHeader>
        <div className="h-[80vh] border-t -mx-6 -mb-6">
          <WorkflowVisualizer structure={structure} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HeaderRight() {
  const matches = useMatches()
  const matchesWithCrumbs = matches.filter((match) =>
    isMatch(match, 'loaderData.headerRight'),
  )

  const elements = matchesWithCrumbs.map(
    ({ loaderData }) => loaderData?.headerRight,
  )

  return (
    <div className="gap-2 px-4">
      {elements.map((element, index) => {
        if (element?.type === 'workflowStructure') {
          return (
            <WorkflowVisualizeHeader key={index} structure={element.data} />
          )
        }
        return null
      })}
    </div>
  )
}

function RouteComponent() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-screen">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 border-b sticky top-0 bg-background z-50">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <HeaderBreadcrumbs />
          </div>
          <div className="gap-2 px-4">
            <HeaderRight />
          </div>
        </header>
        <div className="flex flex-1 flex-col min-h-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
