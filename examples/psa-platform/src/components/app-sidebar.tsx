import * as React from 'react'
import { Briefcase, Building2, FolderKanban, Search, Shield, Clock, CheckCircle, ListTodo, Users } from 'lucide-react'

import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
} from '@repo/ui/components/sidebar'
import { Link } from '@tanstack/react-router'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarContent>
        <NavMain
          items={[
            {
              title: 'Work',
              icon: ListTodo,
              isActive: () => true,
              items: [
                {
                  title: 'My Tasks',
                  renderLink: () => <Link to="/tasks">My Tasks</Link>,
                },
              ],
            },
            {
              title: 'Sales',
              icon: Briefcase,
              isActive: () => true,
              items: [
                {
                  title: 'Deals',
                  renderLink: () => <Link to="/deals">Deals</Link>,
                },
              ],
            },
            {
              title: 'Customers',
              icon: Building2,
              isActive: () => true,
              items: [
                {
                  title: 'Companies',
                  renderLink: () => <Link to="/companies">Companies</Link>,
                },
              ],
            },
            {
              title: 'Delivery',
              icon: FolderKanban,
              isActive: () => true,
              items: [
                {
                  title: 'Projects',
                  renderLink: () => <Link to="/projects">Projects</Link>,
                },
              ],
            },
            {
              title: 'Resources',
              icon: Users,
              isActive: () => true,
              items: [
                {
                  title: 'Scheduler',
                  renderLink: () => <Link to="/resources">Scheduler</Link>,
                },
              ],
            },
            {
              title: 'Time & Expense',
              icon: Clock,
              isActive: () => true,
              items: [
                {
                  title: 'Timesheet',
                  renderLink: () => <Link to="/timesheet">Timesheet</Link>,
                },
                {
                  title: 'Expenses',
                  renderLink: () => <Link to="/expenses">Expenses</Link>,
                },
              ],
            },
            {
              title: 'Approvals',
              icon: CheckCircle,
              isActive: () => true,
              items: [
                {
                  title: 'Timesheets',
                  renderLink: () => <Link to="/approvals/timesheets">Timesheets</Link>,
                },
              ],
            },
            {
              title: 'Audit',
              icon: Search,
              isActive: () => true,
              items: [
                {
                  title: 'Traces',
                  renderLink: () => <Link to="/audit">Traces</Link>,
                },
              ],
            },
            {
              title: 'Admin',
              icon: Shield,
              isActive: () => true,
              items: [
                {
                  title: 'Users',
                  renderLink: () => <Link to="/admin/users">Users</Link>,
                },
                {
                  title: 'Groups',
                  renderLink: () => <Link to="/admin/groups">Groups</Link>,
                },
                {
                  title: 'Roles',
                  renderLink: () => <Link to="/admin/roles">Roles</Link>,
                },
              ],
            },
          ]}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
