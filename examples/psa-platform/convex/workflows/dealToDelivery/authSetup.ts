/**
 * PSA Platform Authorization Setup
 *
 * Creates groups, roles, and assigns roles to groups for the Deal-to-Delivery workflow.
 * Reference: .review/recipes/psa-platform/specs/02-authorization.md
 */
import { internalMutation } from "../../_generated/server";
import { components } from "../../_generated/api";
import { PSA_GROUPS, PSA_ROLES } from "./authorization";

/**
 * Auth Groups Configuration
 */
const authGroups = [
  {
    name: PSA_GROUPS.EXECUTIVES,
    description: "C-level and owners - CEO, COO, CFO",
  },
  {
    name: PSA_GROUPS.MANAGERS,
    description: "People managers - Project Managers, Operations Manager",
  },
  {
    name: PSA_GROUPS.FINANCE,
    description: "Finance team - Accountants, Finance Director",
  },
  {
    name: PSA_GROUPS.SALES,
    description: "Sales team - Sales Reps, Account Executives",
  },
  {
    name: PSA_GROUPS.DELIVERY,
    description: "Delivery team - Designers, Developers, Consultants",
  },
  {
    name: PSA_GROUPS.RESOURCE_MANAGERS,
    description: "Resource planners - Resource Manager, Ops Manager",
  },
  {
    name: PSA_GROUPS.APPROVERS,
    description: "Expense/time approvers - Managers with approval rights",
  },
];

/**
 * Auth Roles Configuration with Scope Bundles
 *
 * Scopes follow the pattern: dealToDelivery:module:action[:scope]
 * Reference: scopes.ts for available scopes
 */
