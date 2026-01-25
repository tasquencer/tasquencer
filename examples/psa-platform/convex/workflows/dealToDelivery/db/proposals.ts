/**
 * Database functions for proposals
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type ProposalStatus = Doc<"proposals">["status"];

export async function insertProposal(
  db: DatabaseWriter,
  proposal: Omit<Doc<"proposals">, "_id" | "_creationTime">
): Promise<Id<"proposals">> {
  return await db.insert("proposals", proposal);
}

export async function getProposal(
  db: DatabaseReader,
  proposalId: Id<"proposals">
): Promise<Doc<"proposals"> | null> {
  return await db.get(proposalId);
}

export async function updateProposalStatus(
  db: DatabaseWriter,
  proposalId: Id<"proposals">,
  status: ProposalStatus
): Promise<void> {
  const proposal = await db.get(proposalId);
  if (!proposal) {
    throw new EntityNotFoundError("Proposal", { proposalId });
  }
  await db.patch(proposalId, { status });
}

export async function updateProposal(
  db: DatabaseWriter,
  proposalId: Id<"proposals">,
  updates: Partial<Omit<Doc<"proposals">, "_id" | "_creationTime" | "organizationId" | "dealId">>
): Promise<void> {
  const proposal = await db.get(proposalId);
  if (!proposal) {
    throw new EntityNotFoundError("Proposal", { proposalId });
  }
  await db.patch(proposalId, updates);
}

export async function listProposalsByDeal(
  db: DatabaseReader,
  dealId: Id<"deals">,
  limit = 10
): Promise<Array<Doc<"proposals">>> {
  return await db
    .query("proposals")
    .withIndex("by_deal", (q) => q.eq("dealId", dealId))
    .order("desc")
    .take(limit);
}

export async function getLatestProposalForDeal(
  db: DatabaseReader,
  dealId: Id<"deals">
): Promise<Doc<"proposals"> | null> {
  const proposals = await listProposalsByDeal(db, dealId, 1);
  return proposals[0] ?? null;
}

export async function getNextProposalVersion(
  db: DatabaseReader,
  dealId: Id<"deals">
): Promise<number> {
  const proposals = await listProposalsByDeal(db, dealId);
  if (proposals.length === 0) return 1;
  return Math.max(...proposals.map((p) => p.version)) + 1;
}

export async function markProposalSent(
  db: DatabaseWriter,
  proposalId: Id<"proposals">
): Promise<void> {
  await updateProposal(db, proposalId, {
    status: "Sent",
    sentAt: Date.now(),
  });
}

export async function markProposalViewed(
  db: DatabaseWriter,
  proposalId: Id<"proposals">
): Promise<void> {
  const proposal = await getProposal(db, proposalId);
  if (!proposal) {
    throw new EntityNotFoundError("Proposal", { proposalId });
  }
  // Only update if not already viewed
  if (!proposal.viewedAt) {
    await updateProposal(db, proposalId, {
      status: "Viewed",
      viewedAt: Date.now(),
    });
  }
}

export async function markProposalSigned(
  db: DatabaseWriter,
  proposalId: Id<"proposals">
): Promise<void> {
  await updateProposal(db, proposalId, {
    status: "Signed",
    signedAt: Date.now(),
  });
}

export async function markProposalRejected(
  db: DatabaseWriter,
  proposalId: Id<"proposals">
): Promise<void> {
  await updateProposal(db, proposalId, {
    status: "Rejected",
    rejectedAt: Date.now(),
  });
}
