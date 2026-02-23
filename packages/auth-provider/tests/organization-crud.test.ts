import { describe, it, expect } from "vitest";
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
  deleteOrganization,
  validateSlug,
  type Organization,
  type OrganizationStore,
  type CreateOrganizationInput,
} from "../src/organization-crud.js";

function memoryStore(): OrganizationStore {
  const byId = new Map<string, Organization>();
  const bySlug = new Map<string, string>();

  function toOrg(partial: Partial<Organization> & { id: string; name: string; slug: string }): Organization {
    const now = new Date().toISOString();
    return {
      id: partial.id,
      name: partial.name,
      slug: partial.slug,
      logoUrl: partial.logoUrl ?? null,
      primaryColor: partial.primaryColor ?? null,
      faviconUrl: partial.faviconUrl ?? null,
      maxMembers: partial.maxMembers ?? null,
      allowedDomains: partial.allowedDomains ?? [],
      customDomains: partial.customDomains ?? [],
      requireEmailVerification: partial.requireEmailVerification ?? true,
      samlEnabled: partial.samlEnabled ?? false,
      samlConfig: partial.samlConfig ?? null,
      scimEnabled: partial.scimEnabled ?? false,
      scimTokenHash: partial.scimTokenHash ?? null,
      createdAt: partial.createdAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      deletedAt: partial.deletedAt ?? null,
    };
  }

  return {
    async create(data: CreateOrganizationInput): Promise<Organization> {
      const id = `org_${byId.size + 1}`;
      const slug = data.slug.toLowerCase();
      const existingId = bySlug.get(slug);
      if (existingId) {
        const existing = byId.get(existingId);
        if (existing && !existing.deletedAt) {
          throw new Error("An organization with this slug already exists");
        }
      }
      const org = toOrg({
        id,
        name: data.name,
        slug,
        logoUrl: data.logoUrl ?? null,
        primaryColor: data.primaryColor ?? null,
        faviconUrl: data.faviconUrl ?? null,
        maxMembers: data.maxMembers ?? null,
        allowedDomains: data.allowedDomains ?? [],
        customDomains: data.customDomains ?? [],
        requireEmailVerification: data.requireEmailVerification ?? true,
        samlEnabled: data.samlEnabled ?? false,
        samlConfig: data.samlConfig ?? null,
        scimEnabled: data.scimEnabled ?? false,
        scimTokenHash: data.scimTokenHash ?? null,
      });
      byId.set(id, org);
      bySlug.set(slug, id);
      return org;
    },
    async getById(id: string): Promise<Organization | null> {
      return byId.get(id) ?? null;
    },
    async getBySlug(slug: string): Promise<Organization | null> {
      const id = bySlug.get(slug.toLowerCase());
      if (!id) return null;
      const org = byId.get(id);
      return org ?? null;
    },
    async list(options?: { includeDeleted?: boolean }): Promise<Organization[]> {
      const list = Array.from(byId.values());
      if (options?.includeDeleted) {
        return list;
      }
      return list.filter((o) => !o.deletedAt);
    },
    async update(id: string, data: Parameters<OrganizationStore["update"]>[1]): Promise<Organization> {
      const existing = byId.get(id);
      if (!existing) throw new Error("Organization not found");
      if (existing.deletedAt) throw new Error("Cannot update a deleted organization");
      const slug = (data.slug ?? existing.slug).toLowerCase();
      if (slug !== existing.slug) {
        const otherId = bySlug.get(slug);
        if (otherId && otherId !== id) {
          const other = byId.get(otherId);
          if (other && !other.deletedAt) throw new Error("An organization with this slug already exists");
        }
        bySlug.delete(existing.slug);
        bySlug.set(slug, id);
      }
      const updated: Organization = {
        ...existing,
        name: data.name ?? existing.name,
        slug,
        logoUrl: data.logoUrl !== undefined ? data.logoUrl : existing.logoUrl,
        primaryColor: data.primaryColor !== undefined ? data.primaryColor : existing.primaryColor,
        faviconUrl: data.faviconUrl !== undefined ? data.faviconUrl : existing.faviconUrl,
        maxMembers: data.maxMembers !== undefined ? data.maxMembers : existing.maxMembers,
        allowedDomains: data.allowedDomains ?? existing.allowedDomains,
        customDomains: data.customDomains ?? existing.customDomains,
        requireEmailVerification: data.requireEmailVerification ?? existing.requireEmailVerification,
        samlEnabled: data.samlEnabled ?? existing.samlEnabled,
        samlConfig: data.samlConfig !== undefined ? data.samlConfig : existing.samlConfig,
        scimEnabled: data.scimEnabled ?? existing.scimEnabled,
        scimTokenHash: data.scimTokenHash !== undefined ? data.scimTokenHash : existing.scimTokenHash,
        updatedAt: new Date().toISOString(),
      };
      byId.set(id, updated);
      return updated;
    },
    async softDelete(id: string): Promise<void> {
      const org = byId.get(id);
      if (!org) return;
      const deleted = { ...org, deletedAt: new Date().toISOString() };
      byId.set(id, deleted);
      bySlug.delete(org.slug);
    },
  };
}

describe("validateSlug", () => {
  it("accepts valid slugs", () => {
    expect(() => validateSlug("acme")).not.toThrow();
    expect(() => validateSlug("acme-corp")).not.toThrow();
    expect(() => validateSlug("org-123")).not.toThrow();
  });

  it("rejects empty slug", () => {
    expect(() => validateSlug("")).toThrow("non-empty");
  });

  it("rejects uppercase", () => {
    expect(() => validateSlug("Acme")).toThrow("lowercase");
  });

  it("rejects spaces", () => {
    expect(() => validateSlug("acme corp")).toThrow();
  });
});

