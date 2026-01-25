/**
 * FilterBySkillsRole Work Item
 *
 * Filters team availability by skills, roles, departments, and locations.
 * Helps resource managers find the best-fit team members for a project.
 *
 * Reference: .review/recipes/psa-platform/specs/05-workflow-resource-planning.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithProjectAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { listActiveUsersByOrganization } from "../db/users";
import { calculateUserBookedHours } from "../db/bookings";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import { assertProjectExists } from "../exceptions";

// Policy: Requires 'dealToDelivery:resources:view:team' scope
const resourcesViewPolicy = authService.policies.requireScope(
  "dealToDelivery:resources:view:team"
);

/**
 * Actions for the filterBySkillsRole work item.
 */
const filterBySkillsRoleWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    resourcesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:resources:view:team",
        dealId: project.dealId!,
        payload: {
          type: "filterBySkillsRole",
          taskName: "Filter by Skills/Role",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), resourcesViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      filters: z.object({
        skills: z.array(z.string()).optional(),
        roles: z.array(z.string()).optional(),
        departments: z.array(z.string()).optional(),
        locations: z.array(z.string()).optional(),
        minAvailability: z.number().min(0).max(100).optional(),
      }),
      startDate: z.number(),
      endDate: z.number(),
    }),
    resourcesViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      // Get all active users
      let users = await listActiveUsersByOrganization(
        mutationCtx.db,
        project.organizationId
      );

      // Apply filters
      if (payload.filters.skills && payload.filters.skills.length > 0) {
        users = users.filter((u) =>
          payload.filters.skills!.some((skill) => u.skills.includes(skill))
        );
      }

      if (payload.filters.roles && payload.filters.roles.length > 0) {
        users = users.filter((u) => payload.filters.roles!.includes(u.role));
      }

      if (payload.filters.departments && payload.filters.departments.length > 0) {
        users = users.filter((u) =>
          payload.filters.departments!.includes(u.department)
        );
      }

      if (payload.filters.locations && payload.filters.locations.length > 0) {
        users = users.filter((u) =>
          payload.filters.locations!.includes(u.location)
        );
      }

      // Calculate availability and filter by minimum availability if specified
      const standardWorkingHoursPerDay = 8;
      const totalDays =
        Math.ceil(
          (payload.endDate - payload.startDate) / (24 * 60 * 60 * 1000)
        ) + 1;
      const totalStandardHours = totalDays * standardWorkingHoursPerDay;

      const _filteredUsers = await Promise.all(
        users.map(async (user) => {
          const bookedHours = await calculateUserBookedHours(
            mutationCtx.db,
            user._id,
            payload.startDate,
            payload.endDate
          );

          const availabilityPercent =
            totalStandardHours > 0
              ? Math.round(
                  ((totalStandardHours - bookedHours) / totalStandardHours) * 100
                )
              : 0;

          return {
            user,
            bookedHours,
            availabilityPercent,
          };
        })
      );

      // Filter by minimum availability if specified
      const finalUsers =
        payload.filters.minAvailability !== undefined
          ? _filteredUsers.filter(
              (u) => u.availabilityPercent >= payload.filters.minAvailability!
            )
          : _filteredUsers;

      // Sort by skill match (users with more matching skills first) then by availability
      const sortedUsers = [...finalUsers].sort((a, b) => {
        // First by skill match count
        const aSkillMatch = payload.filters.skills
          ? payload.filters.skills.filter((s) => a.user.skills.includes(s)).length
          : 0;
        const bSkillMatch = payload.filters.skills
          ? payload.filters.skills.filter((s) => b.user.skills.includes(s)).length
          : 0;

        if (bSkillMatch !== aSkillMatch) {
          return bSkillMatch - aSkillMatch; // More matches first
        }

        // Then by availability
        return b.availabilityPercent - a.availabilityPercent; // Higher availability first
      });

      // In a real implementation, sortedUsers would be returned to the UI
      void sortedUsers;

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), resourcesViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The filterBySkillsRole work item with actions and lifecycle activities.
 */
export const filterBySkillsRoleWorkItem = Builder.workItem("filterBySkillsRole")
  .withActions(filterBySkillsRoleWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The filterBySkillsRole task.
 * The onEnabled hook automatically initializes the work item with project context.
 */
export const filterBySkillsRoleTask = Builder.task(filterBySkillsRoleWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
  },
});
