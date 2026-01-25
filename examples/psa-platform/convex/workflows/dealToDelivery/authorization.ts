/**
 * PSA Platform Authorization Constants
 *
 * Defines roles and groups for the Deal-to-Delivery workflow.
 * Reference: .review/recipes/psa-platform/specs/02-authorization.md
 */

export const PSA_ROLES = {
  // Full system access
  ADMIN: 'psa_admin',
  // P&L visibility, strategic oversight
  CEO: 'psa_ceo',
  // Capacity planning, utilization tracking
  OPERATIONS_MANAGER: 'psa_operations_manager',
  // Task management, budget tracking
  PROJECT_MANAGER: 'psa_project_manager',
  // Scheduling, availability management
  RESOURCE_MANAGER: 'psa_resource_manager',
  // Invoicing, revenue recognition
  FINANCE: 'psa_finance',
  // Deal management, proposal creation
  SALES_REP: 'psa_sales_rep',
  // Time tracking, task completion
  TEAM_MEMBER: 'psa_team_member',
  // Limited portal access
  CLIENT: 'psa_client',
} as const;

export const PSA_GROUPS = {
  // C-level and owners
  EXECUTIVES: 'psa_executives',
  // People managers
  MANAGERS: 'psa_managers',
  // Finance team
  FINANCE: 'psa_finance',
  // Sales team
  SALES: 'psa_sales',
  // Delivery team
  DELIVERY: 'psa_delivery',
  // Resource planners
  RESOURCE_MANAGERS: 'psa_resource_managers',
  // Expense/time approvers
  APPROVERS: 'psa_approvers',
} as const;

export type PsaRole = (typeof PSA_ROLES)[keyof typeof PSA_ROLES];
export type PsaGroup = (typeof PSA_GROUPS)[keyof typeof PSA_GROUPS];