const authRoles = [
  {
    name: PSA_ROLES.ADMIN,
    description: "Full system access",
    scopes: [
      "dealToDelivery:staff",
      // All deal scopes
      "dealToDelivery:deals:create",
      "dealToDelivery:deals:delete",
      "dealToDelivery:deals:qualify",
      "dealToDelivery:deals:negotiate",
      "dealToDelivery:deals:close",
      "dealToDelivery:deals:view:own",
      "dealToDelivery:deals:view:team",
      "dealToDelivery:deals:view:all",
      "dealToDelivery:deals:edit:own",
      "dealToDelivery:deals:edit:all",
      // All proposal scopes
      "dealToDelivery:proposals:create",
      "dealToDelivery:proposals:edit",
      "dealToDelivery:proposals:send",
      "dealToDelivery:proposals:view:own",
      "dealToDelivery:proposals:view:all",
      // All project scopes
      "dealToDelivery:projects:create",
      "dealToDelivery:projects:delete",
      "dealToDelivery:projects:close",
      "dealToDelivery:projects:view:own",
      "dealToDelivery:projects:view:team",
      "dealToDelivery:projects:view:all",
      "dealToDelivery:projects:edit:own",
      "dealToDelivery:projects:edit:all",
      // All task scopes
      "dealToDelivery:tasks:create",
      "dealToDelivery:tasks:assign",
      "dealToDelivery:tasks:delete",
      "dealToDelivery:tasks:view:own",
      "dealToDelivery:tasks:view:team",
      "dealToDelivery:tasks:view:all",
      "dealToDelivery:tasks:edit:own",
      "dealToDelivery:tasks:edit:all",
      // All budget scopes
      "dealToDelivery:budgets:create",
      "dealToDelivery:budgets:edit",
      "dealToDelivery:budgets:approve",
      "dealToDelivery:budgets:view:own",
      "dealToDelivery:budgets:view:all",
      // All resource scopes
      "dealToDelivery:resources:confirm",
      "dealToDelivery:resources:view:own",
      "dealToDelivery:resources:view:team",
      "dealToDelivery:resources:view:all",
      "dealToDelivery:resources:book:own",
      "dealToDelivery:resources:book:team",
      "dealToDelivery:resources:book:all",
      "dealToDelivery:resources:timeoff:own",
      "dealToDelivery:resources:timeoff:approve",
      // All time scopes
      "dealToDelivery:time:submit",
      "dealToDelivery:time:approve",
      "dealToDelivery:time:lock",
      "dealToDelivery:time:view:own",
      "dealToDelivery:time:view:team",
      "dealToDelivery:time:view:all",
      "dealToDelivery:time:create:own",
      "dealToDelivery:time:edit:own",
      "dealToDelivery:time:edit:all",
      // All expense scopes
      "dealToDelivery:expenses:create",
      "dealToDelivery:expenses:submit",
      "dealToDelivery:expenses:approve",
      "dealToDelivery:expenses:view:own",
      "dealToDelivery:expenses:view:team",
      "dealToDelivery:expenses:view:all",
      "dealToDelivery:expenses:edit:own",
      // All invoice scopes
      "dealToDelivery:invoices:create",
      "dealToDelivery:invoices:edit",
      "dealToDelivery:invoices:finalize",
      "dealToDelivery:invoices:send",
      "dealToDelivery:invoices:void",
      "dealToDelivery:invoices:view:own",
      "dealToDelivery:invoices:view:all",
      // All payment scopes
      "dealToDelivery:payments:view",
      "dealToDelivery:payments:record",
      // All change order scopes
      "dealToDelivery:changeOrders:view",
      "dealToDelivery:changeOrders:request",
      "dealToDelivery:changeOrders:approve",
      // All report scopes
      "dealToDelivery:reports:profitability",
      "dealToDelivery:reports:forecasting",
      "dealToDelivery:reports:view:own",
      "dealToDelivery:reports:view:team",
      "dealToDelivery:reports:view:all",
      // All admin scopes
      "dealToDelivery:admin:users",
      "dealToDelivery:admin:settings",
      "dealToDelivery:admin:integrations",
      "dealToDelivery:admin:impersonate",
    ],
  },
  {
    name: PSA_ROLES.CEO,
    description: "CEO/Owner - P&L visibility, strategic oversight",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:deals:view:all",
      "dealToDelivery:projects:view:all",
      "dealToDelivery:budgets:view:all",
      "dealToDelivery:invoices:view:all",
      "dealToDelivery:payments:view",
      "dealToDelivery:reports:profitability",
      "dealToDelivery:reports:forecasting",
      "dealToDelivery:reports:view:all",
      "dealToDelivery:changeOrders:approve",
    ],
  },
  {
    name: PSA_ROLES.OPERATIONS_MANAGER,
    description: "Operations Manager - Capacity planning, utilization tracking",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:projects:view:all",
      "dealToDelivery:tasks:view:all",
      "dealToDelivery:resources:view:all",
      "dealToDelivery:resources:book:all",
      "dealToDelivery:resources:confirm",
      "dealToDelivery:resources:timeoff:approve",
      "dealToDelivery:time:view:all",
      "dealToDelivery:time:edit:all",
      "dealToDelivery:time:approve",
      "dealToDelivery:expenses:view:all",
      "dealToDelivery:expenses:approve",
      "dealToDelivery:budgets:view:all",
      "dealToDelivery:reports:view:all",
    ],
  },
  {
    name: PSA_ROLES.PROJECT_MANAGER,
    description: "Project Manager - Task management, budget tracking",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:deals:view:own",
      "dealToDelivery:projects:view:own",
      "dealToDelivery:projects:view:team",
      "dealToDelivery:projects:edit:own",
      "dealToDelivery:projects:close",
      "dealToDelivery:tasks:create",
      "dealToDelivery:tasks:assign",
      "dealToDelivery:tasks:delete",
      "dealToDelivery:tasks:view:all",
      "dealToDelivery:tasks:edit:all",
      "dealToDelivery:budgets:view:own",
      "dealToDelivery:changeOrders:request",
      "dealToDelivery:resources:view:team",
      "dealToDelivery:resources:book:team",
      "dealToDelivery:time:view:team",
      "dealToDelivery:time:edit:all",
      "dealToDelivery:time:approve",
      "dealToDelivery:expenses:view:team",
      "dealToDelivery:expenses:approve",
      "dealToDelivery:reports:view:own",
    ],
  },
  {
    name: PSA_ROLES.RESOURCE_MANAGER,
    description: "Resource Manager - Scheduling, availability management",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:projects:view:all",
      "dealToDelivery:tasks:view:all",
      "dealToDelivery:resources:view:all",
      "dealToDelivery:resources:book:all",
      "dealToDelivery:resources:confirm",
      "dealToDelivery:resources:timeoff:approve",
      "dealToDelivery:time:view:all",
      "dealToDelivery:reports:view:own",
    ],
  },
  {
    name: PSA_ROLES.FINANCE,
    description: "Finance/Accountant - Invoicing, revenue recognition",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:projects:view:all",
      "dealToDelivery:budgets:view:all",
      "dealToDelivery:time:view:all",
      "dealToDelivery:expenses:view:all",
      "dealToDelivery:invoices:create",
      "dealToDelivery:invoices:edit",
      "dealToDelivery:invoices:finalize",
      "dealToDelivery:invoices:send",
      "dealToDelivery:invoices:void",
      "dealToDelivery:invoices:view:all",
      "dealToDelivery:payments:view",
      "dealToDelivery:payments:record",
      "dealToDelivery:reports:profitability",
      "dealToDelivery:reports:view:all",
    ],
  },
  {
    name: PSA_ROLES.SALES_REP,
    description: "Sales Rep - Deal management, proposal creation",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:deals:create",
      "dealToDelivery:deals:qualify",
      "dealToDelivery:deals:negotiate",
      "dealToDelivery:deals:close",
      "dealToDelivery:deals:view:own",
      "dealToDelivery:deals:edit:own",
      "dealToDelivery:proposals:create",
      "dealToDelivery:proposals:edit",
      "dealToDelivery:proposals:send",
      "dealToDelivery:proposals:view:own",
      "dealToDelivery:reports:forecasting",
    ],
  },
  {
    name: PSA_ROLES.TEAM_MEMBER,
    description: "Team Member - Time tracking, task completion",
    scopes: [
      "dealToDelivery:staff",
      "dealToDelivery:projects:view:own",
      "dealToDelivery:tasks:view:own",
      "dealToDelivery:resources:view:own",
      "dealToDelivery:resources:timeoff:own",
      "dealToDelivery:time:view:own",
      "dealToDelivery:time:create:own",
      "dealToDelivery:time:edit:own",
      "dealToDelivery:time:submit",
      "dealToDelivery:expenses:view:own",
      "dealToDelivery:expenses:create",
      "dealToDelivery:expenses:edit:own",
      "dealToDelivery:expenses:submit",
    ],
  },
  {
    name: PSA_ROLES.CLIENT,
    description: "Client (External) - Limited portal access",
    scopes: [
      "dealToDelivery:projects:view:own",
      "dealToDelivery:tasks:view:own",
      "dealToDelivery:budgets:view:own",
      "dealToDelivery:invoices:view:own",
    ],
  },
];

