import { describe, it, expect } from "vitest";
import {
  createTeam,
  getTeam,
  listTeams,
  updateTeam,
  deleteTeam,
  type Team,
  type TeamStore,
  type CreateTeamInput,
  type ListTeamsOptions,
} from "../src/team-crud.js";

function memoryStore(): TeamStore {
  const byId = new Map<string, Team>();
  const byOrgSlug = new Map<string, string>();

  function orgSlugKey(organizationId: string, slug: string): string {
    return `${organizationId}:${slug}`;
  }

  return {
    async create(data: CreateTeamInput): Promise<Team> {
      const slug = data.slug.toLowerCase();
      const key = orgSlugKey(data.organizationId, slug);
      if (byOrgSlug.has(key)) {
        const existing = byId.get(byOrgSlug.get(key)!);
        if (existing && !existing.deletedAt) {
          throw new Error("A team with this slug already exists in this organization");
        }
      }
      const id = `team_${byId.size + 1}`;
      const now = new Date().toISOString();
      const team: Team = {
        id,
        organizationId: data.organizationId,
        parentTeamId: data.parentTeamId ?? null,
        name: data.name.trim(),
        slug,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(id, team);
      byOrgSlug.set(key, id);
      return team;
    },
    async getById(id: string): Promise<Team | null> {
      return byId.get(id) ?? null;
    },
    async getByOrganizationAndSlug(organizationId: string, slug: string): Promise<Team | null> {
      const id = byOrgSlug.get(orgSlugKey(organizationId, slug.toLowerCase()));
      return id ? byId.get(id) ?? null : null;
    },
    async listByOrganization(organizationId: string, options?: ListTeamsOptions): Promise<Team[]> {
      let list = Array.from(byId.values()).filter((t) => t.organizationId === organizationId);
      if (!options?.includeDeleted) {
        list = list.filter((t) => !t.deletedAt);
      }
      if (options?.parentTeamId !== undefined) {
        list = list.filter((t) => t.parentTeamId === options.parentTeamId);
      }
      return list;
    },
    async update(id: string, data: Parameters<TeamStore["update"]>[1]): Promise<Team> {
      const existing = byId.get(id);
      if (!existing) throw new Error("Team not found");
      if (existing.deletedAt) throw new Error("Cannot update a deleted team");
      const slug = (data.slug ?? existing.slug).toLowerCase();
      if (slug !== existing.slug) {
        const key = orgSlugKey(existing.organizationId, slug);
        const otherId = byOrgSlug.get(key);
        if (otherId && otherId !== id) {
          const other = byId.get(otherId);
          if (other && !other.deletedAt) {
            throw new Error("A team with this slug already exists in this organization");
          }
        }
        byOrgSlug.delete(orgSlugKey(existing.organizationId, existing.slug));
        byOrgSlug.set(key, id);
      }
      const updated: Team = {
        ...existing,
        name: data.name ?? existing.name,
        slug,
        parentTeamId: data.parentTeamId !== undefined ? data.parentTeamId : existing.parentTeamId,
        updatedAt: new Date().toISOString(),
      };
      byId.set(id, updated);
      return updated;
    },
    async softDelete(id: string): Promise<void> {
      const team = byId.get(id);
      if (!team) return;
      const deleted = { ...team, deletedAt: new Date().toISOString() };
      byId.set(id, deleted);
      byOrgSlug.delete(orgSlugKey(team.organizationId, team.slug));
    },
  };
}

describe("createTeam", () => {
  it("creates a team with required fields", async () => {
    const store = memoryStore();
    const team = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    expect(team.id).toBeDefined();
    expect(team.organizationId).toBe("org_1");
    expect(team.name).toBe("Engineering");
    expect(team.slug).toBe("engineering");
    expect(team.parentTeamId).toBeNull();
    expect(team.deletedAt).toBeNull();
  });

  it("creates a child team with parentTeamId", async () => {
    const store = memoryStore();
    const parent = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    const child = await createTeam(store, {
      organizationId: "org_1",
      name: "Backend",
      slug: "backend",
      parentTeamId: parent.id,
    });
    expect(child.parentTeamId).toBe(parent.id);
  });

  it("normalizes slug to lowercase", async () => {
    const store = memoryStore();
    const team = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "ENGINEERING",
    });
    expect(team.slug).toBe("engineering");
  });

  it("rejects duplicate slug within same organization", async () => {
    const store = memoryStore();
    await createTeam(store, { organizationId: "org_1", name: "Eng", slug: "eng" });
    await expect(
      createTeam(store, { organizationId: "org_1", name: "Eng Two", slug: "eng" })
    ).rejects.toThrow("already exists");
  });

  it("allows same slug in different organizations", async () => {
    const store = memoryStore();
    const t1 = await createTeam(store, { organizationId: "org_1", name: "Eng", slug: "eng" });
    const t2 = await createTeam(store, { organizationId: "org_2", name: "Eng", slug: "eng" });
    expect(t1.id).not.toBe(t2.id);
    expect(t1.slug).toBe("eng");
    expect(t2.slug).toBe("eng");
  });

  it("rejects empty name", async () => {
    const store = memoryStore();
    await expect(
      createTeam(store, { organizationId: "org_1", name: "  ", slug: "eng" })
    ).rejects.toThrow("Name is required");
  });

  it("rejects invalid slug", async () => {
    const store = memoryStore();
    await expect(
      createTeam(store, { organizationId: "org_1", name: "Eng", slug: "invalid slug" })
    ).rejects.toThrow();
  });

  it("rejects parent team from different organization", async () => {
    const store = memoryStore();
    const parent = await createTeam(store, {
      organizationId: "org_1",
      name: "Eng",
      slug: "eng",
    });
    await expect(
      createTeam(store, {
        organizationId: "org_2",
        name: "Backend",
        slug: "backend",
        parentTeamId: parent.id,
      })
    ).rejects.toThrow("Parent team must belong to the same organization");
  });

  it("rejects non-existent parent team", async () => {
    const store = memoryStore();
    await expect(
      createTeam(store, {
        organizationId: "org_1",
        name: "Backend",
        slug: "backend",
        parentTeamId: "team_nonexistent",
      })
    ).rejects.toThrow("Parent team not found");
  });
});

