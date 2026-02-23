import { describe, it, expect } from "vitest";
import {
  createSeatUsageWebhookPayload,
  createSeatUsageWebhookPayloads,
  getBillingSeatPayloads,
} from "../src/billing-integration.js";
import type { OrganizationMembership } from "../src/member-approval.js";

function membership(
  overrides: Partial<OrganizationMembership> = {}
): OrganizationMembership {
  return {
    userId: "u1",
    organizationId: "o1",
    role: "member",
    status: "active",
    ...overrides,
  };
}

describe("createSeatUsageWebhookPayload", () => {
  it("returns payload with type billing.seat_usage and data from BillingSeatPayload", () => {
    const payload = createSeatUsageWebhookPayload({
      organizationId: "org_1",
      seatCount: 5,
      at: "2026-02-23T12:00:00.000Z",
    }, "evt_seat_1");
    expect(payload.type).toBe("billing.seat_usage");
    expect(payload.id).toBe("evt_seat_1");
    expect(payload.timestamp).toBeDefined();
    expect(payload.data).toEqual({
      organizationId: "org_1",
      seatCount: 5,
      at: "2026-02-23T12:00:00.000Z",
    });
  });

  it("generates id when not provided", () => {
    const payload = createSeatUsageWebhookPayload({
      organizationId: "org_x",
      seatCount: 0,
      at: new Date().toISOString(),
    });
    expect(payload.id).toBeDefined();
    expect(payload.id.length).toBeGreaterThan(0);
  });
});

describe("createSeatUsageWebhookPayloads", () => {
  it("returns one webhook payload per organization with seat usage", () => {
    const organizations = [
      {
        organizationId: "org_a",
        memberships: [
          membership({ organizationId: "org_a", status: "active" }),
          membership({ organizationId: "org_a", userId: "u2", status: "active" }),
        ],
      },
      {
        organizationId: "org_b",
        memberships: [],
      },
    ];
    const at = new Date("2026-02-23T12:00:00.000Z");
    const webhooks = createSeatUsageWebhookPayloads(organizations, at);
    expect(webhooks).toHaveLength(2);
    expect(webhooks[0]!.type).toBe("billing.seat_usage");
    expect(webhooks[0]!.data).toEqual({
      organizationId: "org_a",
      seatCount: 2,
      at: "2026-02-23T12:00:00.000Z",
    });
    expect(webhooks[1]!.type).toBe("billing.seat_usage");
    expect(webhooks[1]!.data).toEqual({
      organizationId: "org_b",
      seatCount: 0,
      at: "2026-02-23T12:00:00.000Z",
    });
  });

  it("returns empty array when no organizations", () => {
    expect(createSeatUsageWebhookPayloads([])).toEqual([]);
  });

  it("uses current date when at not provided", () => {
    const organizations = [
      { organizationId: "org_x", memberships: [membership({ status: "active" })] },
    ];
    const webhooks = createSeatUsageWebhookPayloads(organizations);
    expect(webhooks).toHaveLength(1);
    const data = webhooks[0]!.data as { at: string };
    expect(data.at).toBeDefined();
    expect(new Date(data.at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(data.at).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });
});

describe("getBillingSeatPayloads re-export", () => {
  it("returns same result as seat-management getBillingSeatPayloads", () => {
    const organizations = [
      {
        organizationId: "org_1",
        memberships: [membership({ status: "active" })],
      },
    ];
    const at = new Date("2026-02-23T12:00:00.000Z");
    const payloads = getBillingSeatPayloads(organizations, at);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      organizationId: "org_1",
      seatCount: 1,
      at: "2026-02-23T12:00:00.000Z",
    });
  });
});
