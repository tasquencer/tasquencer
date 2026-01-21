/**
 * CreateAndAssignTasks Work Item
 *
 * Creates project tasks and assigns them to team members.
 *
 * Entry condition: Project status = "Active", resources allocated
 * Exit condition: Tasks created with status = "Todo", assignees notified
 *
 * Reference: .review/recipes/psa-platform/specs/06-workflow-execution-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import {
  initializeDealWorkItemAuth,
  updateWorkItemMetadataPayload,
  initializeWorkItemWithProjectAuth,
} from "./helpersAuth";
import { authService } from "../../../authorization";
import { getProject } from "../db/projects";
import { insertTask, getNextTaskSortOrder } from "../db/tasks";
import { getUser } from "../db/users";
import { getRootWorkflowAndProjectForWorkItem } from "../db/workItemContext";
import {
  insertNotification,
  generateTaskAssignmentContent,
} from "../db/notifications";
import { assertProjectExists, assertUserExists } from "../exceptions";
import type { Id } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:tasks:create' scope
const tasksCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:tasks:create"
);

/**
 * Actions for the createAndAssignTasks work item.
 *
 * - initialize: Sets up work item metadata with project context
 * - start: Claims the work item for the current user
 * - complete: Creates tasks and assigns them to team members
 * - fail: Marks the work item as failed
 */
const createAndAssignTasksWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    tasksCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:tasks:create",
        dealId: project.dealId!,
        payload: {
          type: "createAndAssignTasks",
          taskName: "Create and Assign Tasks",
          priority: "high",
        },
      });
    }
  )
  .start(z.never(), tasksCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      tasks: z.array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional().default(""),
          assigneeIds: z.array(zid("users")).min(1),
          estimatedHours: z.number().min(0),
          dueDate: z.number().optional(),
          priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
        })
      ),
      // Execution strategy for the executeProjectWork dynamic composite task
      // - "sequential": Tasks executed one at a time in order (default, safest)
      // - "parallel": Independent tasks executed concurrently (best for multiple resources)
      // - "conditional": Branch-based execution (e.g., budget-dependent paths)
      executionStrategy: z.enum(["sequential", "parallel", "conditional"]).optional().default("sequential"),
    }),
    tasksCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const { project } = await getRootWorkflowAndProjectForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (project._id !== payload.projectId) {
        throw new Error(
          `Project mismatch: expected ${project._id}, got ${payload.projectId}`
        );
      }

      const createdTaskIds: Id<"tasks">[] = [];
      let sortOrder = await getNextTaskSortOrder(mutationCtx.db, project._id);
      const now = Date.now();

      // Create tasks
      for (const taskInput of payload.tasks) {
        // Verify all assignees exist
        for (const assigneeId of taskInput.assigneeIds) {
          const user = await getUser(mutationCtx.db, assigneeId);
          assertUserExists(user, { userId: assigneeId });
        }

        // Create the task
        const taskId = await insertTask(mutationCtx.db, {
          projectId: project._id,
          organizationId: project.organizationId,
          name: taskInput.name,
          description: taskInput.description || "",
          status: "Todo",
          assigneeIds: taskInput.assigneeIds,
          dueDate: taskInput.dueDate,
          estimatedHours: taskInput.estimatedHours,
          priority: taskInput.priority || "Medium",
          dependencies: [],
          sortOrder,
          createdAt: now,
        });

        createdTaskIds.push(taskId);
        sortOrder++;
      }

      // Send notifications to assignees about new tasks
      for (let i = 0; i < payload.tasks.length; i++) {
        const taskInput = payload.tasks[i];
        const taskId = createdTaskIds[i];
        const content = generateTaskAssignmentContent(taskInput.name);

        for (const assigneeId of taskInput.assigneeIds) {
          await insertNotification(mutationCtx.db, {
            organizationId: project.organizationId,
            userId: assigneeId,
            type: "task_assigned",
            resourceType: "task",
            resourceId: taskId,
            title: content.title,
            message: content.message,
            data: {
              taskName: taskInput.name,
              projectId: project._id,
              dueDate: taskInput.dueDate,
              priority: taskInput.priority,
            },
          });
        }
      }

      // Store the execution strategy in work item metadata for the dynamic composite task
      // The executeProjectWork task's onEnabled will read this to select the appropriate workflow
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "createAndAssignTasks",
        taskName: "Create and Assign Tasks",
        priority: "high",
        executionStrategy: payload.executionStrategy,
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), tasksCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createAndAssignTasks work item with actions and lifecycle activities.
 */
export const createAndAssignTasksWorkItem = Builder.workItem("createAndAssignTasks")
  .withActions(createAndAssignTasksWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createAndAssignTasks task.
 */
export const createAndAssignTasksTask = Builder.task(createAndAssignTasksWorkItem)
  .withActivities({
    onEnabled: async ({ workItem, mutationCtx, parent }) => {
      await initializeWorkItemWithProjectAuth(mutationCtx, parent.workflow, workItem);
    },
  });
