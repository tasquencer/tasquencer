/**
 * ConductRetro Work Item
 *
 * Document retrospective learnings from the project.
 *
 * Entry condition: Project has been closed
 * Exit condition: Retrospective documented, project scorecard calculated
 *
 * Reference: .review/recipes/psa-platform/specs/13-workflow-close-phase.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import type { Id } from "../../../_generated/dataModel";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";
import {
  insertLessonsFromRetrospective,
  createProjectScorecard,
} from "../db/lessonsLearned";
import { getBudgetByProjectId } from "../db/budgets";
import { calculateProjectHours } from "../db/timeEntries";
import { calculateProjectExpenses } from "../db/expenses";
import { listInvoicesByProject } from "../db/invoices";

// Policy: Requires 'dealToDelivery:projects:view:own' scope
const projectsViewPolicy = authService.policies.requireScope(
  "dealToDelivery:projects:view:own"
);

const retroCategory = z.enum(["timeline", "budget", "quality", "communication", "process", "other"]);
const retroImpact = z.enum(["high", "medium", "low"]);

/**
 * Actions for the conductRetro work item.
 */
const conductRetroWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    projectsViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Get deal from workflow context for metadata
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItemId
      );

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:projects:view:own",
        dealId: deal._id,
        payload: {
          type: "conductRetro",
          taskName: "Conduct Retrospective",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), projectsViewPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      retrospective: z.object({
        successes: z.array(z.object({
          category: retroCategory,
          description: z.string(),
          impact: retroImpact,
        })),
        improvements: z.array(z.object({
          category: retroCategory,
          description: z.string(),
          impact: retroImpact,
          recommendation: z.string().optional(),
        })),
        keyLearnings: z.array(z.string()),
        recommendations: z.array(z.string()),
        clientSatisfaction: z.object({
          rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
          feedback: z.string().optional(),
          wouldRecommend: z.boolean().optional(),
          testimonialProvided: z.boolean().optional(),
        }).optional(),
        teamFeedback: z.array(z.object({
          userId: zid("users"),
          feedback: z.string(),
          anonymous: z.boolean(),
        })).optional(),
      }),
      participants: z.array(zid("users")).optional(),
    }),
    projectsViewPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "conductRetro:complete",
        workItemId: workItem.id,
      });

      // Validate project exists
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      // 1. Store lessons learned from retrospective
      // Cast to the domain layer types (same structure, different literal types)
      const userId = authUser.userId as Id<"users"> | null;
      if (!userId) {
        throw new Error("User ID is required for retrospective");
      }
      const lessonsCount = await insertLessonsFromRetrospective(
        mutationCtx.db,
        payload.projectId,
        project.organizationId,
        userId,
        payload.retrospective.successes as Array<{
          category: "timeline" | "budget" | "quality" | "communication" | "process" | "other";
          description: string;
          impact: "high" | "medium" | "low";
        }>,
        payload.retrospective.improvements as Array<{
          category: "timeline" | "budget" | "quality" | "communication" | "process" | "other";
          description: string;
          impact: "high" | "medium" | "low";
          recommendation?: string;
        }>
      );

      // 2. Calculate project metrics for scorecard
      const budget = await getBudgetByProjectId(mutationCtx.db, project._id);
      const hours = await calculateProjectHours(mutationCtx.db, project._id);
      const expenses = await calculateProjectExpenses(mutationCtx.db, project._id);
      const invoices = await listInvoicesByProject(mutationCtx.db, project._id);

      // Calculate revenue and costs
      const revenue = invoices
        .filter((i) => i.status === "Paid" || i.status === "Sent" || i.status === "Viewed")
        .reduce((sum, i) => sum + i.total, 0);

      // Estimate labor cost (using approved hours * average rate from budget)
      const budgetTotal = budget?.totalAmount ?? 0;
      const avgRate = hours.total > 0 && budgetTotal > 0 ? budgetTotal / hours.total : 0;
      const laborCost = hours.approved * avgRate * 0.6; // 60% of bill rate is cost
      const totalCost = laborCost + expenses.approved;
      const profitMargin = revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : 0;

      // 3. Create project scorecard
      await createProjectScorecard(
        mutationCtx.db,
        payload.projectId,
        project.organizationId,
        {
          actualEndDate: project.endDate ?? Date.now(),
          // Per spec 13 line 248-252: use plannedEndDate for original planned end date
          plannedEndDate: project.plannedEndDate ?? project.endDate ?? Date.now(),
          actualCost: totalCost,
          budgetedCost: budgetTotal,
          profitMargin,
          clientSatisfactionRating: payload.retrospective.clientSatisfaction?.rating,
          clientFeedback: payload.retrospective.clientSatisfaction?.feedback,
          wouldRecommend: payload.retrospective.clientSatisfaction?.wouldRecommend,
          testimonialProvided: payload.retrospective.clientSatisfaction?.testimonialProvided,
          retroParticipants: payload.participants,
          keyLearnings: payload.retrospective.keyLearnings,
          recommendations: payload.retrospective.recommendations,
        }
      );

      // Log completion
      console.log(
        `Retrospective completed for project ${payload.projectId}: ` +
          `${lessonsCount} lessons recorded, scorecard created`
      );

      // Update metadata
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "conductRetro",
        taskName: "Conduct Retrospective",
        priority: "normal",
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), projectsViewPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The conductRetro work item with actions and lifecycle activities.
 */
export const conductRetroWorkItem = Builder.workItem("conductRetro")
  .withActions(conductRetroWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The conductRetro task.
 */
export const conductRetroTask = Builder.task(conductRetroWorkItem);