/**
 * Role-to-Group Assignments
 */
const roleGroupAssignments = [
  // Executives group
  { role: PSA_ROLES.CEO, group: PSA_GROUPS.EXECUTIVES },
  { role: PSA_ROLES.ADMIN, group: PSA_GROUPS.EXECUTIVES },
  // Managers group
  { role: PSA_ROLES.PROJECT_MANAGER, group: PSA_GROUPS.MANAGERS },
  { role: PSA_ROLES.OPERATIONS_MANAGER, group: PSA_GROUPS.MANAGERS },
  // Finance group
  { role: PSA_ROLES.FINANCE, group: PSA_GROUPS.FINANCE },
  // Sales group
  { role: PSA_ROLES.SALES_REP, group: PSA_GROUPS.SALES },
  // Delivery group
  { role: PSA_ROLES.TEAM_MEMBER, group: PSA_GROUPS.DELIVERY },
  // Resource managers group
  { role: PSA_ROLES.RESOURCE_MANAGER, group: PSA_GROUPS.RESOURCE_MANAGERS },
  { role: PSA_ROLES.OPERATIONS_MANAGER, group: PSA_GROUPS.RESOURCE_MANAGERS },
  // Approvers group
  { role: PSA_ROLES.PROJECT_MANAGER, group: PSA_GROUPS.APPROVERS },
  { role: PSA_ROLES.OPERATIONS_MANAGER, group: PSA_GROUPS.APPROVERS },
  { role: PSA_ROLES.FINANCE, group: PSA_GROUPS.APPROVERS },
];

/**
 * Setup PSA Platform Authorization
 * Creates groups, roles, and assigns roles to groups.
 *
 * This is an idempotent operation - safe to run multiple times.
 */
export const setupPsaAuthorization = internalMutation({
  handler: async (ctx) => {
    const groupMap: Record<string, string> = {};
    const roleMap: Record<string, string> = {};

    // Create groups
    for (const groupDef of authGroups) {
      try {
        // Check if group already exists
        const existing = await ctx.runQuery(
          components.tasquencerAuthorization.api.getAuthGroupByName,
          { name: groupDef.name }
        );

        if (existing) {
          groupMap[groupDef.name] = existing._id;
        } else {
          const groupId = await ctx.runMutation(
            components.tasquencerAuthorization.api.createAuthGroup,
            {
              name: groupDef.name,
              description: groupDef.description,
            }
          );
          groupMap[groupDef.name] = groupId;
        }
      } catch (error: unknown) {
        console.error(`Error creating group ${groupDef.name}:`, error);
      }
    }

    // Create roles
    for (const roleDef of authRoles) {
      try {
        // Check if role already exists
        const existing = await ctx.runQuery(
          components.tasquencerAuthorization.api.getAuthRoleByName,
          { name: roleDef.name }
        );

        if (existing) {
          roleMap[roleDef.name] = existing._id;
          // Update scopes if they've changed
          await ctx.runMutation(
            components.tasquencerAuthorization.api.updateAuthRole,
            {
              roleId: existing._id,
              scopes: roleDef.scopes,
            }
          );
        } else {
          const roleId = await ctx.runMutation(
            components.tasquencerAuthorization.api.createAuthRole,
            {
              name: roleDef.name,
              description: roleDef.description,
              scopes: roleDef.scopes,
            }
          );
          roleMap[roleDef.name] = roleId;
        }
      } catch (error: unknown) {
        console.error(`Error creating role ${roleDef.name}:`, error);
      }
    }

    // Assign roles to groups
    let assignmentCount = 0;
    for (const assignment of roleGroupAssignments) {
      const groupId = groupMap[assignment.group];
      const roleId = roleMap[assignment.role];

      if (!groupId || !roleId) continue;

      try {
        await ctx.runMutation(
          components.tasquencerAuthorization.api.assignAuthRoleToGroup,
          {
            groupId,
            roleId,
          }
        );
        assignmentCount++;
      } catch (error: unknown) {
        // Skip if already assigned
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes("already assigned")) {
          console.error(
            `Error assigning role ${assignment.role} to group ${assignment.group}:`,
            error
          );
        }
      }
    }

    return {
      groups: Object.keys(groupMap).length,
      roles: Object.keys(roleMap).length,
      assignments: assignmentCount,
      groupMap,
      roleMap,
    };
  },
});