describe("getTeam", () => {
  it("returns team by id", async () => {
    const store = memoryStore();
    const created = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    const found = await getTeam(store, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.slug).toBe("engineering");
  });

  it("returns team by slug when organizationId provided", async () => {
    const store = memoryStore();
    await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    const found = await getTeam(store, "engineering", "org_1");
    expect(found?.slug).toBe("engineering");
  });

  it("returns null for unknown id", async () => {
    const store = memoryStore();
    expect(await getTeam(store, "team_nonexistent")).toBeNull();
  });

  it("returns null for slug without organizationId", async () => {
    const store = memoryStore();
    await createTeam(store, { organizationId: "org_1", name: "Eng", slug: "eng" });
    expect(await getTeam(store, "eng")).toBeNull();
  });
});

describe("listTeams", () => {
  it("returns only non-deleted by default", async () => {
    const store = memoryStore();
    const t1 = await createTeam(store, { organizationId: "org_1", name: "A", slug: "a" });
    await createTeam(store, { organizationId: "org_1", name: "B", slug: "b" });
    await deleteTeam(store, t1.id);
    const list = await listTeams(store, "org_1");
    expect(list).toHaveLength(1);
    expect(list[0]!.slug).toBe("b");
  });

  it("filters by parentTeamId", async () => {
    const store = memoryStore();
    const parent = await createTeam(store, {
      organizationId: "org_1",
      name: "Eng",
      slug: "eng",
    });
    await createTeam(store, {
      organizationId: "org_1",
      name: "Backend",
      slug: "backend",
      parentTeamId: parent.id,
    });
    await createTeam(store, { organizationId: "org_1", name: "Other", slug: "other" });
    const children = await listTeams(store, "org_1", { parentTeamId: parent.id });
    expect(children).toHaveLength(1);
    expect(children[0]!.slug).toBe("backend");
  });
});

describe("updateTeam", () => {
  it("updates name and slug", async () => {
    const store = memoryStore();
    const created = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    const updated = await updateTeam(store, created.id, {
      name: "Eng Team",
      slug: "eng-team",
    });
    expect(updated.name).toBe("Eng Team");
    expect(updated.slug).toBe("eng-team");
  });

  it("throws when team not found", async () => {
    const store = memoryStore();
    await expect(updateTeam(store, "bad-id", { name: "X" })).rejects.toThrow("Team not found");
  });

  it("throws when updating deleted team", async () => {
    const store = memoryStore();
    const created = await createTeam(store, {
      organizationId: "org_1",
      name: "Eng",
      slug: "eng",
    });
    await deleteTeam(store, created.id);
    await expect(updateTeam(store, created.id, { name: "X" })).rejects.toThrow(
      "Cannot update a deleted team"
    );
  });

  it("rejects team as its own parent", async () => {
    const store = memoryStore();
    const team = await createTeam(store, {
      organizationId: "org_1",
      name: "Eng",
      slug: "eng",
    });
    await expect(
      updateTeam(store, team.id, { parentTeamId: team.id })
    ).rejects.toThrow("Team cannot be its own parent");
  });
});

describe("deleteTeam", () => {
  it("soft-deletes team", async () => {
    const store = memoryStore();
    const created = await createTeam(store, {
      organizationId: "org_1",
      name: "Engineering",
      slug: "engineering",
    });
    await deleteTeam(store, created.id);
    const list = await listTeams(store, "org_1");
    expect(list).toHaveLength(0);
    const withDeleted = await listTeams(store, "org_1", { includeDeleted: true });
    expect(withDeleted).toHaveLength(1);
    expect(withDeleted[0]!.deletedAt).not.toBeNull();
  });

  it("throws when team not found", async () => {
    const store = memoryStore();
    await expect(deleteTeam(store, "bad-id")).rejects.toThrow("Team not found");
  });
});
