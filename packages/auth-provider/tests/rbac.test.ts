import { describe, it, expect } from "vitest";
import {
  getDefaultPermissionsForRole,
  getEffectivePermissions,
  hasPermission,
  requirePermission,
  ALL_PERMISSIONS,
  PERMISSION_ORG_READ,
  PERMISSION_ORG_DELETE,
  PERMISSION_ORG_BILLING,
  PERMISSION_MEMBERS_WRITE,
  PERMISSION_CONTENT_READ,
  type MembershipLike,
} from "../src/rbac.js";
import type { MemberRole } from "../src/member-approval.js";

const ROLES: MemberRole[] = ["owner", "admin", "editor", "member", "guest"];

function membership(role: MemberRole, permissions: string[] = []): MembershipLike {
  return { role, permissions };
}

describe("getDefaultPermissionsForRole", () => {
  it("returns non-empty permissions for every role", () => {
    for (const role of ROLES) {
      const perms = getDefaultPermissionsForRole(role);
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
    }
  });

  it("owner has all permissions", () => {
    const perms = getDefaultPermissionsForRole("owner");
    for (const p of ALL_PERMISSIONS) {
      expect(perms).toContain(p);
    }
  });

  it("admin has org and members and settings but not org:delete or org:billing", () => {
    const perms = getDefaultPermissionsForRole("admin");
    expect(perms).toContain(PERMISSION_ORG_READ);
    expect(perms).toContain(PERMISSION_MEMBERS_WRITE);
    expect(perms).not.toContain(PERMISSION_ORG_DELETE);
    expect(perms).not.toContain(PERMISSION_ORG_BILLING);
  });

  it("guest has only content:read", () => {
    const perms = getDefaultPermissionsForRole("guest");
    expect(perms).toContain(PERMISSION_CONTENT_READ);
    expect(perms).not.toContain(PERMISSION_ORG_READ);
    expect(perms).not.toContain(PERMISSION_MEMBERS_WRITE);
  });
});

describe("getEffectivePermissions", () => {
  it("returns role permissions when no custom permissions", () => {
    const m = membership("member");
    const effective = getEffectivePermissions(m);
    expect(effective).toContain(PERMISSION_ORG_READ);
    expect(effective).toContain(PERMISSION_CONTENT_READ);
  });

  it("merges custom permissions with role permissions", () => {
    const m = membership("guest", ["org:read"]);
    const effective = getEffectivePermissions(m);
    expect(effective).toContain(PERMISSION_CONTENT_READ);
    expect(effective).toContain(PERMISSION_ORG_READ);
  });

  it("deduplicates permissions", () => {
    const m = membership("member", [PERMISSION_ORG_READ]);
    const effective = getEffectivePermissions(m);
    expect(effective.filter((p) => p === PERMISSION_ORG_READ).length).toBe(1);
  });

  it("handles empty permissions array", () => {
    const m = membership("editor", []);
    const effective = getEffectivePermissions(m);
    expect(effective.length).toBeGreaterThan(0);
  });
});

describe("hasPermission", () => {
  it("returns true when role grants permission", () => {
    expect(hasPermission(membership("owner"), PERMISSION_ORG_DELETE)).toBe(true);
    expect(hasPermission(membership("admin"), PERMISSION_MEMBERS_WRITE)).toBe(true);
    expect(hasPermission(membership("member"), PERMISSION_CONTENT_READ)).toBe(true);
  });

  it("returns false when role does not grant permission", () => {
    expect(hasPermission(membership("guest"), PERMISSION_ORG_READ)).toBe(false);
    expect(hasPermission(membership("member"), PERMISSION_MEMBERS_WRITE)).toBe(false);
    expect(hasPermission(membership("admin"), PERMISSION_ORG_DELETE)).toBe(false);
  });

  it("returns true when custom permission adds it", () => {
    const m = membership("guest", [PERMISSION_ORG_READ]);
    expect(hasPermission(m, PERMISSION_ORG_READ)).toBe(true);
  });

  it("returns false for unknown permission string", () => {
    expect(hasPermission(membership("owner"), "unknown:permission")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("does not throw when membership has permission", () => {
    expect(() =>
      requirePermission(membership("owner"), PERMISSION_ORG_DELETE)
    ).not.toThrow();
    expect(() =>
      requirePermission(membership("member", [PERMISSION_ORG_BILLING]), PERMISSION_ORG_BILLING)
    ).not.toThrow();
  });

  it("throws with message including permission when denied", () => {
    expect(() =>
      requirePermission(membership("guest"), PERMISSION_ORG_READ)
    ).toThrow("Permission denied");
    expect(() =>
      requirePermission(membership("guest"), PERMISSION_ORG_READ)
    ).toThrow(PERMISSION_ORG_READ);
  });
});
