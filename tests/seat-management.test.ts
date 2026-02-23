import { describe, it, expect } from "vitest";
import {
  countActiveSeats,
  canAddSeat,
  getSeatUsage,
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
