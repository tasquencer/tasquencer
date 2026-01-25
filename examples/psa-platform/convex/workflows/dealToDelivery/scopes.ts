import { createScopeModule } from '@repo/tasquencer'

const dealsViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own deals',
    tags: ['deals', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team deals',
    tags: ['deals', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all deals in organization',
    tags: ['deals', 'view', 'all'],
  })

const dealsEditScopeModule = createScopeModule('edit')
  .withScope('own', {
    description: 'Edit own deals',
    tags: ['deals', 'edit', 'own'],
  })
  .withScope('all', {
    description: 'Edit any deal',
    tags: ['deals', 'edit', 'all'],
  })

const dealsScopeModule = createScopeModule('deals')
  .withScope('create', {
    description: 'Create new deals',
    tags: ['deals', 'create'],
  })
  .withScope('delete', {
    description: 'Delete deals',
    tags: ['deals', 'delete'],
  })
  .withScope('qualify', {
    description: 'Qualify or disqualify leads',
    tags: ['deals', 'qualify'],
  })
  .withScope('negotiate', {
    description: 'Negotiate deal terms',
    tags: ['deals', 'negotiate'],
  })
  .withScope('close', {
    description: 'Close deals as won or lost',
    tags: ['deals', 'close'],
  })
  .withNestedModule(dealsViewScopeModule)
  .withNestedModule(dealsEditScopeModule)

const proposalsViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own proposals',
    tags: ['proposals', 'view', 'own'],
  })
  .withScope('all', {
    description: 'View all proposals',
    tags: ['proposals', 'view', 'all'],
  })

const proposalsScopeModule = createScopeModule('proposals')
  .withScope('create', {
    description: 'Create proposals from estimates',
    tags: ['proposals', 'create'],
  })
  .withScope('edit', {
    description: 'Edit proposals',
    tags: ['proposals', 'edit'],
  })
  .withScope('send', {
    description: 'Send proposals to clients',
    tags: ['proposals', 'send'],
  })
  .withNestedModule(proposalsViewScopeModule)

const projectsViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View assigned projects',
    tags: ['projects', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team projects',
    tags: ['projects', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all projects',
    tags: ['projects', 'view', 'all'],
  })

const projectsEditScopeModule = createScopeModule('edit')
  .withScope('own', {
    description: 'Edit assigned projects',
    tags: ['projects', 'edit', 'own'],
  })
  .withScope('all', {
    description: 'Edit any project',
    tags: ['projects', 'edit', 'all'],
  })

const projectsScopeModule = createScopeModule('projects')
  .withScope('create', {
    description: 'Create new projects',
    tags: ['projects', 'create'],
  })
  .withScope('delete', {
    description: 'Delete projects',
    tags: ['projects', 'delete'],
  })
  .withScope('close', {
    description: 'Close/archive projects',
    tags: ['projects', 'close'],
  })
  .withNestedModule(projectsViewScopeModule)
  .withNestedModule(projectsEditScopeModule)

const tasksViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View assigned tasks',
    tags: ['tasks', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team tasks',
    tags: ['tasks', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all tasks',
    tags: ['tasks', 'view', 'all'],
  })

const tasksEditScopeModule = createScopeModule('edit')
  .withScope('own', {
    description: 'Edit assigned tasks',
    tags: ['tasks', 'edit', 'own'],
  })
  .withScope('all', {
    description: 'Edit any task',
    tags: ['tasks', 'edit', 'all'],
  })

const tasksScopeModule = createScopeModule('tasks')
  .withScope('create', {
    description: 'Create tasks',
    tags: ['tasks', 'create'],
  })
  .withScope('assign', {
    description: 'Assign tasks to team members',
    tags: ['tasks', 'assign'],
  })
  .withScope('delete', {
    description: 'Delete tasks',
    tags: ['tasks', 'delete'],
  })
  .withNestedModule(tasksViewScopeModule)
  .withNestedModule(tasksEditScopeModule)

const budgetsViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View budgets for assigned projects',
    tags: ['budgets', 'view', 'own'],
  })
  .withScope('all', {
    description: 'View all budgets',
    tags: ['budgets', 'view', 'all'],
  })

const budgetsScopeModule = createScopeModule('budgets')
  .withScope('create', {
    description: 'Create project budgets',
    tags: ['budgets', 'create'],
  })
  .withScope('edit', {
    description: 'Edit budgets and services',
    tags: ['budgets', 'edit'],
  })
  .withScope('approve', {
    description: 'Approve budget changes',
    tags: ['budgets', 'approve'],
  })
  .withNestedModule(budgetsViewScopeModule)

const resourcesViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own availability and bookings',
    tags: ['resources', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team availability',
    tags: ['resources', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all resource availability',
    tags: ['resources', 'view', 'all'],
  })

const resourcesBookScopeModule = createScopeModule('book')
  .withScope('own', {
    description: 'Create bookings for self',
    tags: ['resources', 'book', 'own'],
  })
  .withScope('team', {
    description: 'Create bookings for team members',
    tags: ['resources', 'book', 'team'],
  })
  .withScope('all', {
    description: 'Create bookings for anyone',
    tags: ['resources', 'book', 'all'],
  })

const resourcesTimeoffScopeModule = createScopeModule('timeoff')
  .withScope('own', {
    description: 'Request own time off',
    tags: ['resources', 'timeoff', 'own'],
  })
  .withScope('approve', {
    description: 'Approve time off requests',
    tags: ['resources', 'timeoff', 'approve'],
  })

const resourcesScopeModule = createScopeModule('resources')
  .withScope('confirm', {
    description: 'Confirm tentative bookings',
    tags: ['resources', 'confirm'],
  })
  .withNestedModule(resourcesViewScopeModule)
  .withNestedModule(resourcesBookScopeModule)
  .withNestedModule(resourcesTimeoffScopeModule)

const timeViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own time entries',
    tags: ['time', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team time entries',
    tags: ['time', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all time entries',
    tags: ['time', 'view', 'all'],
  })

const timeCreateScopeModule = createScopeModule('create')
  .withScope('own', {
    description: 'Create own time entries',
    tags: ['time', 'create', 'own'],
  })

const timeEditScopeModule = createScopeModule('edit')
  .withScope('own', {
    description: 'Edit own time entries',
    tags: ['time', 'edit', 'own'],
  })
  .withScope('all', {
    description: 'Edit any time entry',
    tags: ['time', 'edit', 'all'],
  })

const timeScopeModule = createScopeModule('time')
  .withScope('submit', {
    description: 'Submit timesheets for approval',
    tags: ['time', 'submit'],
  })
  .withScope('approve', {
    description: 'Approve/reject timesheets',
    tags: ['time', 'approve'],
  })
  .withScope('lock', {
    description: 'Lock approved timesheets',
    tags: ['time', 'lock'],
  })
  .withNestedModule(timeViewScopeModule)
  .withNestedModule(timeCreateScopeModule)
  .withNestedModule(timeEditScopeModule)

const expensesViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own expenses',
    tags: ['expenses', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team expenses',
    tags: ['expenses', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all expenses',
    tags: ['expenses', 'view', 'all'],
  })

const expensesEditScopeModule = createScopeModule('edit')
  .withScope('own', {
    description: 'Edit own expenses',
    tags: ['expenses', 'edit', 'own'],
  })

const expensesScopeModule = createScopeModule('expenses')
  .withScope('create', {
    description: 'Create expense entries',
    tags: ['expenses', 'create'],
  })
  .withScope('submit', {
    description: 'Submit expenses for approval',
    tags: ['expenses', 'submit'],
  })
  .withScope('approve', {
    description: 'Approve/reject expenses',
    tags: ['expenses', 'approve'],
  })
  .withNestedModule(expensesViewScopeModule)
  .withNestedModule(expensesEditScopeModule)

const invoicesViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View invoices for assigned projects',
    tags: ['invoices', 'view', 'own'],
  })
  .withScope('all', {
    description: 'View all invoices',
    tags: ['invoices', 'view', 'all'],
  })

const invoicesScopeModule = createScopeModule('invoices')
  .withScope('create', {
    description: 'Create/generate invoices',
    tags: ['invoices', 'create'],
  })
  .withScope('edit', {
    description: 'Edit draft invoices',
    tags: ['invoices', 'edit'],
  })
  .withScope('finalize', {
    description: 'Finalize invoices for sending',
    tags: ['invoices', 'finalize'],
  })
  .withScope('send', {
    description: 'Send invoices to clients',
    tags: ['invoices', 'send'],
  })
  .withScope('void', {
    description: 'Void sent invoices',
    tags: ['invoices', 'void'],
  })
  .withNestedModule(invoicesViewScopeModule)

const paymentsScopeModule = createScopeModule('payments')
  .withScope('view', {
    description: 'View payment status',
    tags: ['payments', 'view'],
  })
  .withScope('record', {
    description: 'Record payments received',
    tags: ['payments', 'record'],
  })

const reportsViewScopeModule = createScopeModule('view')
  .withScope('own', {
    description: 'View own reports (utilization, time)',
    tags: ['reports', 'view', 'own'],
  })
  .withScope('team', {
    description: 'View team reports',
    tags: ['reports', 'view', 'team'],
  })
  .withScope('all', {
    description: 'View all reports',
    tags: ['reports', 'view', 'all'],
  })

const reportsScopeModule = createScopeModule('reports')
  .withScope('profitability', {
    description: 'View profitability reports',
    tags: ['reports', 'profitability'],
  })
  .withScope('forecasting', {
    description: 'View revenue/pipeline forecasts',
    tags: ['reports', 'forecasting'],
  })
  .withNestedModule(reportsViewScopeModule)

const changeOrdersScopeModule = createScopeModule('changeOrders')
  .withScope('view', {
    description: 'View change orders',
    tags: ['changeOrders', 'view'],
  })
  .withScope('request', {
    description: 'Request change orders for additional budget',
    tags: ['changeOrders', 'request'],
  })
  .withScope('approve', {
    description: 'Approve or reject change orders',
    tags: ['changeOrders', 'approve'],
  })

const adminScopeModule = createScopeModule('admin')
  .withScope('users', {
    description: 'Manage users and permissions',
    tags: ['admin', 'users'],
  })
  .withScope('settings', {
    description: 'Manage organization settings',
    tags: ['admin', 'settings'],
  })
  .withScope('integrations', {
    description: 'Manage integrations',
    tags: ['admin', 'integrations'],
  })
  .withScope('impersonate', {
    description: 'Impersonate users for testing',
    tags: ['admin', 'impersonate'],
  })

export const dealToDeliveryScopeModule = createScopeModule('dealToDelivery')
  .withScope('staff', {
    description: 'Base scope for Deal To Delivery workflow staff members',
    tags: ['dealToDelivery', 'staff'],
  })
  .withNestedModule(dealsScopeModule)
  .withNestedModule(proposalsScopeModule)
  .withNestedModule(projectsScopeModule)
  .withNestedModule(tasksScopeModule)
  .withNestedModule(budgetsScopeModule)
  .withNestedModule(resourcesScopeModule)
  .withNestedModule(timeScopeModule)
  .withNestedModule(expensesScopeModule)
  .withNestedModule(invoicesScopeModule)
  .withNestedModule(paymentsScopeModule)
  .withNestedModule(changeOrdersScopeModule)
  .withNestedModule(reportsScopeModule)
  .withNestedModule(adminScopeModule)
