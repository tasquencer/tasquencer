/**
 * Database functions for lessons learned and project scorecards
 *
 * These domain functions support the Close Phase workflow for documenting
 * retrospective learnings and project performance scorecards.
 *
 * Reference: .review/recipes/psa-platform/specs/13-workflow-close-phase.md
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

// =============================================================================
// Type Exports
// =============================================================================

export type LessonCategory = Doc<"lessonsLearned">["category"];
export type LessonImpact = Doc<"lessonsLearned">["impact"];
export type LessonType = Doc<"lessonsLearned">["type"];

// =============================================================================
// Lessons Learned
// =============================================================================

export async function insertLessonLearned(
  db: DatabaseWriter,
  lesson: Omit<Doc<"lessonsLearned">, "_id" | "_creationTime">
): Promise<Id<"lessonsLearned">> {
  return await db.insert("lessonsLearned", lesson);
}

export async function getLessonLearned(
  db: DatabaseReader,
  lessonId: Id<"lessonsLearned">
): Promise<Doc<"lessonsLearned"> | null> {
  return await db.get(lessonId);
}

export async function updateLessonLearned(
  db: DatabaseWriter,
  lessonId: Id<"lessonsLearned">,
  updates: Partial<Omit<Doc<"lessonsLearned">, "_id" | "_creationTime" | "projectId" | "organizationId">>
): Promise<void> {
  const lesson = await db.get(lessonId);
  if (!lesson) {
    throw new EntityNotFoundError("LessonLearned", { lessonId });
  }
  await db.patch(lessonId, updates);
}

export async function deleteLessonLearned(
  db: DatabaseWriter,
  lessonId: Id<"lessonsLearned">
): Promise<void> {
  await db.delete(lessonId);
}

export async function listLessonsLearnedByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"lessonsLearned">>> {
  return await db
    .query("lessonsLearned")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
}

export async function listSuccessesByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"lessonsLearned">>> {
  const lessons = await listLessonsLearnedByProject(db, projectId);
  return lessons.filter((l) => l.type === "success");
}

export async function listImprovementsByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"lessonsLearned">>> {
  const lessons = await listLessonsLearnedByProject(db, projectId);
  return lessons.filter((l) => l.type === "improvement");
}

export async function listLessonsByCategory(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  category: LessonCategory
): Promise<Array<Doc<"lessonsLearned">>> {
  return await db
    .query("lessonsLearned")
    .withIndex("by_category", (q) =>
      q.eq("organizationId", organizationId).eq("category", category)
    )
    .collect();
}

export async function listHighImpactLessons(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Array<Doc<"lessonsLearned">>> {
  const lessons = await listLessonsLearnedByProject(db, projectId);
  return lessons.filter((l) => l.impact === "high");
}

/**
 * Batch insert lessons from a retrospective.
 * Returns the number of lessons inserted.
 */
export async function insertLessonsFromRetrospective(
  db: DatabaseWriter,
  projectId: Id<"projects">,
  organizationId: Id<"organizations">,
  createdBy: Id<"users">,
  successes: Array<{
    category: LessonCategory;
    description: string;
    impact: LessonImpact;
  }>,
  improvements: Array<{
    category: LessonCategory;
    description: string;
    impact: LessonImpact;
    recommendation?: string;
  }>
): Promise<number> {
  const createdAt = Date.now();
  let count = 0;

  // Insert successes
  for (const success of successes) {
    await insertLessonLearned(db, {
      projectId,
      organizationId,
      type: "success",
      category: success.category,
      description: success.description,
      impact: success.impact,
      createdBy,
      createdAt,
    });
    count++;
  }

  // Insert improvements
  for (const improvement of improvements) {
    await insertLessonLearned(db, {
      projectId,
      organizationId,
      type: "improvement",
      category: improvement.category,
      description: improvement.description,
      impact: improvement.impact,
      recommendation: improvement.recommendation,
      createdBy,
      createdAt,
    });
    count++;
  }

  return count;
}

// =============================================================================
// Project Scorecards
// =============================================================================

export async function insertProjectScorecard(
  db: DatabaseWriter,
  scorecard: Omit<Doc<"projectScorecards">, "_id" | "_creationTime">
): Promise<Id<"projectScorecards">> {
  return await db.insert("projectScorecards", scorecard);
}

export async function getProjectScorecard(
  db: DatabaseReader,
  scorecardId: Id<"projectScorecards">
): Promise<Doc<"projectScorecards"> | null> {
  return await db.get(scorecardId);
}

