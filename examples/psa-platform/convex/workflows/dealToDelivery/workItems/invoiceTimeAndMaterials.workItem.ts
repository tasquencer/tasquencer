/**
 * InvoiceTimeAndMaterials Work Item
 *
 * Create a draft invoice from logged time and expenses not yet invoiced.
 *
 * Entry condition: selectInvoicingMethod completed with method = "TimeAndMaterials"
 * Exit condition: Draft invoice created with line items from time entries and expenses
 *
 * Reference: .review/recipes/psa-platform/specs/11-workflow-invoice-generation.md
 */
import { Builder } from "../../../tasquencer";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod4";
import { startAndClaimWorkItem, cleanupWorkItemOnCancel } from "./helpers";
import { initializeDealWorkItemAuth, updateWorkItemMetadataPayload } from "./helpersAuth";
import { authService } from "../../../authorization";
import { authComponent } from "../../../auth";
import { getProject } from "../db/projects";
import { getBudgetByProjectId, listServicesByBudget } from "../db/budgets";
import { listBillableUninvoicedTimeEntries } from "../db/timeEntries";
import { listBillableUninvoicedExpenses } from "../db/expenses";
import { insertInvoice, insertInvoiceLineItem, recalculateInvoiceTotals } from "../db/invoices";
import { getRootWorkflowAndDealForWorkItem } from "../db/workItemContext";
import { assertProjectExists, assertAuthenticatedUser } from "../exceptions";
import type { Id, Doc } from "../../../_generated/dataModel";

// Policy: Requires 'dealToDelivery:invoices:create' scope
const invoicesCreatePolicy = authService.policies.requireScope(
  "dealToDelivery:invoices:create"
);

/**
 * Actions for the invoiceTimeAndMaterials work item.
 */
