/// <reference types="vite/client" />
/**
 * Deal Stage Transition Validation Tests
 *
 * Tests for spec 03-workflow-sales-phase.md lines 388-390:
 * "Stage Progression: Deals must progress through stages sequentially
 * (Lead → Qualified → Proposal → Negotiation → Won/Lost)"
 *
 * This test suite validates:
 * 1. Valid stage transitions are allowed
 * 2. Invalid stage transitions are rejected
 * 3. Terminal stages cannot be transitioned
 * 4. Same-stage transitions are no-ops
 * 5. DB integration validates transitions
 */

import { describe, it, expect, beforeEach } from "vitest";
import { setup, type TestContext } from "./helpers.test";
import type { Id } from "../_generated/dataModel";

import {
  isValidStageTransition,
  getValidNextStages,
  isTerminalStage,
  assertValidStageTransition,
  getTransitionErrorReason,
  VALID_STAGE_TRANSITIONS,
  TERMINAL_STAGES,
  DealStages,
  type DealStage,
} from "../workflows/dealToDelivery/db/dealStageTransitions";

import {
  updateDealStage,
  canTransitionDealStage,
  getDeal,
} from "../workflows/dealToDelivery/db";

// Test helper to set up test data
async function setupTestData(t: TestContext) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Test Org",
      settings: {},
      createdAt: Date.now(),
    });

    const userId = await ctx.db.insert("users", {
      organizationId: orgId,
      email: "test@example.com",
      name: "Test User",
      role: "sales",
      department: "Sales",
      skills: [],
      isActive: true,
      billRate: 15000,
      costRate: 10000,
      location: "Remote",
    });

    const companyId = await ctx.db.insert("companies", {
      organizationId: orgId,
      name: "Test Company",
      billingAddress: {
        street: "123 Main St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94102",
        country: "USA",
      },
      paymentTerms: 30,
    });

    const contactId = await ctx.db.insert("contacts", {
      organizationId: orgId,
      companyId,
      name: "Test Contact",
      email: "contact@test.com",
      phone: "555-1234",
      isPrimary: true,
    });

    return { orgId, userId, companyId, contactId };
  });
}

// Create a deal with a specific stage
async function createDealWithStage(
  t: TestContext,
  orgId: Id<"organizations">,
  companyId: Id<"companies">,
  contactId: Id<"contacts">,
  ownerId: Id<"users">,
  stage: DealStage
): Promise<Id<"deals">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("deals", {
      organizationId: orgId,
      companyId,
      contactId,
      ownerId,
      name: `Test Deal - ${stage}`,
      value: 10000,
      probability: 50,
      stage,
      createdAt: Date.now(),
    });
  });
}

