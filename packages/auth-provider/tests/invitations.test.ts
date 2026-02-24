import { describe, it, expect } from "vitest";
import {
  createInvitation,
  getInvitation,
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation,
  listOrganizationInvitations,
  isInvitationExpired,
  isInvitationValid,
  INVITATION_EXPIRY_DAYS,
  type Invitation,
  type InvitationStore,
  type InvitationStatus,
} from "../src/invitations.js";
import type { Organization } from "../src/organization-crud.js";
import {
  addMember,
  listOrganizationMembers,
  type MembershipStore,
  type Membership,
  type CreateMembershipInput,
  type UpdateMembershipInput,
} from "../src/membership-management.js";

function memoryInvitationStore(): InvitationStore {
  const byId = new Map<string, Invitation>();
  const byToken = new Map<string, string>();

  return {
    async create(data): Promise<Invitation> {
      const id = `inv_${byId.size + 1}`;
      const now = new Date().toISOString();
      const inv: Invitation = {
        id,
        organizationId: data.organizationId,
        email: data.email,
        role: data.role as Invitation["role"],
        token: data.token,
        invitedByUserId: data.invitedByUserId,
        status: "pending",
        expiresAt: data.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      byId.set(id, inv);
      byToken.set(data.token, id);
      return inv;
    },
    async getById(id: string): Promise<Invitation | null> {
      return byId.get(id) ?? null;
    },
    async getByToken(token: string): Promise<Invitation | null> {
      const id = byToken.get(token);
      return id ? byId.get(id) ?? null : null;
    },
    async getPendingByEmailAndOrg(email: string, organizationId: string): Promise<Invitation | null> {
      const lower = email.toLowerCase();
      for (const inv of byId.values()) {
        if (inv.organizationId === organizationId && inv.email === lower && inv.status === "pending") {
          return inv;
        }
      }
      return null;
    },
    async listByOrganization(organizationId: string, status?: InvitationStatus): Promise<Invitation[]> {
      let list = Array.from(byId.values()).filter((i) => i.organizationId === organizationId);
      if (status !== undefined) {
        list = list.filter((i) => i.status === status);
      }
      return list;
    },
    async updateStatus(id: string, status: InvitationStatus): Promise<Invitation> {
      const existing = byId.get(id);
      if (!existing) throw new Error("Invitation not found");
      const updated: Invitation = { ...existing, status, updatedAt: new Date().toISOString() };
      byId.set(id, updated);
      return updated;
    },
  };
}

function memoryMembershipStore(): MembershipStore {
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

describe("isInvitationExpired / isInvitationValid", () => {
  it("isInvitationExpired returns false for future expiry", () => {
    const inv: Invitation = {
      id: "1",
      organizationId: "o1",
      email: "a@b.com",
      role: "member",
      token: "t",
      invitedByUserId: null,
      status: "pending",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: "",
      updatedAt: "",
    };
    expect(isInvitationExpired(inv)).toBe(false);
    expect(isInvitationValid(inv)).toBe(true);
  });

  it("isInvitationExpired returns true for past expiry", () => {
    const inv: Invitation = {
      id: "1",
      organizationId: "o1",
      email: "a@b.com",
      role: "member",
      token: "t",
      invitedByUserId: null,
      status: "pending",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: "",
      updatedAt: "",
    };
    expect(isInvitationExpired(inv)).toBe(true);
    expect(isInvitationValid(inv)).toBe(false);
  });

  it("isInvitationValid returns false for non-pending status", () => {
    const inv: Invitation = {
      id: "1",
      organizationId: "o1",
      email: "a@b.com",
      role: "member",
      token: "t",
      invitedByUserId: null,
      status: "accepted",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: "",
      updatedAt: "",
    };
    expect(isInvitationValid(inv)).toBe(false);
  });
});

describe("createInvitation", () => {
  it("creates invitation with default expiry and normalizes email", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "  User@Example.com  ",
      role: "member",
    });
    expect(inv.organizationId).toBe("org_1");
    expect(inv.email).toBe("user@example.com");
    expect(inv.role).toBe("member");
    expect(inv.status).toBe("pending");
    expect(inv.token).toBeDefined();
    expect(inv.token.length).toBeGreaterThan(0);
    expect(inv.invitedByUserId).toBeNull();
    const expiresAt = new Date(inv.expiresAt);
    const expected = new Date();
    expected.setDate(expected.getDate() + INVITATION_EXPIRY_DAYS);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expected.getTime() - 5000);
  });

  it("rejects empty email", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await expect(
      createInvitation(invStore, o, memStore, {
        organizationId: "org_1",
        email: "   ",
        role: "member",
      })
    ).rejects.toThrow("Email is required");
  });

  it("rejects invalid role", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await expect(
      createInvitation(invStore, o, memStore, {
        organizationId: "org_1",
        email: "u@e.com",
        role: "invalid" as "member",
      })
    ).rejects.toThrow("Invalid role");
  });

  it("rejects duplicate pending invitation for same email and org", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "same@example.com",
      role: "member",
    });
    await expect(
      createInvitation(invStore, o, memStore, {
        organizationId: "org_1",
        email: "same@example.com",
        role: "admin",
      })
    ).rejects.toThrow("A pending invitation already exists");
  });

  it("respects seat limit", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme", maxMembers: 1 });
    await addMember(memStore, o, "user_1", "owner");
    await expect(
      createInvitation(invStore, o, memStore, {
        organizationId: "org_1",
        email: "new@example.com",
        role: "member",
      })
    ).rejects.toThrow("Seat limit");
  });

  it("stores invitedByUserId when provided", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "editor",
      invitedByUserId: "user_admin",
    });
    expect(inv.invitedByUserId).toBe("user_admin");
  });
});

