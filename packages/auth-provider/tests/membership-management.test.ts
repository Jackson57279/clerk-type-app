import { describe, it, expect } from "vitest";
import {
  addMember,
  removeMember,
  updateMemberRole,
  getMembership,
  getMembershipByUserAndOrg,
  listOrganizationMembers,
  listUserMemberships,
  validateRole,
  countMembers,
  canAddMember,
  MEMBERSHIP_ROLES,
  type Membership,
  type MembershipStore,
  type CreateMembershipInput,
  type UpdateMembershipInput,
} from "../src/membership-management.js";
import type { Organization } from "../src/organization-crud.js";

function memoryStore(): MembershipStore {
  const byId = new Map<string, Membership>();
  const byUserOrg = new Map<string, string>();

  function key(userId: string, orgId: string): string {
    return `${userId}:${orgId}`;
  }

  return {
    async create(data: CreateMembershipInput): Promise<Membership> {
      const k = key(data.userId, data.organizationId);
      if (byUserOrg.has(k)) {
        throw new Error("User is already a member of this organization");
      }
      const id = `mem_${byId.size + 1}`;
      const now = new Date().toISOString();
      const m: Membership = {
        id,
        userId: data.userId,
        organizationId: data.organizationId,
        role: data.role,
        permissions: data.permissions ?? [],
        metadata: data.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      };
      byId.set(id, m);
      byUserOrg.set(k, id);
      return m;
    },
    async getById(id: string): Promise<Membership | null> {
      return byId.get(id) ?? null;
    },
    async getByUserAndOrg(userId: string, organizationId: string): Promise<Membership | null> {
      const id = byUserOrg.get(key(userId, organizationId));
      return id ? byId.get(id) ?? null : null;
    },
    async listByOrganization(organizationId: string): Promise<Membership[]> {
      return Array.from(byId.values()).filter((m) => m.organizationId === organizationId);
    },
    async listByUser(userId: string): Promise<Membership[]> {
      return Array.from(byId.values()).filter((m) => m.userId === userId);
    },
    async update(id: string, data: UpdateMembershipInput): Promise<Membership> {
      const existing = byId.get(id);
      if (!existing) throw new Error("Membership not found");
      const updated: Membership = {
        ...existing,
        role: data.role ?? existing.role,
        permissions: data.permissions ?? existing.permissions,
        metadata: data.metadata ?? existing.metadata,
        updatedAt: new Date().toISOString(),
      };
      byId.set(id, updated);
      return updated;
    },
    async delete(id: string): Promise<void> {
      const m = byId.get(id);
      if (m) {
        byId.delete(id);
        byUserOrg.delete(key(m.userId, m.organizationId));
      }
    },
  };
}

function org(overrides: Partial<Organization> & { id: string; name: string; slug: string }): Organization {
  return {
    id: overrides.id,
    name: overrides.name,
    slug: overrides.slug,
    logoUrl: null,
    primaryColor: null,
    faviconUrl: null,
    maxMembers: overrides.maxMembers ?? null,
    allowedDomains: [],
    customDomains: [],
    requireEmailVerification: true,
    samlEnabled: false,
    samlConfig: null,
    scimEnabled: false,
    scimTokenHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

describe("validateRole", () => {
  it("accepts all valid roles", () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(() => validateRole(role)).not.toThrow();
    }
  });

  it("rejects invalid role", () => {
    expect(() => validateRole("superadmin")).toThrow("Invalid role");
    expect(() => validateRole("")).toThrow();
  });
});

describe("addMember", () => {
  it("creates a membership with given role", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const m = await addMember(store, o, "user_1", "member");
    expect(m.userId).toBe("user_1");
    expect(m.organizationId).toBe("org_1");
    expect(m.role).toBe("member");
    expect(m.permissions).toEqual([]);
    expect(m.metadata).toEqual({});
    expect(m.id).toBeDefined();
    expect(m.createdAt).toBeDefined();
    expect(m.updatedAt).toBeDefined();
  });

  it("rejects duplicate user in same org", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await addMember(store, o, "user_1", "member");
    await expect(addMember(store, o, "user_1", "admin")).rejects.toThrow(
      "already a member"
    );
  });

  it("respects maxMembers limit", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme", maxMembers: 2 });
    await addMember(store, o, "user_1", "owner");
    await addMember(store, o, "user_2", "member");
    await expect(addMember(store, o, "user_3", "member")).rejects.toThrow(
      "Seat limit"
    );
  });

  it("allows adding when maxMembers is null", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme", maxMembers: null });
    await addMember(store, o, "user_1", "owner");
    await addMember(store, o, "user_2", "member");
    const list = await listOrganizationMembers(store, "org_1");
    expect(list).toHaveLength(2);
  });

  it("rejects invalid role", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await expect(
      addMember(store, o, "user_1", "invalid" as "member")
    ).rejects.toThrow("Invalid role");
  });
});

