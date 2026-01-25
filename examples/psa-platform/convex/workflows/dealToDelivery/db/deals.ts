/**
 * Database functions for deals (the aggregate root for deal-to-delivery workflow)
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";
import { helpers } from "../../../tasquencer";
import {
  assertValidStageTransition,
  isValidStageTransition,
  getValidNextStages,
  type DealStage,
} from "./dealStageTransitions";

export type { DealStage } from "./dealStageTransitions";

export async function insertDeal(
  db: DatabaseWriter,
  deal: Omit<Doc<"deals">, "_id" | "_creationTime">
): Promise<Id<"deals">> {
  return await db.insert("deals", deal);
}

export async function getDeal(
  db: DatabaseReader,
  dealId: Id<"deals">
): Promise<Doc<"deals"> | null> {
  return await db.get(dealId);
}

export async function getDealByWorkflowId(
  db: DatabaseReader,
  workflowId: Id<"tasquencerWorkflows">
): Promise<Doc<"deals"> | null> {
  const rootWorkflowId = await helpers.getRootWorkflowId(db, workflowId);
  return await db
    .query("deals")
    .withIndex("by_workflow_id", (q) => q.eq("workflowId", rootWorkflowId))
    .unique();
}

/**
 * Update deal stage with validation.
 *
 * Validates that the stage transition is allowed per spec 03-workflow-sales-phase.md:
 * "Stage Progression: Deals must progress through stages sequentially
 * (Lead → Qualified → Proposal → Negotiation → Won/Lost)"
 *
 * @param db - Database writer
 * @param dealId - The deal to update
 * @param stage - The new stage
 * @param options - Optional configuration
 * @param options.skipValidation - Skip transition validation (use with caution)
 * @throws EntityNotFoundError if deal doesn't exist
 * @throws Error if stage transition is invalid
 */
export async function updateDealStage(
  db: DatabaseWriter,
  dealId: Id<"deals">,
  stage: DealStage,
  options?: { skipValidation?: boolean }
): Promise<void> {
  const deal = await db.get(dealId);
  if (!deal) {
    throw new EntityNotFoundError("Deal", { dealId });
  }

  // Validate stage transition unless explicitly skipped
  if (!options?.skipValidation) {
    assertValidStageTransition(deal.stage, stage);
  }

  await db.patch(dealId, { stage });
}

/**
 * Check if a stage transition would be valid for a deal.
 *
 * @param db - Database reader
 * @param dealId - The deal to check
 * @param targetStage - The proposed target stage
 * @returns true if the transition would be valid
 */
export async function canTransitionDealStage(
  db: DatabaseReader,
  dealId: Id<"deals">,
  targetStage: DealStage
): Promise<{ canTransition: boolean; reason?: string; validStages: DealStage[] }> {
  const deal = await db.get(dealId);
  if (!deal) {
    return {
      canTransition: false,
      reason: "Deal not found",
      validStages: [],
    };
  }

  const validStages = getValidNextStages(deal.stage);
  const canTransition = isValidStageTransition(deal.stage, targetStage);

  return {
    canTransition,
    reason: canTransition
      ? undefined
      : `Cannot transition from ${deal.stage} to ${targetStage}`,
    validStages,
  };
}

export async function updateDeal(
  db: DatabaseWriter,
  dealId: Id<"deals">,
  updates: Partial<Omit<Doc<"deals">, "_id" | "_creationTime" | "organizationId">>
): Promise<void> {
  const deal = await db.get(dealId);
  if (!deal) {
    throw new EntityNotFoundError("Deal", { dealId });
  }
  await db.patch(dealId, updates);
}

export async function listDealsByOrganization(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  limit = 50
): Promise<Array<Doc<"deals">>> {
  return await db
    .query("deals")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .order("desc")
    .take(limit);
}

export async function listDealsByStage(
  db: DatabaseReader,
  organizationId: Id<"organizations">,
  stage: DealStage,
  limit = 50
): Promise<Array<Doc<"deals">>> {
  return await db
    .query("deals")
    .withIndex("by_stage", (q) =>
      q.eq("organizationId", organizationId).eq("stage", stage)
    )
    .order("desc")
    .take(limit);
}

export async function listDealsByOwner(
  db: DatabaseReader,
  ownerId: Id<"users">,
  limit = 50
): Promise<Array<Doc<"deals">>> {
  return await db
    .query("deals")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .take(limit);
}
