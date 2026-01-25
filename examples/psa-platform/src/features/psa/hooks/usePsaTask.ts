import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDealSnapshot } from "./useDealSnapshot";

/**
 * Hook for managing PSA work item operations.
 * Provides task metadata, deal context, claim checks, and workflow mutations.
 *
 * Pattern reference: examples/er/src/features/er/hooks/useErTask.ts
 *
 * @param workItemId - The Tasquencer work item ID
 * @returns Task state and mutations for claiming and completing work items
 */
export function usePsaTask(workItemId: Id<"tasquencerWorkItems">) {
  const metadataQuery = convexQuery(
    api.workflows.dealToDelivery.api.workItems.getWorkItemMetadataByWorkItemId,
    { workItemId }
  );
  const { data: task } = useSuspenseQuery(metadataQuery);

  // Get deal context using the aggregate table ID (deal ID)
  const dealId = task?.aggregateTableId;
  const deal = useDealSnapshot(dealId ?? undefined);

  // Check if user can claim this work item
  const canClaimQuery = convexQuery(
    api.workflows.dealToDelivery.api.workItems.canClaimWorkItem,
    { workItemId }
  );
  const { data: canClaimWorkItem } = useQuery({
    ...canClaimQuery,
    enabled: task?.status === "pending",
  });

  // Workflow mutations
  const startWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.startWorkItem
  );
  const completeWorkItem = useMutation(
    api.workflows.dealToDelivery.api.workflow.completeWorkItem
  );

  return {
    task,
    deal,
    canClaimWorkItem,
    startWorkItem,
    completeWorkItem,
  };
}
