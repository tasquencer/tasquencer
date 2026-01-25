/**
 * PSA Platform Superadmin Bootstrap
 *
 * Scaffolds initial superadmin access for the first user.
 * This is an idempotent operation - safe to run multiple times.
 *
 * Reference: examples/er/convex/scaffold.ts
 * Spec: .review/recipes/psa-platform/specs/02-authorization.md
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { authService } from "./authorization";
import { components, internal } from "./_generated/api";
import { listAllUsers, getUserByEmailAnyOrg } from "./scaffold/helpers";
import {
  insertCompany,
  insertContact,
  getDealByWorkflowId,
  getProjectByDealId,
  listBookingsByProject,
} from "./workflows/dealToDelivery/db";
import {
  getChildWorkflow,
  getTaskByWorkflowAndName,
  listWorkItemsByParentTask,
} from "./workflows/dealToDelivery/db/workflows";

/**
 * Bootstrap superadmin role for the first user.
 *
 * This function:
 * 1. Verifies exactly one user exists (initial bootstrap scenario)
 * 2. Collects all scopes from the authService (code-defined)
 * 3. Creates or updates the "superadmin" role with all scopes
 * 4. Assigns the role to the user
 *
 * Idempotent: If the role exists, it syncs scopes to match code.
 * If the user already has the role, it's a no-op.
 */
export const scaffoldSuperadmin = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1. Check if there's exactly one user (initial bootstrap)
    const users = await listAllUsers(ctx.db);
    if (users.length !== 1) {
      throw new Error(
        `Expected exactly 1 user for initial bootstrap, found ${users.length}. ` +
          `This function should only be run during initial setup.`
      );
    }
    const user = users[0];

    // 2. Get all registered scopes from authService (dynamically from code)
    const allScopes = Object.keys(authService.scopes);

    // 3. Check if superadmin role already exists
    const existingRole = await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthRoleByName,
      { name: "superadmin" }
    );

    let roleId: string;
    let created = false;
    let synced = false;

    if (existingRole) {
      // Role exists - sync scopes to match code-defined scopes
      await ctx.runMutation(
        components.tasquencerAuthorization.api.updateAuthRole,
        { roleId: existingRole._id, scopes: allScopes }
      );
      roleId = existingRole._id;
      synced = true;
    } else {
      // Create new superadmin role with all scopes
      roleId = await ctx.runMutation(
        components.tasquencerAuthorization.api.createAuthRole,
        {
          name: "superadmin",
          description: "Full access to all system and workflow scopes",
          scopes: allScopes,
        }
      );
      created = true;
    }

    // 4. Check if user already has the superadmin role
    const existingAssignments = await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthRoleAssignments,
      { userId: user._id }
    );

    const hasSuperadminRole = existingAssignments.some(
      (assignment) => assignment.roleId === roleId
    );

    let assigned = false;
    if (!hasSuperadminRole) {
      // Assign superadmin role directly to user
      await ctx.runMutation(
        components.tasquencerAuthorization.api.assignAuthRoleToUser,
        { userId: user._id, roleId: roleId }
      );
      assigned = true;
    }

    return {
      userId: user._id,
      userEmail: user.email,
      roleId,
      scopeCount: allScopes.length,
      created,
      synced,
      assigned,
    };
  },
});

/**
 * Bootstrap superadmin for a specific user by email.
 *
 * Use this when you need to grant superadmin to a specific user
 * in a multi-user environment, or when the single-user check
 * doesn't apply.
 */
export const scaffoldSuperadminForUser = internalMutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Find user by email
    const user = await getUserByEmailAnyOrg(ctx.db, args.email);

    if (!user) {
      throw new Error(`User with email ${args.email} not found`);
    }

    // 2. Get all registered scopes from authService
    const allScopes = Object.keys(authService.scopes);

    // 3. Check if superadmin role already exists
    const existingRole = await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthRoleByName,
      { name: "superadmin" }
    );

    let roleId: string;
    let created = false;
    let synced = false;

    if (existingRole) {
      // Role exists - sync scopes
      await ctx.runMutation(
        components.tasquencerAuthorization.api.updateAuthRole,
        { roleId: existingRole._id, scopes: allScopes }
      );
      roleId = existingRole._id;
      synced = true;
    } else {
      // Create new superadmin role
      roleId = await ctx.runMutation(
        components.tasquencerAuthorization.api.createAuthRole,
        {
          name: "superadmin",
          description: "Full access to all system and workflow scopes",
          scopes: allScopes,
        }
      );
      created = true;
    }

    // 4. Check existing assignments
    const existingAssignments = await ctx.runQuery(
      components.tasquencerAuthorization.api.getUserAuthRoleAssignments,
      { userId: user._id }
    );

    const hasSuperadminRole = existingAssignments.some(
      (assignment) => assignment.roleId === roleId
    );

    let assigned = false;
    if (!hasSuperadminRole) {
      await ctx.runMutation(
        components.tasquencerAuthorization.api.assignAuthRoleToUser,
        { userId: user._id, roleId: roleId }
      );
      assigned = true;
    }

    return {
      userId: user._id,
      userEmail: user.email,
      roleId,
      scopeCount: allScopes.length,
      created,
      synced,
      assigned,
    };
  },
});