export async function getProjectScorecardByProject(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<Doc<"projectScorecards"> | null> {
  return await db
    .query("projectScorecards")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

export async function updateProjectScorecard(
  db: DatabaseWriter,
  scorecardId: Id<"projectScorecards">,
  updates: Partial<Omit<Doc<"projectScorecards">, "_id" | "_creationTime" | "projectId" | "organizationId">>
): Promise<void> {
  const scorecard = await db.get(scorecardId);
  if (!scorecard) {
    throw new EntityNotFoundError("ProjectScorecard", { scorecardId });
  }
  await db.patch(scorecardId, updates);
}

export async function deleteProjectScorecard(
  db: DatabaseWriter,
  scorecardId: Id<"projectScorecards">
): Promise<void> {
  await db.delete(scorecardId);
}

/**
 * Create a project scorecard from retrospective data.
 * Calculates onTime, onBudget, clientSatisfied, and profitable flags.
 *
 * @param project - Project document with timing/budget info
 * @param clientSatisfactionRating - 1-5 rating (optional)
 * @param targetMargin - Target profit margin percentage (default 20%)
 * @param actualMargin - Actual profit margin percentage
 */
export async function createProjectScorecard(
  db: DatabaseWriter,
  projectId: Id<"projects">,
  organizationId: Id<"organizations">,
  metrics: {
    actualEndDate: number;
    plannedEndDate: number;
    actualCost: number;
    budgetedCost: number;
    profitMargin: number;
    targetMargin?: number; // Default 20%
    clientSatisfactionRating?: number;
    clientFeedback?: string;
    wouldRecommend?: boolean;
    testimonialProvided?: boolean;
    retroParticipants?: Id<"users">[];
    keyLearnings?: string[];
    recommendations?: string[];
  }
): Promise<Id<"projectScorecards">> {
  const targetMargin = metrics.targetMargin ?? 20; // Default 20% margin

  return await insertProjectScorecard(db, {
    projectId,
    organizationId,
    onTime: metrics.actualEndDate <= metrics.plannedEndDate,
    onBudget: metrics.actualCost <= metrics.budgetedCost,
    clientSatisfied: (metrics.clientSatisfactionRating ?? 0) >= 4,
    profitable: metrics.profitMargin >= targetMargin,
    clientSatisfactionRating: metrics.clientSatisfactionRating,
    clientFeedback: metrics.clientFeedback,
    wouldRecommend: metrics.wouldRecommend,
    testimonialProvided: metrics.testimonialProvided,
    retroParticipants: metrics.retroParticipants,
    keyLearnings: metrics.keyLearnings,
    recommendations: metrics.recommendations,
    createdAt: Date.now(),
  });
}

/**
 * Get organization-wide scorecard summary.
 * Returns counts of projects that met each metric.
 */
export async function getOrganizationScorecardSummary(
  db: DatabaseReader,
  organizationId: Id<"organizations">
): Promise<{
  total: number;
  onTimeCount: number;
  onBudgetCount: number;
  clientSatisfiedCount: number;
  profitableCount: number;
  averageClientSatisfaction: number | null;
}> {
  const scorecards = await db
    .query("projectScorecards")
    .filter((q) => q.eq(q.field("organizationId"), organizationId))
    .collect();

  const total = scorecards.length;
  if (total === 0) {
    return {
      total: 0,
      onTimeCount: 0,
      onBudgetCount: 0,
      clientSatisfiedCount: 0,
      profitableCount: 0,
      averageClientSatisfaction: null,
    };
  }

  const onTimeCount = scorecards.filter((s) => s.onTime).length;
  const onBudgetCount = scorecards.filter((s) => s.onBudget).length;
  const clientSatisfiedCount = scorecards.filter((s) => s.clientSatisfied).length;
  const profitableCount = scorecards.filter((s) => s.profitable).length;

  const ratingsWithValue = scorecards
    .map((s) => s.clientSatisfactionRating)
    .filter((r): r is number => r !== undefined);
  const averageClientSatisfaction =
    ratingsWithValue.length > 0
      ? ratingsWithValue.reduce((a, b) => a + b, 0) / ratingsWithValue.length
      : null;

  return {
    total,
    onTimeCount,
    onBudgetCount,
    clientSatisfiedCount,
    profitableCount,
    averageClientSatisfaction:
      averageClientSatisfaction !== null
        ? Math.round(averageClientSatisfaction * 100) / 100
        : null,
  };
}
