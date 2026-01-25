/**
 * CreateDeal Work Item
 *
 * This is the entry point of the sales workflow. A sales rep creates a new deal
 * by providing company, contact, deal name, value, and owner information.
 *
 * Stage transition: (none) -> Lead
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth } from "./helpersAuth";
import { authService } from "../../../authorization";
import { insertDeal } from "../db/deals";
import { getWorkflowIdsForWorkItem } from "../db/workItemContext";

// Policy: Requires 'dealToDelivery:deals:create' scope
const dealsCreatePolicy = authService.policies.requireScope("dealToDelivery:deals:create");

/**
 * Actions for the createDeal work item.
 *
 * - initialize: Sets up work item metadata (deal created in complete)
 * - start: Claims the work item for the current user
 * - complete: Creates the deal record and advances the workflow
 * - fail: Marks the work item as failed
 */
const createDealWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({}), // No payload needed for initialize - deal data comes in complete
    dealsCreatePolicy,
    async ({ workItem }) => {
      // For root work items that create their aggregate (deal), we just initialize
      // the work item here. Metadata is created in complete after the deal exists.
      await workItem.initialize();
    }
  )
  .start(z.never(), dealsCreatePolicy, async ({ workItem }) => {
    // For root work items that create their aggregate, we just start the work item
    // without claiming since metadata doesn't exist yet (created in complete).
    await workItem.start();
  })
  .complete(
    z.object({
      organizationId: zid("organizations"),
      companyId: zid("companies"),
      contactId: zid("contacts"),
      name: z.string().min(1, "Deal name is required"),
      value: z.number().min(0, "Deal value must be non-negative"),
      ownerId: zid("users"),
    }),
    dealsCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      // Get the workflow ID for linking the deal to the workflow
      const { rootWorkflowId } = await getWorkflowIdsForWorkItem(
        mutationCtx.db,
        workItem.id
      );

      // Create the deal record using domain-layer function
      const dealId = await insertDeal(mutationCtx.db, {
        organizationId: payload.organizationId,
        companyId: payload.companyId,
        contactId: payload.contactId,
        workflowId: rootWorkflowId,
        name: payload.name,
        value: payload.value,
        probability: 10, // Lead stage starts at 10%
        stage: "Lead",
        ownerId: payload.ownerId,
        createdAt: Date.now(),
      });

      // Create work item metadata now that we have the deal ID
      // This is done in complete (not initialize) because createDeal is a root
      // work item that creates its aggregate.
      await initializeDealWorkItemAuth(mutationCtx, workItem.id, {
        scope: "dealToDelivery:deals:create",
        dealId,
        payload: {
          type: "createDeal",
          taskName: "Create Deal",
          priority: "normal",
        },
      });

      // Complete the work item to advance the workflow
      await workItem.complete();
    }
  )
  .fail(z.any().optional(), dealsCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The createDeal work item with actions and lifecycle activities.
 */
export const createDealWorkItem = Builder.workItem("createDeal")
  .withActions(createDealWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The createDeal task - this is what gets added to workflows.
 * The task wrapper allows for onEnabled lifecycle hooks.
 */
export const createDealTask = Builder.task(createDealWorkItem);
