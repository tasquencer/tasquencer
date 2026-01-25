import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";

/**
 * Hook for fetching deal data with company and contact context.
 * Used in task forms to display deal information.
 *
 * @param dealId - The deal ID to fetch
 * @returns Deal document or null if not found/not provided
 */
export function useDealSnapshot(
  dealId: Id<"deals"> | undefined
): Doc<"deals"> | null {
  const dealQuery = convexQuery(
    api.workflows.dealToDelivery.api.deals.getDeal,
    dealId ? { dealId } : "skip"
  );

  const { data: deal } = useQuery({
    ...dealQuery,
    enabled: !!dealId,
  });

  return deal ?? null;
}