describe("Deal Stage Transition Validation - Unit Tests", () => {
  describe("isValidStageTransition", () => {
    describe("from Lead stage", () => {
      it("allows transition to Qualified", () => {
        expect(isValidStageTransition("Lead", "Qualified")).toBe(true);
      });

      it("allows transition to Disqualified", () => {
        expect(isValidStageTransition("Lead", "Disqualified")).toBe(true);
      });

      it("rejects transition to Proposal (skip stage)", () => {
        expect(isValidStageTransition("Lead", "Proposal")).toBe(false);
      });

      it("rejects transition to Negotiation (skip stages)", () => {
        expect(isValidStageTransition("Lead", "Negotiation")).toBe(false);
      });

      it("rejects transition to Won (skip all stages)", () => {
        expect(isValidStageTransition("Lead", "Won")).toBe(false);
      });

      it("rejects transition to Lost (skip stages)", () => {
        expect(isValidStageTransition("Lead", "Lost")).toBe(false);
      });

      it("allows same-stage transition (no-op)", () => {
        expect(isValidStageTransition("Lead", "Lead")).toBe(true);
      });
    });

    describe("from Qualified stage", () => {
      it("allows transition to Proposal", () => {
        expect(isValidStageTransition("Qualified", "Proposal")).toBe(true);
      });

      it("allows transition to Disqualified", () => {
        expect(isValidStageTransition("Qualified", "Disqualified")).toBe(true);
      });

      it("rejects transition back to Lead", () => {
        expect(isValidStageTransition("Qualified", "Lead")).toBe(false);
      });

      it("rejects transition to Negotiation (skip stage)", () => {
        expect(isValidStageTransition("Qualified", "Negotiation")).toBe(false);
      });

      it("rejects transition to Won (skip stages)", () => {
        expect(isValidStageTransition("Qualified", "Won")).toBe(false);
      });
    });

    describe("from Proposal stage", () => {
      it("allows transition to Negotiation", () => {
        expect(isValidStageTransition("Proposal", "Negotiation")).toBe(true);
      });

      it("allows transition to Lost (deal lost during proposal)", () => {
        expect(isValidStageTransition("Proposal", "Lost")).toBe(true);
      });

      it("rejects transition back to Qualified", () => {
        expect(isValidStageTransition("Proposal", "Qualified")).toBe(false);
      });

      it("rejects transition to Won (must go through Negotiation)", () => {
        expect(isValidStageTransition("Proposal", "Won")).toBe(false);
      });
    });

    describe("from Negotiation stage", () => {
      it("allows transition to Won", () => {
        expect(isValidStageTransition("Negotiation", "Won")).toBe(true);
      });

      it("allows transition to Lost", () => {
        expect(isValidStageTransition("Negotiation", "Lost")).toBe(true);
      });

      it("allows transition back to Proposal (revision loop)", () => {
        expect(isValidStageTransition("Negotiation", "Proposal")).toBe(true);
      });

      it("rejects transition back to Qualified", () => {
        expect(isValidStageTransition("Negotiation", "Qualified")).toBe(false);
      });

      it("rejects transition back to Lead", () => {
        expect(isValidStageTransition("Negotiation", "Lead")).toBe(false);
      });
    });

    describe("from Disqualified stage", () => {
      it("allows transition to Lost (archiving)", () => {
        expect(isValidStageTransition("Disqualified", "Lost")).toBe(true);
      });

      it("rejects transition back to Lead", () => {
        expect(isValidStageTransition("Disqualified", "Lead")).toBe(false);
      });

      it("rejects transition to Won", () => {
        expect(isValidStageTransition("Disqualified", "Won")).toBe(false);
      });
    });

    describe("from terminal stages", () => {
      it("rejects any transition from Won", () => {
        expect(isValidStageTransition("Won", "Lost")).toBe(false);
        expect(isValidStageTransition("Won", "Lead")).toBe(false);
        expect(isValidStageTransition("Won", "Negotiation")).toBe(false);
      });

      it("rejects any transition from Lost", () => {
        expect(isValidStageTransition("Lost", "Won")).toBe(false);
        expect(isValidStageTransition("Lost", "Lead")).toBe(false);
        expect(isValidStageTransition("Lost", "Negotiation")).toBe(false);
      });

      it("allows same-stage no-op for Won", () => {
        expect(isValidStageTransition("Won", "Won")).toBe(true);
      });

      it("allows same-stage no-op for Lost", () => {
        expect(isValidStageTransition("Lost", "Lost")).toBe(true);
      });
    });
  });

  describe("getValidNextStages", () => {
    it("returns correct stages for Lead", () => {
      expect(getValidNextStages("Lead")).toEqual(["Qualified", "Disqualified"]);
    });

    it("returns correct stages for Qualified", () => {
      expect(getValidNextStages("Qualified")).toEqual(["Proposal", "Disqualified"]);
    });

    it("returns correct stages for Proposal", () => {
      expect(getValidNextStages("Proposal")).toEqual(["Negotiation", "Lost"]);
    });

    it("returns correct stages for Negotiation", () => {
      expect(getValidNextStages("Negotiation")).toEqual(["Won", "Lost", "Proposal"]);
    });

    it("returns correct stages for Disqualified", () => {
      expect(getValidNextStages("Disqualified")).toEqual(["Lost"]);
    });

    it("returns empty array for Won (terminal)", () => {
      expect(getValidNextStages("Won")).toEqual([]);
    });

    it("returns empty array for Lost (terminal)", () => {
      expect(getValidNextStages("Lost")).toEqual([]);
    });
  });

  describe("isTerminalStage", () => {
    it("returns true for Won", () => {
      expect(isTerminalStage("Won")).toBe(true);
    });

    it("returns true for Lost", () => {
      expect(isTerminalStage("Lost")).toBe(true);
    });

    it("returns false for Lead", () => {
      expect(isTerminalStage("Lead")).toBe(false);
    });

    it("returns false for Qualified", () => {
      expect(isTerminalStage("Qualified")).toBe(false);
    });

    it("returns false for Proposal", () => {
      expect(isTerminalStage("Proposal")).toBe(false);
    });

    it("returns false for Negotiation", () => {
      expect(isTerminalStage("Negotiation")).toBe(false);
    });

    it("returns false for Disqualified", () => {
      expect(isTerminalStage("Disqualified")).toBe(false);
    });
  });

  describe("assertValidStageTransition", () => {
    it("does not throw for valid transition", () => {
      expect(() => assertValidStageTransition("Lead", "Qualified")).not.toThrow();
    });

    it("does not throw for same-stage transition", () => {
      expect(() => assertValidStageTransition("Negotiation", "Negotiation")).not.toThrow();
    });

    it("throws for invalid transition", () => {
      expect(() => assertValidStageTransition("Lead", "Won")).toThrow(
        /Invalid deal stage transition: Lead → Won/
      );
    });

    it("throws with helpful message including valid stages", () => {
      expect(() => assertValidStageTransition("Lead", "Proposal")).toThrow(
        /Valid transitions from Lead: Qualified, Disqualified/
      );
    });

    it("throws with terminal stage message", () => {
      expect(() => assertValidStageTransition("Won", "Lost")).toThrow(
        /none \(terminal stage\)/
      );
    });
  });

  describe("getTransitionErrorReason", () => {
    it("returns null for valid transition", () => {
      expect(getTransitionErrorReason("Lead", "Qualified")).toBeNull();
    });

    it("returns null for same-stage transition", () => {
      expect(getTransitionErrorReason("Proposal", "Proposal")).toBeNull();
    });

    it("returns reason for invalid transition", () => {
      const reason = getTransitionErrorReason("Lead", "Won");
      expect(reason).toContain("Cannot transition from 'Lead' to 'Won'");
      expect(reason).toContain("Qualified, Disqualified");
    });

    it("returns terminal stage reason", () => {
      const reason = getTransitionErrorReason("Won", "Lead");
      expect(reason).toContain("terminal stage");
      expect(reason).toContain("'Won'");
    });
  });

  describe("DealStages constants", () => {
    it("has all expected stage values", () => {
      expect(DealStages.LEAD).toBe("Lead");
      expect(DealStages.QUALIFIED).toBe("Qualified");
      expect(DealStages.DISQUALIFIED).toBe("Disqualified");
      expect(DealStages.PROPOSAL).toBe("Proposal");
      expect(DealStages.NEGOTIATION).toBe("Negotiation");
      expect(DealStages.WON).toBe("Won");
      expect(DealStages.LOST).toBe("Lost");
    });
  });

  describe("VALID_STAGE_TRANSITIONS coverage", () => {
    it("covers all 7 stages", () => {
      const allStages: DealStage[] = [
        "Lead",
        "Qualified",
        "Disqualified",
        "Proposal",
        "Negotiation",
        "Won",
        "Lost",
      ];
      for (const stage of allStages) {
        expect(VALID_STAGE_TRANSITIONS[stage]).toBeDefined();
      }
    });
  });

  describe("TERMINAL_STAGES coverage", () => {
    it("includes Won and Lost only", () => {
      expect(TERMINAL_STAGES).toEqual(["Won", "Lost"]);
    });
  });
});

