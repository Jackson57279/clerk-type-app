import { describe, it, expect } from "vitest";
import {
  countActiveSeats,
  canAddSeat,
  getSeatUsage,
  getBillingSeatReport,
  canOrganizationAddMember,
  assertOrganizationCanAddMember,
  getBillingSeatPayloads,
  SeatLimitReachedError,
  type SeatUsage,
} from "../src/seat-management.js";
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

describe("countActiveSeats", () => {
  it("counts only active memberships", () => {
    const memberships: OrganizationMembership[] = [
      membership({ userId: "u1", status: "active" }),
      membership({ userId: "u2", status: "active" }),
      membership({ userId: "u3", status: "pending" }),
      membership({ userId: "u4", status: "rejected" }),
    ];
    expect(countActiveSeats(memberships)).toBe(2);
  });

  it("returns 0 for empty list", () => {
    expect(countActiveSeats([])).toBe(0);
  });

  it("returns 0 when all are pending or rejected", () => {
    const memberships: OrganizationMembership[] = [
      membership({ userId: "u1", status: "pending" }),
      membership({ userId: "u2", status: "rejected" }),
    ];
    expect(countActiveSeats(memberships)).toBe(0);
  });

  it("counts all when all are active", () => {
    const memberships: OrganizationMembership[] = [
      membership({ userId: "u1", status: "active" }),
      membership({ userId: "u2", status: "active" }),
      membership({ userId: "u3", status: "active" }),
    ];
    expect(countActiveSeats(memberships)).toBe(3);
  });
});

describe("canAddSeat", () => {
  it("returns true when seatLimit is null (unlimited)", () => {
    expect(canAddSeat(0, null)).toBe(true);
    expect(canAddSeat(100, null)).toBe(true);
  });

  it("returns true when seatsInUse is below limit", () => {
    expect(canAddSeat(0, 5)).toBe(true);
    expect(canAddSeat(4, 5)).toBe(true);
  });

  it("returns false when seatsInUse equals limit", () => {
    expect(canAddSeat(5, 5)).toBe(false);
  });

  it("returns false when seatsInUse exceeds limit", () => {
    expect(canAddSeat(6, 5)).toBe(false);
  });
});

describe("getSeatUsage", () => {
  it("returns organizationId and seat count for billing", () => {
    const memberships: OrganizationMembership[] = [
      membership({ organizationId: "org_abc", status: "active" }),
      membership({ organizationId: "org_abc", status: "active" }),
      membership({ organizationId: "org_abc", status: "pending" }),
    ];
    const usage: SeatUsage = getSeatUsage("org_abc", memberships);
    expect(usage.organizationId).toBe("org_abc");
    expect(usage.seatCount).toBe(2);
  });

  it("returns zero seats when no active members", () => {
    const memberships: OrganizationMembership[] = [
      membership({ organizationId: "org_x", status: "pending" }),
    ];
    const usage = getSeatUsage("org_x", memberships);
    expect(usage.seatCount).toBe(0);
  });
});

describe("getBillingSeatReport", () => {
  it("returns seat usage per organization for billing", () => {
    const organizations = [
      {
        organizationId: "org_a",
        memberships: [
          membership({ organizationId: "org_a", status: "active" }),
          membership({ organizationId: "org_a", status: "active" }),
          membership({ organizationId: "org_a", status: "pending" }),
        ],
      },
      {
        organizationId: "org_b",
        memberships: [
          membership({ organizationId: "org_b", status: "active" }),
        ],
      },
      {
        organizationId: "org_c",
        memberships: [],
      },
    ];
    const report = getBillingSeatReport(organizations);
    expect(report).toHaveLength(3);
    expect(report[0]).toEqual({ organizationId: "org_a", seatCount: 2 });
    expect(report[1]).toEqual({ organizationId: "org_b", seatCount: 1 });
    expect(report[2]).toEqual({ organizationId: "org_c", seatCount: 0 });
  });

  it("returns empty array when no organizations", () => {
    expect(getBillingSeatReport([])).toEqual([]);
  });
});

