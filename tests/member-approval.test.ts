import { describe, it, expect } from "vitest";
import {
  getNewMemberStatus,
  canApproveOrRejectMembers,
  approveMembership,
  rejectMembership,
  isActiveMember,
  isPendingMember,
  type OrganizationMembership,
} from "../src/member-approval.js";

describe("getNewMemberStatus", () => {
  it("returns pending when memberApprovalRequired is true", () => {
    expect(getNewMemberStatus({ memberApprovalRequired: true })).toBe(
      "pending"
    );
  });

  it("returns active when memberApprovalRequired is false", () => {
    expect(getNewMemberStatus({ memberApprovalRequired: false })).toBe(
      "active"
    );
  });

  it("returns active when memberApprovalRequired is undefined", () => {
    expect(getNewMemberStatus({})).toBe("active");
    expect(getNewMemberStatus({ memberApprovalRequired: undefined })).toBe(
      "active"
    );
  });
});

describe("canApproveOrRejectMembers", () => {
  it("returns true for owner and admin", () => {
    expect(canApproveOrRejectMembers("owner")).toBe(true);
    expect(canApproveOrRejectMembers("admin")).toBe(true);
  });

  it("returns false for editor, member, guest", () => {
    expect(canApproveOrRejectMembers("editor")).toBe(false);
    expect(canApproveOrRejectMembers("member")).toBe(false);
    expect(canApproveOrRejectMembers("guest")).toBe(false);
  });
});

describe("approveMembership", () => {
  const pendingMembership: OrganizationMembership = {
    userId: "u1",
    organizationId: "o1",
    role: "member",
    status: "pending",
  };

  it("sets status to active for pending membership", () => {
    const result = approveMembership(pendingMembership);
    expect(result.status).toBe("active");
    expect(result.userId).toBe("u1");
    expect(result.organizationId).toBe("o1");
  });

  it("does not mutate original membership", () => {
    approveMembership(pendingMembership);
    expect(pendingMembership.status).toBe("pending");
  });

  it("throws when membership is not pending", () => {
    expect(() =>
      approveMembership({ ...pendingMembership, status: "active" })
    ).toThrow("Only pending memberships can be approved");
    expect(() =>
      approveMembership({ ...pendingMembership, status: "rejected" })
    ).toThrow("Only pending memberships can be approved");
  });
});

describe("rejectMembership", () => {
  const pendingMembership: OrganizationMembership = {
    userId: "u1",
    organizationId: "o1",
    role: "member",
    status: "pending",
  };

  it("sets status to rejected for pending membership", () => {
    const result = rejectMembership(pendingMembership);
    expect(result.status).toBe("rejected");
    expect(result.userId).toBe("u1");
  });

  it("does not mutate original membership", () => {
    rejectMembership(pendingMembership);
    expect(pendingMembership.status).toBe("pending");
  });

  it("throws when membership is not pending", () => {
    expect(() =>
      rejectMembership({ ...pendingMembership, status: "active" })
    ).toThrow("Only pending memberships can be rejected");
    expect(() =>
      rejectMembership({ ...pendingMembership, status: "rejected" })
    ).toThrow("Only pending memberships can be rejected");
  });
});

describe("isActiveMember", () => {
  it("returns true for active membership", () => {
    expect(
      isActiveMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "active",
      })
    ).toBe(true);
  });

  it("returns false for pending or rejected", () => {
    expect(
      isActiveMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "pending",
      })
    ).toBe(false);
    expect(
      isActiveMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "rejected",
      })
    ).toBe(false);
  });
});

describe("isPendingMember", () => {
  it("returns true for pending membership", () => {
    expect(
      isPendingMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "pending",
      })
    ).toBe(true);
  });

  it("returns false for active or rejected", () => {
    expect(
      isPendingMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "active",
      })
    ).toBe(false);
    expect(
      isPendingMember({
        userId: "u1",
        organizationId: "o1",
        role: "member",
        status: "rejected",
      })
    ).toBe(false);
  });
});

describe("approval workflow: new member approval required", () => {
  it("new member gets pending when org requires approval, then admin can approve", () => {
    const orgSettings = { memberApprovalRequired: true };
    const status = getNewMemberStatus(orgSettings);
    expect(status).toBe("pending");

    const newMembership: OrganizationMembership = {
      userId: "new-user",
      organizationId: "org-1",
      role: "member",
      status,
    };
    expect(isPendingMember(newMembership)).toBe(true);
    expect(isActiveMember(newMembership)).toBe(false);
    expect(canApproveOrRejectMembers("admin")).toBe(true);

    const approved = approveMembership(newMembership);
    expect(approved.status).toBe("active");
    expect(isActiveMember(approved)).toBe(true);
    expect(isPendingMember(approved)).toBe(false);
  });

  it("new member gets active when org does not require approval", () => {
    const status = getNewMemberStatus({ memberApprovalRequired: false });
    expect(status).toBe("active");
    expect(
      isActiveMember({
        userId: "u",
        organizationId: "o",
        role: "member",
        status,
      })
    ).toBe(true);
  });

  it("admin can reject pending member", () => {
    const pending: OrganizationMembership = {
      userId: "u",
      organizationId: "o",
      role: "member",
      status: "pending",
    };
    const rejected = rejectMembership(pending);
    expect(rejected.status).toBe("rejected");
    expect(isActiveMember(rejected)).toBe(false);
    expect(isPendingMember(rejected)).toBe(false);
  });
});