describe("getInvitation / getInvitationByToken", () => {
  it("getInvitation returns invitation by id", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const created = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    const found = await getInvitation(invStore, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe("u@e.com");
  });

  it("getInvitation returns null for unknown id", async () => {
    const invStore = memoryInvitationStore();
    expect(await getInvitation(invStore, "inv_none")).toBeNull();
  });

  it("getInvitationByToken returns invitation by token", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const created = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    const found = await getInvitationByToken(invStore, created.token);
    expect(found?.id).toBe(created.id);
    expect(found?.token).toBe(created.token);
  });
});

describe("acceptInvitation", () => {
  it("creates membership and marks invitation accepted", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "newuser@example.com",
      role: "editor",
    });
    const { invitation: updated, membership } = await acceptInvitation(
      invStore,
      memStore,
      o,
      inv.token,
      "user_new"
    );
    expect(updated.status).toBe("accepted");
    expect(membership.userId).toBe("user_new");
    expect(membership.organizationId).toBe("org_1");
    expect(membership.role).toBe("editor");
    const members = await listOrganizationMembers(memStore, "org_1");
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe("user_new");
  });

  it("calls emitWebhook when provided", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    const payloads: { type: string; data: Record<string, unknown> }[] = [];
    await acceptInvitation(invStore, memStore, o, inv.token, "user_1", {
      emitWebhook: async (p) => {
        payloads.push({ type: p.type, data: p.data as Record<string, unknown> });
      },
    });
    expect(payloads).toHaveLength(1);
    const p = payloads[0]!;
    expect(p.type).toBe("organization_invitation.accepted");
    expect(p.data.organization_id).toBe("org_1");
    expect(p.data.user_id).toBe("user_1");
    expect(p.data.role).toBe("member");
  });

  it("rejects wrong organization", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o1 = org({ id: "org_1", name: "Acme", slug: "acme" });
    const o2 = org({ id: "org_2", name: "Beta", slug: "beta" });
    const inv = await createInvitation(invStore, o1, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    await expect(
      acceptInvitation(invStore, memStore, o2, inv.token, "user_1")
    ).rejects.toThrow("does not belong to this organization");
  });

  it("rejects unknown token", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await expect(
      acceptInvitation(invStore, memStore, o, "nonexistent-token", "user_1")
    ).rejects.toThrow("Invitation not found");
  });

  it("rejects already accepted invitation", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    await acceptInvitation(invStore, memStore, o, inv.token, "user_1");
    await expect(
      acceptInvitation(invStore, memStore, o, inv.token, "user_2")
    ).rejects.toThrow("no longer valid");
  });
});

describe("revokeInvitation", () => {
  it("updates status to revoked", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    const updated = await revokeInvitation(invStore, inv.id);
    expect(updated.status).toBe("revoked");
    const found = await getInvitation(invStore, inv.id);
    expect(found?.status).toBe("revoked");
  });

  it("rejects revoking non-pending invitation", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "u@e.com",
      role: "member",
    });
    await acceptInvitation(invStore, memStore, o, inv.token, "user_1");
    await expect(revokeInvitation(invStore, inv.id)).rejects.toThrow(
      "Cannot revoke invitation with status: accepted"
    );
  });

  it("throws when invitation not found", async () => {
    const invStore = memoryInvitationStore();
    await expect(revokeInvitation(invStore, "inv_none")).rejects.toThrow(
      "Invitation not found"
    );
  });
});

describe("listOrganizationInvitations", () => {
  it("returns all invitations for org", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "a@e.com",
      role: "member",
    });
    await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "b@e.com",
      role: "admin",
    });
    const list = await listOrganizationInvitations(invStore, "org_1");
    expect(list).toHaveLength(2);
    const emails = list.map((i) => i.email).sort();
    expect(emails).toEqual(["a@e.com", "b@e.com"]);
  });

  it("filters by status when provided", async () => {
    const invStore = memoryInvitationStore();
    const memStore = memoryMembershipStore();
    const o = org({ id: "org_1", name: "Acme", slug: "acme" });
    const inv1 = await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "a@e.com",
      role: "member",
    });
    await createInvitation(invStore, o, memStore, {
      organizationId: "org_1",
      email: "b@e.com",
      role: "member",
    });
    await acceptInvitation(invStore, memStore, o, inv1.token, "user_1");
    const pending = await listOrganizationInvitations(invStore, "org_1", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.email).toBe("b@e.com");
    const accepted = await listOrganizationInvitations(invStore, "org_1", "accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.email).toBe("a@e.com");
  });

  it("returns empty array for org with no invitations", async () => {
    const invStore = memoryInvitationStore();
    expect(await listOrganizationInvitations(invStore, "org_1")).toEqual([]);
  });
});