describe("createOrganization", () => {
  it("creates an organization with required fields", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme Inc", slug: "acme" });
    expect(org.id).toBeDefined();
    expect(org.name).toBe("Acme Inc");
    expect(org.slug).toBe("acme");
    expect(org.requireEmailVerification).toBe(true);
    expect(org.samlEnabled).toBe(false);
    expect(org.deletedAt).toBeNull();
  });

  it("normalizes slug to lowercase", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "ACME" });
    expect(org.slug).toBe("acme");
  });

  it("rejects duplicate slug", async () => {
    const store = memoryStore();
    await createOrganization(store, { name: "Acme", slug: "acme" });
    await expect(createOrganization(store, { name: "Acme Two", slug: "acme" })).rejects.toThrow(
      "already exists"
    );
  });

  it("rejects empty name", async () => {
    const store = memoryStore();
    await expect(createOrganization(store, { name: "  ", slug: "acme" })).rejects.toThrow("Name is required");
  });

  it("rejects invalid slug", async () => {
    const store = memoryStore();
    await expect(createOrganization(store, { name: "Acme", slug: "invalid slug" })).rejects.toThrow();
  });

  it("creates organization with custom domains (normalized)", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, {
      name: "Acme",
      slug: "acme",
      customDomains: ["AUTH.Acme.COM", "auth.acme.com"],
    });
    expect(org.customDomains).toEqual(["auth.acme.com"]);
  });

  it("rejects invalid custom domain on create", async () => {
    const store = memoryStore();
    await expect(
      createOrganization(store, { name: "Acme", slug: "acme", customDomains: ["localhost"] })
    ).rejects.toThrow("Invalid custom domain");
  });
});

describe("getOrganization", () => {
  it("returns organization by id", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    const found = await getOrganization(store, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.slug).toBe("acme");
  });

  it("returns organization by slug", async () => {
    const store = memoryStore();
    await createOrganization(store, { name: "Acme", slug: "acme" });
    const found = await getOrganization(store, "acme");
    expect(found?.slug).toBe("acme");
  });

  it("returns null for unknown id or slug", async () => {
    const store = memoryStore();
    expect(await getOrganization(store, "nonexistent")).toBeNull();
    expect(await getOrganization(store, "unknown-slug")).toBeNull();
  });
});

describe("listOrganizations", () => {
  it("returns only non-deleted by default", async () => {
    const store = memoryStore();
    const a = await createOrganization(store, { name: "A", slug: "a" });
    await createOrganization(store, { name: "B", slug: "b" });
    await deleteOrganization(store, a.id);
    const list = await listOrganizations(store);
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("b");
  });

  it("includes deleted when option set", async () => {
    const store = memoryStore();
    const a = await createOrganization(store, { name: "A", slug: "a" });
    await deleteOrganization(store, a.id);
    const list = await listOrganizations(store, { includeDeleted: true });
    expect(list).toHaveLength(1);
    expect(list[0].deletedAt).not.toBeNull();
  });
});

describe("updateOrganization", () => {
  it("updates name and slug", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    const updated = await updateOrganization(store, created.id, {
      name: "Acme Corp",
      slug: "acme-corp",
    });
    expect(updated.name).toBe("Acme Corp");
    expect(updated.slug).toBe("acme-corp");
    const bySlug = await getOrganization(store, "acme-corp");
    expect(bySlug?.id).toBe(created.id);
  });

  it("throws when organization not found", async () => {
    const store = memoryStore();
    await expect(updateOrganization(store, "bad-id", { name: "X" })).rejects.toThrow("Organization not found");
  });

  it("throws when updating deleted organization", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    await deleteOrganization(store, created.id);
    await expect(updateOrganization(store, created.id, { name: "X" })).rejects.toThrow(
      "Cannot update a deleted"
    );
  });

  it("rejects duplicate slug on update", async () => {
    const store = memoryStore();
    await createOrganization(store, { name: "First", slug: "first" });
    const second = await createOrganization(store, { name: "Second", slug: "second" });
    await expect(updateOrganization(store, second.id, { slug: "first" })).rejects.toThrow("already exists");
  });

  it("updates custom domains (normalized)", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    const updated = await updateOrganization(store, created.id, {
      customDomains: ["auth.customer.com", "AUTH.Other.COM"],
    });
    expect(updated.customDomains).toEqual(["auth.customer.com", "auth.other.com"]);
  });

  it("rejects invalid custom domain on update", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    await expect(
      updateOrganization(store, created.id, { customDomains: ["not-a-valid-domain"] })
    ).rejects.toThrow("Invalid custom domain");
  });
});

describe("deleteOrganization", () => {
  it("soft-deletes organization", async () => {
    const store = memoryStore();
    const created = await createOrganization(store, { name: "Acme", slug: "acme" });
    await deleteOrganization(store, created.id);
    const list = await listOrganizations(store);
    expect(list).toHaveLength(0);
    const withDeleted = await listOrganizations(store, { includeDeleted: true });
    expect(withDeleted).toHaveLength(1);
    expect(withDeleted[0].deletedAt).not.toBeNull();
  });

  it("throws when organization not found", async () => {
    const store = memoryStore();
    await expect(deleteOrganization(store, "bad-id")).rejects.toThrow("Organization not found");
  });
});
