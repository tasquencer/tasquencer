/**
 * Deal Stage Transition Validation
 *
 * Implements the business rule from spec 03-workflow-sales-phase.md lines 388-390:
 * "Stage Progression: Deals must progress through stages sequentially
 * (Lead → Qualified → Proposal → Negotiation → Won/Lost)"
 *
 * Valid stage transitions based on workflow topology (spec 03, lines 8-53):
 * - Lead → Qualified (qualifyLead with qualified=true)
 * - Lead → Disqualified (qualifyLead with qualified=false)
 * - Qualified → Proposal (createProposal)
 * - Proposal → Negotiation (negotiateTerms)
 * - Negotiation → Won (getProposalSigned with signed=true)
 * - Negotiation → Lost (negotiateTerms with outcome=lost, or getProposalSigned with signed=false)
 * - Negotiation → Proposal (reviseProposal - allows loop back for revisions)
 * - Disqualified → Lost (archiveDeal after disqualification)
 * - Lost remains Lost (archiveDeal for lost deals)
 * - Won remains Won (terminal state)
 */

import type { Doc } from "../../../_generated/dataModel";

export type DealStage = Doc<"deals">["stage"];

/**
 * Valid stage transitions map.
 * Key is the current stage, value is an array of valid next stages.
 */
export const VALID_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  Lead: ["Qualified", "Disqualified"],
  Qualified: ["Proposal", "Disqualified"], // Can still disqualify after qualification
  Disqualified: ["Lost"], // Only archiveDeal (stage becomes Lost)
  Proposal: ["Negotiation", "Lost"], // Can lose during proposal stage
  Negotiation: ["Won", "Lost", "Proposal"], // Proposal allows revision loop
  Won: [], // Terminal state - no further transitions
  Lost: [], // Terminal state - no further transitions
};

/**
 * Terminal stages that cannot transition to any other stage.
 */
export const TERMINAL_STAGES: DealStage[] = ["Won", "Lost"];

/**
 * Check if a stage transition is valid.
 *
 * @param currentStage - The current deal stage
 * @param nextStage - The proposed next stage
 * @returns true if the transition is valid, false otherwise
 */
export function isValidStageTransition(
  currentStage: DealStage,
  nextStage: DealStage
): boolean {
  // Same stage is always valid (no-op)
  if (currentStage === nextStage) {
    return true;
  }

  const validNextStages = VALID_STAGE_TRANSITIONS[currentStage];
  return validNextStages.includes(nextStage);
}

/**
 * Get valid next stages from a given stage.
 *
 * @param currentStage - The current deal stage
 * @returns Array of valid next stages
 */
export function getValidNextStages(currentStage: DealStage): DealStage[] {
  return VALID_STAGE_TRANSITIONS[currentStage];
}

/**
 * Check if a stage is terminal (no further transitions allowed).
 *
 * @param stage - The stage to check
 * @returns true if the stage is terminal
 */
export function isTerminalStage(stage: DealStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/**
 * Validate a stage transition and throw an error if invalid.
 *
 * @param currentStage - The current deal stage
 * @param nextStage - The proposed next stage
 * @throws Error if the transition is invalid
 */
export function assertValidStageTransition(
  currentStage: DealStage,
  nextStage: DealStage
): void {
  if (!isValidStageTransition(currentStage, nextStage)) {
    const validNextStages = getValidNextStages(currentStage);
    const validStagesText =
      validNextStages.length > 0
        ? validNextStages.join(", ")
        : "none (terminal stage)";

    throw new Error(
      `Invalid deal stage transition: ${currentStage} → ${nextStage}. ` +
        `Valid transitions from ${currentStage}: ${validStagesText}.`
    );
  }
}

/**
 * Get a human-readable description of why a transition is invalid.
 *
 * @param currentStage - The current deal stage
 * @param nextStage - The proposed next stage
 * @returns A description of why the transition is invalid, or null if valid
 */
export function getTransitionErrorReason(
  currentStage: DealStage,
  nextStage: DealStage
): string | null {
  if (isValidStageTransition(currentStage, nextStage)) {
    return null;
  }

  if (isTerminalStage(currentStage)) {
    return `Deal is in terminal stage '${currentStage}' and cannot be transitioned to any other stage.`;
  }

  const validNextStages = getValidNextStages(currentStage);
  return `Cannot transition from '${currentStage}' to '${nextStage}'. Valid next stages: ${validNextStages.join(", ")}.`;
}

/**
 * Constants for common stage values (for better IDE autocomplete).
 */
export const DealStages = {
  LEAD: "Lead" as const,
  QUALIFIED: "Qualified" as const,
  DISQUALIFIED: "Disqualified" as const,
  PROPOSAL: "Proposal" as const,
  NEGOTIATION: "Negotiation" as const,
  WON: "Won" as const,
  LOST: "Lost" as const,
} as const;