describe("canOrganizationAddMember", () => {
  it("returns true when seatLimit is null", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
      ],
      seatLimit: null,
    };
    expect(canOrganizationAddMember(info)).toBe(true);
  });

  it("returns true when below seat limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
      ],
      seatLimit: 5,
    };
    expect(canOrganizationAddMember(info)).toBe(true);
  });

  it("returns false when at seat limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
        membership({ userId: "u3", status: "active" }),
      ],
      seatLimit: 3,
    };
    expect(canOrganizationAddMember(info)).toBe(false);
  });

  it("returns false when over seat limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
        membership({ userId: "u3", status: "active" }),
      ],
      seatLimit: 2,
    };
    expect(canOrganizationAddMember(info)).toBe(false);
  });

  it("counts only active members toward limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
        membership({ userId: "u3", status: "pending" }),
      ],
      seatLimit: 2,
    };
    expect(canOrganizationAddMember(info)).toBe(false);
  });
});

describe("assertOrganizationCanAddMember", () => {
  it("does not throw when seatLimit is null", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
      ],
      seatLimit: null,
    };
    expect(() => assertOrganizationCanAddMember(info)).not.toThrow();
  });

  it("does not throw when below seat limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
      ],
      seatLimit: 5,
    };
    expect(() => assertOrganizationCanAddMember(info)).not.toThrow();
  });

  it("throws SeatLimitReachedError when at seat limit", () => {
    const info = {
      organizationId: "org_1",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
        membership({ userId: "u3", status: "active" }),
      ],
      seatLimit: 3,
    };
    expect(() => assertOrganizationCanAddMember(info)).toThrow(SeatLimitReachedError);
    try {
      assertOrganizationCanAddMember(info);
    } catch (e) {
      const err = e as SeatLimitReachedError;
      expect(err.organizationId).toBe("org_1");
      expect(err.seatCount).toBe(3);
      expect(err.seatLimit).toBe(3);
      expect(err.message).toContain("org_1");
      expect(err.message).toContain("3/3");
    }
  });

  it("throws SeatLimitReachedError when over seat limit", () => {
    const info = {
      organizationId: "org_2",
      memberships: [
        membership({ status: "active" }),
        membership({ userId: "u2", status: "active" }),
      ],
      seatLimit: 1,
    };
    expect(() => assertOrganizationCanAddMember(info)).toThrow(SeatLimitReachedError);
    try {
      assertOrganizationCanAddMember(info);
    } catch (e) {
      const err = e as SeatLimitReachedError;
      expect(err.organizationId).toBe("org_2");
      expect(err.seatCount).toBe(2);
      expect(err.seatLimit).toBe(1);
    }
  });
});

describe("getBillingSeatPayloads", () => {
  it("returns payloads with organizationId, seatCount, and at timestamp", () => {
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
    const payloads = getBillingSeatPayloads(organizations, at);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      organizationId: "org_a",
      seatCount: 2,
      at: "2026-02-23T12:00:00.000Z",
    });
    expect(payloads[1]).toEqual({
      organizationId: "org_b",
      seatCount: 0,
      at: "2026-02-23T12:00:00.000Z",
    });
  });

  it("uses current date when at not provided", () => {
    const organizations = [
      { organizationId: "org_x", memberships: [membership({ status: "active" })] },
    ];
    const payloads = getBillingSeatPayloads(organizations);
    expect(payloads).toHaveLength(1);
    const first = payloads[0]!;
    expect(first.organizationId).toBe("org_x");
    expect(first.seatCount).toBe(1);
    expect(first.at).toBeDefined();
    expect(new Date(first.at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(first.at).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("returns empty array when no organizations", () => {
    expect(getBillingSeatPayloads([])).toEqual([]);
  });
});
