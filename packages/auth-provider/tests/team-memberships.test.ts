import { describe, it, expect } from "vitest";
import {
  addTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  getTeamMembership,
  getTeamMembershipByUserAndTeam,
  listTeamMembers,
  listUserTeamMemberships,
  type TeamMembership,
  type TeamMembershipStore,
  type CreateTeamMembershipInput,
  type UpdateTeamMembershipInput,
} from "../src/team-memberships.js";
import type { Team } from "../src/team-crud.js";
import type { MembershipStore } from "../src/membership-management.js";

function team(overrides: Partial<Team> & { id: string; organizationId: string; name: string; slug: string }): Team {
  return {
    id: overrides.id,
    organizationId: overrides.organizationId,
    parentTeamId: overrides.parentTeamId ?? null,
    name: overrides.name,
    slug: overrides.slug,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    deletedAt: overrides.deletedAt ?? null,
  };
}

function memoryTeamMembershipStore(): TeamMembershipStore {
  const byId = new Map<string, TeamMembership>();
  const byUserTeam = new Map<string, string>();

  function key(userId: string, teamId: string): string {
    return `${userId}:${teamId}`;
  }

  return {
    async create(data: CreateTeamMembershipInput): Promise<TeamMembership> {
      const k = key(data.userId, data.teamId);
      if (byUserTeam.has(k)) {
        throw new Error("User is already a member of this team");
      }
      const id = `tm_${byId.size + 1}`;
      const now = new Date().toISOString();
      const m: TeamMembership = {
        id,
        userId: data.userId,
        teamId: data.teamId,
        role: data.role,
        permissions: data.permissions ?? [],
        createdAt: now,
        updatedAt: now,
      };
      byId.set(id, m);
      byUserTeam.set(k, id);
      return m;
    },
    async getById(id: string): Promise<TeamMembership | null> {
      return byId.get(id) ?? null;
    },
    async getByUserAndTeam(userId: string, teamId: string): Promise<TeamMembership | null> {
      const id = byUserTeam.get(key(userId, teamId));
      return id ? byId.get(id) ?? null : null;
    },
    async listByTeam(teamId: string): Promise<TeamMembership[]> {
      return Array.from(byId.values()).filter((m) => m.teamId === teamId);
    },
    async listByUser(userId: string): Promise<TeamMembership[]> {
      return Array.from(byId.values()).filter((m) => m.userId === userId);
    },
    async update(id: string, data: UpdateTeamMembershipInput): Promise<TeamMembership> {
      const existing = byId.get(id);
      if (!existing) throw new Error("Team membership not found");
      const updated: TeamMembership = {
        ...existing,
        role: data.role ?? existing.role,
        permissions: data.permissions ?? existing.permissions,
        updatedAt: new Date().toISOString(),
      };
      byId.set(id, updated);
      return updated;
    },
    async delete(id: string): Promise<void> {
      const m = byId.get(id);
      if (m) {
        byId.delete(id);
        byUserTeam.delete(key(m.userId, m.teamId));
      }
    },
  };
}

function memoryMembershipStoreForOrg(organizationId: string, userIds: string[]): MembershipStore {
  const set = new Set(userIds);
  return {
    async getByUserAndOrg(userId: string, orgId: string) {
      if (orgId !== organizationId) return null;
      return set.has(userId) ? { id: "mem_1", userId, organizationId: orgId, role: "member" as const, permissions: [], metadata: {}, createdAt: "", updatedAt: "" } : null;
    },
  } as MembershipStore;
}

describe("addTeamMember", () => {
  it("adds a user who is org member to a team", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    const m = await addTeamMember(tmStore, memStore, t, "user_1", "member");
    expect(m.userId).toBe("user_1");
    expect(m.teamId).toBe("team_1");
    expect(m.role).toBe("member");
  });

  it("rejects user who is not org member", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    await expect(
      addTeamMember(tmStore, memStore, t, "user_other", "member")
    ).rejects.toThrow("User must be a member of the organization");
  });

  it("rejects duplicate team membership", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    await addTeamMember(tmStore, memStore, t, "user_1", "member");
    await expect(
      addTeamMember(tmStore, memStore, t, "user_1", "editor")
    ).rejects.toThrow("already a member of this team");
  });

  it("rejects invalid role", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    await expect(
      addTeamMember(tmStore, memStore, t, "user_1", "superadmin" as "member")
    ).rejects.toThrow("Invalid role");
  });
});

describe("removeTeamMember", () => {
  it("removes membership", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    const added = await addTeamMember(tmStore, memStore, t, "user_1", "member");
    await removeTeamMember(tmStore, added.id);
    const list = await listTeamMembers(tmStore, "team_1");
    expect(list).toHaveLength(0);
  });

  it("throws when membership not found", async () => {
    const tmStore = memoryTeamMembershipStore();
    await expect(removeTeamMember(tmStore, "tm_nonexistent")).rejects.toThrow(
      "Team membership not found"
    );
  });
});

describe("updateTeamMemberRole", () => {
  it("updates role", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    const added = await addTeamMember(tmStore, memStore, t, "user_1", "member");
    const updated = await updateTeamMemberRole(tmStore, added.id, "admin");
    expect(updated.role).toBe("admin");
  });

  it("throws when membership not found", async () => {
    const tmStore = memoryTeamMembershipStore();
    await expect(
      updateTeamMemberRole(tmStore, "tm_nonexistent", "admin")
    ).rejects.toThrow("Team membership not found");
  });
});

describe("getTeamMembership and list helpers", () => {
  it("getTeamMembership returns by id", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    const added = await addTeamMember(tmStore, memStore, t, "user_1", "member");
    const found = await getTeamMembership(tmStore, added.id);
    expect(found?.userId).toBe("user_1");
  });

  it("getTeamMembershipByUserAndTeam returns membership", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    await addTeamMember(tmStore, memStore, t, "user_1", "member");
    const found = await getTeamMembershipByUserAndTeam(tmStore, "user_1", "team_1");
    expect(found).not.toBeNull();
    expect(found?.role).toBe("member");
  });

  it("listTeamMembers returns all members of team", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1", "user_2"]);
    const t = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    await addTeamMember(tmStore, memStore, t, "user_1", "member");
    await addTeamMember(tmStore, memStore, t, "user_2", "admin");
    const list = await listTeamMembers(tmStore, "team_1");
    expect(list).toHaveLength(2);
  });

  it("listUserTeamMemberships returns all teams for user", async () => {
    const tmStore = memoryTeamMembershipStore();
    const memStore = memoryMembershipStoreForOrg("org_1", ["user_1"]);
    const t1 = team({ id: "team_1", organizationId: "org_1", name: "Eng", slug: "eng" });
    const t2 = team({ id: "team_2", organizationId: "org_1", name: "Product", slug: "product" });
    await addTeamMember(tmStore, memStore, t1, "user_1", "member");
    await addTeamMember(tmStore, memStore, t2, "user_1", "admin");
    const list = await listUserTeamMemberships(tmStore, "user_1");
    expect(list).toHaveLength(2);
  });
});