describe("removeMember", () => {
  it("removes a non-owner member", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const owner = await addMember(store, o, "user_1", "owner");
    const member = await addMember(store, o, "user_2", "member");
    await removeMember(store, member.id);
    const list = await listOrganizationMembers(store, "org_1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(owner.id);
  });

  it("rejects removing the last owner", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const owner = await addMember(store, o, "user_1", "owner");
    await expect(removeMember(store, owner.id)).rejects.toThrow(
      "Cannot remove the last owner"
    );
  });

  it("allows removing an owner when another owner exists", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const owner1 = await addMember(store, o, "user_1", "owner");
    await addMember(store, o, "user_2", "owner");
    await removeMember(store, owner1.id);
    const list = await listOrganizationMembers(store, "org_1");
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("owner");
  });

  it("throws when membership not found", async () => {
    const store = memoryStore();
    await expect(removeMember(store, "mem_none")).rejects.toThrow(
      "Membership not found"
    );
  });
});

describe("updateMemberRole", () => {
  it("updates role", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const m = await addMember(store, o, "user_1", "member");
    const updated = await updateMemberRole(store, m.id, "admin");
    expect(updated.role).toBe("admin");
    const got = await getMembership(store, m.id);
    expect(got?.role).toBe("admin");
  });

  it("rejects demoting the last owner", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const owner = await addMember(store, o, "user_1", "owner");
    await expect(updateMemberRole(store, owner.id, "member")).rejects.toThrow(
      "Cannot demote the last owner"
    );
  });

  it("allows demoting one owner when another exists", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const owner1 = await addMember(store, o, "user_1", "owner");
    await addMember(store, o, "user_2", "owner");
    const updated = await updateMemberRole(store, owner1.id, "admin");
    expect(updated.role).toBe("admin");
  });

  it("throws when membership not found", async () => {
    const store = memoryStore();
    await expect(updateMemberRole(store, "mem_none", "admin")).rejects.toThrow(
      "Membership not found"
    );
  });

  it("rejects invalid role", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const m = await addMember(store, o, "user_1", "member");
    await expect(
      updateMemberRole(store, m.id, "invalid" as "member")
    ).rejects.toThrow("Invalid role");
  });
});

describe("getMembership", () => {
  it("returns membership by id", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const created = await addMember(store, o, "user_1", "member");
    const found = await getMembership(store, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.userId).toBe("user_1");
  });

  it("returns null for unknown id", async () => {
    const store = memoryStore();
    expect(await getMembership(store, "mem_none")).toBeNull();
  });
});

describe("getMembershipByUserAndOrg", () => {
  it("returns membership when exists", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await addMember(store, o, "user_1", "member");
    const found = await getMembershipByUserAndOrg(store, "user_1", "org_1");
    expect(found).not.toBeNull();
    expect(found?.userId).toBe("user_1");
    expect(found?.organizationId).toBe("org_1");
  });

  it("returns null when no membership", async () => {
    const store = memoryStore();
    expect(
      await getMembershipByUserAndOrg(store, "user_1", "org_1")
    ).toBeNull();
  });
});

describe("listOrganizationMembers", () => {
  it("returns all members of an organization", async () => {
    const store = memoryStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await addMember(store, o, "user_1", "owner");
    await addMember(store, o, "user_2", "member");
    const list = await listOrganizationMembers(store, "org_1");
    expect(list).toHaveLength(2);
    const userIds = list.map((m) => m.userId).sort();
    expect(userIds).toEqual(["user_1", "user_2"]);
  });

  it("returns empty array for org with no members", async () => {
    const store = memoryStore();
    expect(await listOrganizationMembers(store, "org_1")).toEqual([]);
  });
});

describe("listUserMemberships", () => {
  it("returns all org memberships for a user", async () => {
    const store = memoryStore();
    const o1 = org({ id: "org_1", name: "Acme", slug: "acme" });
    const o2 = org({ id: "org_2", name: "Beta", slug: "beta" });
    await addMember(store, o1, "user_1", "owner");
    await addMember(store, o2, "user_1", "member");
    const list = await listUserMemberships(store, "user_1");
    expect(list).toHaveLength(2);
    const orgIds = list.map((m) => m.organizationId).sort();
    expect(orgIds).toEqual(["org_1", "org_2"]);
  });

  it("returns empty array for user with no memberships", async () => {
    const store = memoryStore();
    expect(await listUserMemberships(store, "user_1")).toEqual([]);
  });
});

describe("countMembers", () => {
  it("returns length of memberships array", () => {
    const list: Membership[] = [
      { id: "1", userId: "u1", organizationId: "o1", role: "member", permissions: [], metadata: {}, createdAt: "", updatedAt: "" },
      { id: "2", userId: "u2", organizationId: "o1", role: "member", permissions: [], metadata: {}, createdAt: "", updatedAt: "" },
    ];
    expect(countMembers(list)).toBe(2);
    expect(countMembers([])).toBe(0);
  });
});

describe("canAddMember", () => {
  it("returns true when maxMembers is null", () => {
    const o = org({ id: "o1", name: "A", slug: "a", maxMembers: null });
    expect(canAddMember(o, 100)).toBe(true);
  });

  it("returns true when under limit", () => {
    const o = org({ id: "o1", name: "A", slug: "a", maxMembers: 5 });
    expect(canAddMember(o, 3)).toBe(true);
  });

  it("returns false when at or over limit", () => {
    const o = org({ id: "o1", name: "A", slug: "a", maxMembers: 5 });
    expect(canAddMember(o, 5)).toBe(false);
    expect(canAddMember(o, 6)).toBe(false);
  });
});
