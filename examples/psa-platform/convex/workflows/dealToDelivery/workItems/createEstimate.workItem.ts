/**
 * CreateEstimate Work Item
 *
 * Sales rep builds a detailed estimate with services and pricing.
 * Updates the deal value to match the estimate total.
 *
 * Stage: Qualified (no stage transition, deal value updated)
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import {
  startAndClaimWorkItem,
  cleanupWorkItemOnCancel,
} from "./helpers";
import { initializeDealWorkItemAuth, initializeWorkItemWithDealAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { updateDeal } from "../db/deals";
import { insertEstimate, insertEstimateService, recalculateEstimateTotal } from "../db/estimates";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:deals:edit:own' scope for editing deal estimates
const dealsEditPolicy = authService.policies.requireScope("dealToDelivery:deals:edit:own");

// Service line item schema
const serviceLineSchema = z.object({
  name: z.string().min(1),
  hours: z.number().min(0),
  rate: z.number().min(0), // Rate per hour in cents
});

/**
 * Actions for the createEstimate work item.
 *
 * - initialize: Sets up work item metadata with deal context
 * - start: Claims the work item for the current user
 * - complete: Creates estimate with service lines and updates deal value
 * - fail: Marks the work item as failed
 */
const createEstimateWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      dealId: zid("deals"),
    }),
    dealsEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const workItemId = await workItem.initialize();

      // Initialize work item metadata with deal reference
      await initializeDealWorkItemAuth(mutationCtx, workItemId, {
        scope: "dealToDelivery:deals:edit:own",
        dealId: payload.dealId,
        payload: {
          type: "createEstimate",
          taskName: "Create Estimate",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), dealsEditPolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      dealId: zid("deals"),
      services: z.array(serviceLineSchema).min(1, "At least one service is required"),
      notes: z.string().optional(),
    }),
    dealsEditPolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Verify deal exists and matches workflow
      const { deal } = await getRootWorkflowAndDealForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      if (deal._id !== payload.dealId) {
        throw new Error(`Deal mismatch: expected ${deal._id}, got ${payload.dealId}`);
      }

      // Create the estimate record
      const estimateId = await insertEstimate(mutationCtx.db, {
        organizationId: deal.organizationId,
        dealId: payload.dealId,
        total: 0, // Will be calculated after adding services
        createdAt: Date.now(),
      });

      // Add service lines to the estimate
      for (const service of payload.services) {
        const total = service.hours * service.rate;
        await insertEstimateService(mutationCtx.db, {
          estimateId,
          name: service.name,
          hours: service.hours,
          rate: service.rate,
          total,
        });
      }

      // Calculate and update estimate total
      const estimateTotal = await recalculateEstimateTotal(mutationCtx.db, estimateId);

      // Update deal with estimate reference and value
      await updateDeal(mutationCtx.db, payload.dealId, {
        estimateId,
        value: estimateTotal, // Sync deal value with estimate total
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsEditPolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createEstimate work item with actions and lifecycle activities.
 */
export const createEstimateWorkItem = Builder.workItem("createEstimate")
  .withActions(createEstimateWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createEstimate task - this is what gets added to workflows.
 * The onEnabled hook automatically initializes the work item with deal context.
 */
export const createEstimateTask = Builder.task(createEstimateWorkItem).withActivities({
  onEnabled: async ({ workItem, mutationCtx, parent }) => {
    await initializeWorkItemWithDealAuth(mutationCtx, parent.workflow, workItem);
  },
});
