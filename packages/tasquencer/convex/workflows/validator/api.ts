import { v } from "convex/values";
import { query } from "../../_generated/server";
import { validatorVersionManager } from "./definition";

export const {
  initializeRootWorkflow,
  cancelRootWorkflow,
  initializeWorkflow,
  cancelWorkflow,
  initializeWorkItem,
  startWorkItem,
  completeWorkItem,
  failWorkItem,
  cancelWorkItem,
  internalInitializeRootWorkflow,
  internalCancelRootWorkflow,
  internalInitializeWorkflow,
  internalCancelWorkflow,
  internalInitializeWorkItem,
  internalStartWorkItem,
  internalCompleteWorkItem,
  internalFailWorkItem,
  internalCancelWorkItem,
  helpers: { getWorkflowTaskStates },
} = validatorVersionManager.apiForVersion("v1");

const workItemStates = [
  "initialized",
  "started",
  "completed",
  "failed",
  "canceled",
] as const;

export const getWorkflowWorkItems = query({
  args: {
    workflowId: v.id("tasquencerWorkflows"),
    taskName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasquencerTasks")
      .withIndex("by_workflow_id_name_and_generation", (q) =>
        q.eq("workflowId", args.workflowId).eq("name", args.taskName)
      )
      .order("desc")
      .first();

    if (!task) {
      return [];
    }

    const itemsByState = await Promise.all(
      workItemStates.map((state) =>
        ctx.db
          .query("tasquencerWorkItems")
          .withIndex(
            "by_parent_workflow_id_task_name_task_generation_and_state",
            (q) =>
              q
                .eq("parent.workflowId", args.workflowId)
                .eq("parent.taskName", args.taskName)
                .eq("parent.taskGeneration", task.generation)
                .eq("state", state)
          )
          .collect()
      )
    );

    return itemsByState.flat();
  },
});