const invoiceTimeAndMaterialsWorkItemActions = authService.builders.workItemActions
  .initialize(
    z.object({
      projectId: zid("projects"),
    }),
    invoicesCreatePolicy,
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
        scope: "dealToDelivery:invoices:create",
        dealId: deal._id,
        payload: {
          type: "invoiceTimeAndMaterials",
          taskName: "Create Time & Materials Invoice",
          priority: "normal",
        },
      });
    }
  )
  .start(z.never(), invoicesCreatePolicy, async ({ mutationCtx, workItem }) => {
    await startAndClaimWorkItem(mutationCtx, workItem);
  })
  .complete(
    z.object({
      projectId: zid("projects"),
      dateRange: z.object({
        startDate: z.number(),
        endDate: z.number(),
      }).optional(),
      includeExpenses: z.boolean().default(true),
      groupBy: z.enum(["service", "task", "date", "person"]).default("service"),
      detailLevel: z.enum(["summary", "detailed"]).default("summary"),
    }),
    invoicesCreatePolicy,
    async ({ mutationCtx, workItem }, payload) => {
      const authUser = await authComponent.safeGetAuthUser(mutationCtx);
      assertAuthenticatedUser(authUser, {
        operation: "invoiceTimeAndMaterials:complete",
        workItemId: workItem.id,
      });

      // Get project and validate
      const project = await getProject(mutationCtx.db, payload.projectId);
      assertProjectExists(project, { projectId: payload.projectId });

      const budget = await getBudgetByProjectId(mutationCtx.db, payload.projectId);
      if (!budget) {
        throw new Error("Project must have a budget for T&M invoicing");
      }

      // Get billable, uninvoiced time entries
      let timeEntries = await listBillableUninvoicedTimeEntries(
        mutationCtx.db,
        payload.projectId
      );

      // Filter by date range if specified
      if (payload.dateRange) {
        timeEntries = timeEntries.filter(
          (e) => e.date >= payload.dateRange!.startDate && e.date <= payload.dateRange!.endDate
        );
      }

      // Get services for rate lookup
      const services = await listServicesByBudget(mutationCtx.db, budget._id);
      const serviceMap = new Map(services.map((s) => [s._id, s]));

      // Create the draft invoice
      const invoiceId = await insertInvoice(mutationCtx.db, {
        organizationId: project.organizationId,
        projectId: payload.projectId,
        companyId: project.companyId,
        status: "Draft",
        method: "TimeAndMaterials",
        subtotal: 0,
        tax: 0,
        total: 0,
        dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      });

      // Group time entries and create line items based on groupBy option
      // Per spec 11-workflow-invoice-generation.md line 119: groupBy = "service | task | date | person"
      if (payload.groupBy === "service") {
        // Group by service
        const byService = new Map<string, Doc<"timeEntries">[]>();
        for (const entry of timeEntries) {
          const key = entry.serviceId?.toString() ?? "unassigned";
          if (!byService.has(key)) {
            byService.set(key, []);
          }
          byService.get(key)!.push(entry);
        }

        let sortOrder = 0;
        for (const [serviceKey, entries] of byService) {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
          const serviceId = serviceKey !== "unassigned" ? (serviceKey as Id<"services">) : undefined;
          const service = serviceId ? serviceMap.get(serviceId) : undefined;
          const rate = service?.rate ?? 0;
          const amount = Math.round(totalHours * rate);

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: service?.name ?? "Professional Services",
            quantity: totalHours,
            rate,
            amount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          });
        }
      } else if (payload.groupBy === "task") {
        // Group by task
        const byTask = new Map<string, Doc<"timeEntries">[]>();
        for (const entry of timeEntries) {
          const key = entry.taskId?.toString() ?? "no_task";
          if (!byTask.has(key)) {
            byTask.set(key, []);
          }
          byTask.get(key)!.push(entry);
        }

        // Load task names for descriptions
        const taskIds = [...byTask.keys()]
          .filter((k) => k !== "no_task")
          .map((k) => k as Id<"tasks">);
        const tasks = await Promise.all(
          taskIds.map((id) => mutationCtx.db.get(id))
        );
        const taskMap = new Map(tasks.filter(Boolean).map((t) => [t!._id.toString(), t!]));

        let sortOrder = 0;
        for (const [taskKey, entries] of byTask) {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
          const task = taskKey !== "no_task" ? taskMap.get(taskKey) : undefined;

          // Calculate weighted average rate from services used
          let totalAmount = 0;
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined;
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0));
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0;

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: task?.name ?? "General Work",
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          });
        }
      } else if (payload.groupBy === "date") {
        // Group by date
        const byDate = new Map<number, Doc<"timeEntries">[]>();
        for (const entry of timeEntries) {
          // Normalize to start of day
          const dateKey = new Date(entry.date).setHours(0, 0, 0, 0);
          if (!byDate.has(dateKey)) {
            byDate.set(dateKey, []);
          }
          byDate.get(dateKey)!.push(entry);
        }

        // Sort by date
        const sortedDates = [...byDate.keys()].sort((a, b) => a - b);

        let sortOrder = 0;
        for (const dateKey of sortedDates) {
          const entries = byDate.get(dateKey)!;
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

          // Calculate total amount from services used
          let totalAmount = 0;
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined;
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0));
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0;

          // Format date for description
          const dateStr = new Date(dateKey).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: `Work on ${dateStr}`,
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          });
        }
      } else if (payload.groupBy === "person") {
        // Group by person/user
        const byPerson = new Map<string, Doc<"timeEntries">[]>();
        for (const entry of timeEntries) {
          const key = entry.userId.toString();
          if (!byPerson.has(key)) {
            byPerson.set(key, []);
          }
          byPerson.get(key)!.push(entry);
        }

        // Load user names for descriptions
        const userIds = [...byPerson.keys()].map((k) => k as Id<"users">);
        const users = await Promise.all(
          userIds.map((id) => mutationCtx.db.get(id))
        );
        const userMap = new Map(users.filter(Boolean).map((u) => [u!._id.toString(), u!]));

        let sortOrder = 0;
        for (const [userKey, entries] of byPerson) {
          const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
          const user = userMap.get(userKey);

          // Calculate total amount from services used
          let totalAmount = 0;
          for (const entry of entries) {
            const service = entry.serviceId ? serviceMap.get(entry.serviceId) : undefined;
            totalAmount += Math.round(entry.hours * (service?.rate ?? 0));
          }
          const averageRate = totalHours > 0 ? Math.round(totalAmount / totalHours) : 0;

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: user?.name ?? "Team Member",
            quantity: totalHours,
            rate: averageRate,
            amount: totalAmount,
            sortOrder: sortOrder++,
            timeEntryIds: entries.map((e) => e._id),
          });
        }
      }

      // Add expenses if requested
      if (payload.includeExpenses) {
        const expenses = await listBillableUninvoicedExpenses(
          mutationCtx.db,
          payload.projectId
        );

        for (const expense of expenses) {
          const markupRate = expense.markupRate ?? 1.0;
          const amount = Math.round(expense.amount * markupRate);

          await insertInvoiceLineItem(mutationCtx.db, {
            invoiceId,
            description: `Expense: ${expense.description}`,
            quantity: 1,
            rate: expense.amount,
            amount,
            sortOrder: 0,
            expenseIds: [expense._id],
          });
        }
      }

      // Recalculate totals
      await recalculateInvoiceTotals(mutationCtx.db, invoiceId);

      // Update work item metadata with invoice reference
      await updateWorkItemMetadataPayload(mutationCtx, workItem.id, {
        type: "invoiceTimeAndMaterials",
        taskName: "Create Time & Materials Invoice",
        priority: "normal",
      });

      await workItem.complete();
    }
  )
  .fail(z.any().optional(), invoicesCreatePolicy, async ({ workItem }) => {
    await workItem.fail();
  });

/**
 * The invoiceTimeAndMaterials work item with actions and lifecycle activities.
 */
export const invoiceTimeAndMaterialsWorkItem = Builder.workItem("invoiceTimeAndMaterials")
  .withActions(invoiceTimeAndMaterialsWorkItemActions.build())
  .withActivities({
    onCanceled: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
    onFailed: async ({ mutationCtx, workItem }) => {
      await cleanupWorkItemOnCancel(mutationCtx, workItem.id);
    },
  });

/**
 * The invoiceTimeAndMaterials task.
 */
export const invoiceTimeAndMaterialsTask = Builder.task(invoiceTimeAndMaterialsWorkItem);