/**
 * Sync superadmin role scopes with code-defined scopes.
 *
 * Use this after adding new scopes to the authService to
 * ensure the superadmin role has all permissions.
 */
export const syncSuperadminScopes = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all registered scopes
    const allScopes = Object.keys(authService.scopes);

    // Find superadmin role
    const existingRole = await ctx.runQuery(
      components.tasquencerAuthorization.api.getAuthRoleByName,
      { name: "superadmin" }
    );

    if (!existingRole) {
      throw new Error(
        "Superadmin role not found. Run scaffoldSuperadmin first."
      );
    }

    // Update role scopes
    await ctx.runMutation(
      components.tasquencerAuthorization.api.updateAuthRole,
      { roleId: existingRole._id, scopes: allScopes }
    );

    return {
      roleId: existingRole._id,
      scopeCount: allScopes.length,
      synced: true,
    };
  },
});

/**
 * Seed a deal workflow up to execution task assignment for QA.
 * This fast-forwards the workflow so execution tasks appear in the work queue.
 */
export const seedDealToExecution = internalMutation({
  args: {
    ownerEmail: v.optional(v.string()),
    assigneeEmail: v.optional(v.string()),
    executionStrategy: v.optional(
      v.union(
        v.literal("sequential"),
        v.literal("parallel"),
        v.literal("conditional")
      )
    ),
  },
  handler: async (ctx, args) => {
    const users = await listAllUsers(ctx.db);
    const owner =
      args.ownerEmail !== undefined
        ? await getUserByEmailAnyOrg(ctx.db, args.ownerEmail)
        : users.length === 1
          ? users[0]
          : null;

    if (!owner) {
      throw new Error(
        "Owner user not found. Provide ownerEmail or ensure a single user exists."
      );
    }

    const assignee =
      args.assigneeEmail !== undefined
        ? await getUserByEmailAnyOrg(ctx.db, args.assigneeEmail)
        : owner;

    if (!assignee) {
      throw new Error(
        `Assignee user not found for ${args.assigneeEmail ?? "ownerEmail"}.`
      );
    }

    const companyId = await insertCompany(ctx.db, {
      organizationId: owner.organizationId,
      name: "QA Seed Company",
      billingAddress: {
        street: "123 Seed St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94102",
        country: "USA",
      },
      paymentTerms: 30,
    });

    const contactId = await insertContact(ctx.db, {
      organizationId: owner.organizationId,
      companyId,
      name: "QA Seed Contact",
      email: "seed-contact@example.com",
      phone: "+1-555-0100",
      isPrimary: true,
    });

    const rootWorkflowId = (await ctx.runMutation(
      internal.workflows.dealToDelivery.api.workflow.internalInitializeRootWorkflow,
      {
        payload: {},
      }
    )) as Id<"tasquencerWorkflows">;

    const getChildWorkflowId = async (
      parentWorkflowId: Id<"tasquencerWorkflows">,
      parentTaskName: string,
      workflowName: string,
      path: string[]
    ) => {
      const parentTask = await getTaskByWorkflowAndName(
        ctx.db,
        parentWorkflowId,
        parentTaskName
      );
      if (!parentTask) {
        throw new Error(
          `Task ${parentTaskName} not found in workflow ${parentWorkflowId}`
        );
      }

      const existingWorkflow = await getChildWorkflow(
        ctx.db,
        parentWorkflowId,
        parentTaskName,
        parentTask.generation,
        workflowName
      );

      if (existingWorkflow) {
        return existingWorkflow._id;
      }

      return (await ctx.runMutation(
        internal.workflows.dealToDelivery.api.workflow.internalInitializeWorkflow,
        {
          target: {
            path,
            parentWorkflowId,
            parentTaskName,
          },
          args: { name: workflowName as never, payload: {} },
        }
      )) as Id<"tasquencerWorkflows">;
    };

    const getOrInitializeWorkItem = async (
      parentWorkflowId: Id<"tasquencerWorkflows">,
      taskName: string,
      path: string[],
      initPayload: Record<string, unknown>
    ) => {
      const workItems = await listWorkItemsByParentTask(
        ctx.db,
        parentWorkflowId,
        taskName
      );
      const active = workItems
        .filter(
          (item) =>
            item.state !== "completed" &&
            item.state !== "failed" &&
            item.state !== "canceled"
        )
        .sort((a, b) => b._creationTime - a._creationTime);

      if (active.length > 0) {
        return { workItemId: active[0]._id, state: active[0].state };
      }

      const workItemId = await ctx.runMutation(
        internal.workflows.dealToDelivery.api.workflow.internalInitializeWorkItem,
        {
          target: {
            path,
            parentWorkflowId,
            parentTaskName: taskName,
          },
          args: { name: taskName as never, payload: initPayload },
        }
      );
      return { workItemId, state: "initialized" as const };
    };

    const completeWorkItem = async (
      parentWorkflowId: Id<"tasquencerWorkflows">,
      taskName: string,
      path: string[],
      initPayload: Record<string, unknown>,
      completePayload: Record<string, unknown>
    ) => {
      const { workItemId, state } = await getOrInitializeWorkItem(
        parentWorkflowId,
        taskName,
        path,
        initPayload
      );

      if (state === "initialized") {
        await ctx.runMutation(
          internal.workflows.dealToDelivery.api.workflow.internalStartWorkItem,
          {
            workItemId,
            args: { name: taskName as never },
          }
        );
      }

      await ctx.runMutation(
        internal.workflows.dealToDelivery.api.workflow.internalCompleteWorkItem,
        {
          workItemId,
          args: { name: taskName as never, payload: completePayload },
        }
      );

      return workItemId;
    };

    const salesWorkflowId = await getChildWorkflowId(
      rootWorkflowId,
      "sales",
      "salesPhase",
      ["dealToDelivery", "sales", "salesPhase"]
    );

    await completeWorkItem(
      salesWorkflowId,
      "createDeal",
      ["dealToDelivery", "sales", "salesPhase", "createDeal", "createDeal"],
      {},
      {
        organizationId: owner.organizationId,
        companyId,
        contactId,
        name: "QA Seed Deal",
        value: 875000,
        ownerId: owner._id,
      }
    );

    const deal = await getDealByWorkflowId(ctx.db, rootWorkflowId);
    if (!deal) {
      throw new Error("Failed to locate seeded deal.");
    }

    await completeWorkItem(
      salesWorkflowId,
      "qualifyLead",
      ["dealToDelivery", "sales", "salesPhase", "qualifyLead", "qualifyLead"],
      { dealId: deal._id },
      {
        dealId: deal._id,
        qualified: true,
        qualificationNotes: "Seeded qualification",
        budget: true,
        authority: true,
        need: true,
        timeline: true,
      }
    );

    await completeWorkItem(
      salesWorkflowId,
      "createEstimate",
      ["dealToDelivery", "sales", "salesPhase", "createEstimate", "createEstimate"],
      { dealId: deal._id },
      {
        dealId: deal._id,
        services: [
          { name: "Discovery", hours: 20, rate: 12000 },
          { name: "Delivery", hours: 60, rate: 15000 },
        ],
        notes: "Seeded estimate",
      }
    );

    await completeWorkItem(
      salesWorkflowId,
      "createProposal",
      ["dealToDelivery", "sales", "salesPhase", "createProposal", "createProposal"],
      { dealId: deal._id },
      {
        dealId: deal._id,
        documentUrl: "https://example.com/qa-proposal.pdf",
      }
    );

    await completeWorkItem(
      salesWorkflowId,
      "sendProposal",
      ["dealToDelivery", "sales", "salesPhase", "sendProposal", "sendProposal"],
      { dealId: deal._id },
      { dealId: deal._id }
    );

    await completeWorkItem(
      salesWorkflowId,
      "negotiateTerms",
      ["dealToDelivery", "sales", "salesPhase", "negotiateTerms", "negotiateTerms"],
      { dealId: deal._id },
      {
        dealId: deal._id,
        outcome: "proceed",
        negotiationNotes: "Seeded negotiation",
      }
    );

    await completeWorkItem(
      salesWorkflowId,
      "getProposalSigned",
      ["dealToDelivery", "sales", "salesPhase", "getProposalSigned", "getProposalSigned"],
      { dealId: deal._id },
      {
        dealId: deal._id,
        signedAt: Date.now(),
      }
    );

    const planningWorkflowId = await getChildWorkflowId(
      rootWorkflowId,
      "planning",
      "planningPhase",
      ["dealToDelivery", "planning", "planningPhase"]
    );

    await completeWorkItem(
      planningWorkflowId,
      "createProject",
      ["dealToDelivery", "planning", "planningPhase", "createProject", "createProject"],
      { dealId: deal._id },
      { dealId: deal._id }
    );

    const project = await getProjectByDealId(ctx.db, deal._id);
    if (!project || !project.budgetId) {
      throw new Error("Project or budget not found after createProject.");
    }

    await completeWorkItem(
      planningWorkflowId,
      "setBudget",
      ["dealToDelivery", "planning", "planningPhase", "setBudget", "setBudget"],
      { dealId: deal._id },
      {
        budgetId: project.budgetId,
        type: "TimeAndMaterials",
        services: [
          { name: "Development", rate: 12000, estimatedHours: 80 },
          { name: "QA", rate: 10000, estimatedHours: 20 },
        ],
      }
    );

    const resourceWorkflowId = await getChildWorkflowId(
      planningWorkflowId,
      "allocateResources",
      "resourcePlanning",
      ["dealToDelivery", "planning", "planningPhase", "allocateResources", "resourcePlanning"]
    );

    const startDate = Date.now();
    const endDate = startDate + 14 * 24 * 60 * 60 * 1000;

    await completeWorkItem(
      resourceWorkflowId,
      "viewTeamAvailability",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "viewTeamAvailability",
        "viewTeamAvailability",
      ],
      { projectId: project._id },
      { projectId: project._id, startDate, endDate }
    );

    await completeWorkItem(
      resourceWorkflowId,
      "filterBySkillsRole",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "filterBySkillsRole",
        "filterBySkillsRole",
      ],
      { projectId: project._id },
      { projectId: project._id, filters: {}, startDate, endDate }
    );

    await completeWorkItem(
      resourceWorkflowId,
      "recordPlannedTimeOff",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "recordPlannedTimeOff",
        "recordPlannedTimeOff",
      ],
      { projectId: project._id },
      {
        userId: assignee._id,
        startDate,
        endDate,
        type: "Personal",
        hoursPerDay: 0,
      }
    );

    await completeWorkItem(
      resourceWorkflowId,
      "createBookings",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "createBookings",
        "createBookings",
      ],
      { projectId: project._id },
      {
        projectId: project._id,
        bookings: [
          {
            userId: assignee._id,
            startDate,
            endDate,
            hoursPerDay: 8,
            notes: "Seeded allocation",
          },
        ],
        isConfirmed: true,
      }
    );

    const bookings = await listBookingsByProject(ctx.db, project._id);
    const bookingIds = bookings.map((booking) => booking._id);

    await completeWorkItem(
      resourceWorkflowId,
      "reviewBookings",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "reviewBookings",
        "reviewBookings",
      ],
      { projectId: project._id },
      { projectId: project._id, bookingIds }
    );

    await completeWorkItem(
      resourceWorkflowId,
      "checkConfirmationNeeded",
      [
        "dealToDelivery",
        "planning",
        "planningPhase",
        "allocateResources",
        "resourcePlanning",
        "checkConfirmationNeeded",
        "checkConfirmationNeeded",
      ],
      { projectId: project._id },
      { bookingIds }
    );

    const executionWorkflowId = await getChildWorkflowId(
      rootWorkflowId,
      "execution",
      "executionPhase",
      ["dealToDelivery", "execution", "executionPhase"]
    );

    const executionStrategy = args.executionStrategy ?? "sequential";

    await completeWorkItem(
      executionWorkflowId,
      "createAndAssignTasks",
      [
        "dealToDelivery",
        "execution",
        "executionPhase",
        "createAndAssignTasks",
        "createAndAssignTasks",
      ],
      { projectId: project._id },
      {
        projectId: project._id,
        executionStrategy,
        tasks: [
          {
            name: "Seeded Task A",
            description: "Auto-generated task for QA",
            assigneeIds: [assignee._id],
            estimatedHours: 8,
            priority: "High",
          },
          {
            name: "Seeded Task B",
            description: "Auto-generated task for QA",
            assigneeIds: [assignee._id],
            estimatedHours: 6,
            priority: "Medium",
          },
        ],
      }
    );

    return {
      workflowId: rootWorkflowId,
      dealId: deal._id,
      projectId: project._id,
      executionStrategy,
      ownerId: owner._id,
      assigneeId: assignee._id,
    };
  },
});