describe("Deal Stage Transition Validation - DB Integration", () => {
  let t: TestContext;

  beforeEach(() => {
    t = setup();
  });

  describe("updateDealStage with validation", () => {
    it("allows valid Lead → Qualified transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Qualified");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Qualified");
      });
    });

    it("allows valid Qualified → Proposal transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Qualified");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Proposal");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Proposal");
      });
    });

    it("allows valid Proposal → Negotiation transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Proposal");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Negotiation");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Negotiation");
      });
    });

    it("allows valid Negotiation → Won transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Negotiation");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Won");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Won");
      });
    });

    it("allows valid Negotiation → Lost transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Negotiation");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Lost");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Lost");
      });
    });

    it("allows valid Negotiation → Proposal revision loop", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Negotiation");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Proposal");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Proposal");
      });
    });

    it("rejects invalid Lead → Won skip-stages transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await expect(
        t.run(async (ctx) => {
          await updateDealStage(ctx.db, dealId, "Won");
        })
      ).rejects.toThrow(/Invalid deal stage transition: Lead → Won/);

      // Verify stage wasn't changed
      await t.run(async (ctx) => {
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Lead");
      });
    });

    it("rejects invalid Lead → Proposal skip-stage transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await expect(
        t.run(async (ctx) => {
          await updateDealStage(ctx.db, dealId, "Proposal");
        })
      ).rejects.toThrow(/Invalid deal stage transition: Lead → Proposal/);
    });

    it("rejects invalid Qualified → Won skip-stages transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Qualified");

      await expect(
        t.run(async (ctx) => {
          await updateDealStage(ctx.db, dealId, "Won");
        })
      ).rejects.toThrow(/Invalid deal stage transition: Qualified → Won/);
    });

    it("rejects transition from terminal Won stage", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Won");

      await expect(
        t.run(async (ctx) => {
          await updateDealStage(ctx.db, dealId, "Lost");
        })
      ).rejects.toThrow(/Invalid deal stage transition: Won → Lost/);
    });

    it("rejects transition from terminal Lost stage", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lost");

      await expect(
        t.run(async (ctx) => {
          await updateDealStage(ctx.db, dealId, "Lead");
        })
      ).rejects.toThrow(/Invalid deal stage transition: Lost → Lead/);
    });

    it("allows same-stage transition (no-op)", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Negotiation");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Negotiation");
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Negotiation");
      });
    });

    it("allows skipValidation option for edge cases", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      // With skipValidation, even invalid transitions should work
      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Won", { skipValidation: true });
        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Won");
      });
    });
  });

  describe("canTransitionDealStage query", () => {
    it("returns canTransition: true for valid transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        const result = await canTransitionDealStage(ctx.db, dealId, "Qualified");
        expect(result.canTransition).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.validStages).toEqual(["Qualified", "Disqualified"]);
      });
    });

    it("returns canTransition: false for invalid transition", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        const result = await canTransitionDealStage(ctx.db, dealId, "Won");
        expect(result.canTransition).toBe(false);
        expect(result.reason).toContain("Cannot transition from Lead to Won");
        expect(result.validStages).toEqual(["Qualified", "Disqualified"]);
      });
    });

    it("returns canTransition: false for terminal stage", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Won");

      await t.run(async (ctx) => {
        const result = await canTransitionDealStage(ctx.db, dealId, "Lost");
        expect(result.canTransition).toBe(false);
        expect(result.validStages).toEqual([]);
      });
    });

    it("returns canTransition: true for same-stage no-op", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Proposal");

      await t.run(async (ctx) => {
        const result = await canTransitionDealStage(ctx.db, dealId, "Proposal");
        expect(result.canTransition).toBe(true);
      });
    });
  });

  describe("Full deal lifecycle with valid transitions", () => {
    it("completes happy path: Lead → Qualified → Proposal → Negotiation → Won", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        // Step 1: Qualify
        await updateDealStage(ctx.db, dealId, "Qualified");
        let deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Qualified");

        // Step 2: Create proposal
        await updateDealStage(ctx.db, dealId, "Proposal");
        deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Proposal");

        // Step 3: Enter negotiation
        await updateDealStage(ctx.db, dealId, "Negotiation");
        deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Negotiation");

        // Step 4: Win the deal
        await updateDealStage(ctx.db, dealId, "Won");
        deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Won");
      });
    });

    it("completes lost path: Lead → Qualified → Proposal → Lost", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Qualified");
        await updateDealStage(ctx.db, dealId, "Proposal");
        await updateDealStage(ctx.db, dealId, "Lost"); // Can lose during proposal

        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Lost");
      });
    });

    it("completes disqualification path: Lead → Disqualified → Lost", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Lead");

      await t.run(async (ctx) => {
        await updateDealStage(ctx.db, dealId, "Disqualified");
        await updateDealStage(ctx.db, dealId, "Lost"); // Archive

        const deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Lost");
      });
    });

    it("supports revision loop: Negotiation → Proposal → Negotiation → Won", async () => {
      const { orgId, userId, companyId, contactId } = await setupTestData(t);
      const dealId = await createDealWithStage(t, orgId, companyId, contactId, userId, "Negotiation");

      await t.run(async (ctx) => {
        // Client requests revision
        await updateDealStage(ctx.db, dealId, "Proposal");
        let deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Proposal");

        // Revision complete, back to negotiation
        await updateDealStage(ctx.db, dealId, "Negotiation");
        deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Negotiation");

        // Finally win
        await updateDealStage(ctx.db, dealId, "Won");
        deal = await getDeal(ctx.db, dealId);
        expect(deal?.stage).toBe("Won");
      });
    });
  });
});
