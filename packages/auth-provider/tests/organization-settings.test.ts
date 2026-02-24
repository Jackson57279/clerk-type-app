import { describe, it, expect } from "vitest";
import {
  createOrganization,
  getOrganization,
  deleteOrganization,
  type Organization,
  type OrganizationStore,
  type CreateOrganizationInput,
} from "../src/organization-crud.js";
import {
  getOrganizationSettings,
  updateOrganizationSettings,
  type OrganizationSettings,
} from "../src/organization-settings.js";

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
      maxConcurrentSessionsPerUser: partial.maxConcurrentSessionsPerUser ?? null,
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
        maxConcurrentSessionsPerUser: data.maxConcurrentSessionsPerUser ?? null,
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
      return byId.get(id) ?? null;
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
        maxConcurrentSessionsPerUser:
          data.maxConcurrentSessionsPerUser !== undefined
            ? data.maxConcurrentSessionsPerUser
            : existing.maxConcurrentSessionsPerUser,
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

function expectSettings(settings: OrganizationSettings, overrides: Partial<OrganizationSettings> = {}): void {
  const expected: OrganizationSettings = {
    logoUrl: null,
    primaryColor: null,
    faviconUrl: null,
    maxMembers: null,
    maxConcurrentSessionsPerUser: null,
    allowedDomains: [],
    customDomains: [],
    requireEmailVerification: true,
    samlEnabled: false,
    samlConfig: null,
    scimEnabled: false,
    scimTokenHash: null,
    ...overrides,
  };
  expect(settings).toEqual(expected);
}

describe("getOrganizationSettings", () => {
  it("returns settings for existing organization", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings).not.toBeNull();
    expectSettings(settings!);
  });

  it("returns settings with overrides when org was created with them", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, {
      name: "Acme",
      slug: "acme",
      logoUrl: "https://acme.com/logo.png",
      primaryColor: "#ff0000",
      maxMembers: 50,
      allowedDomains: ["acme.com"],
      requireEmailVerification: false,
    });
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings).not.toBeNull();
    expect(settings!.logoUrl).toBe("https://acme.com/logo.png");
    expect(settings!.primaryColor).toBe("#ff0000");
    expect(settings!.maxMembers).toBe(50);
    expect(settings!.allowedDomains).toEqual(["acme.com"]);
    expect(settings!.requireEmailVerification).toBe(false);
  });

  it("returns and updates customDomains via settings", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, {
      name: "Acme",
      slug: "acme",
      customDomains: ["auth.acme.com"],
    });
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings!.customDomains).toEqual(["auth.acme.com"]);
    const updated = await updateOrganizationSettings(store, org.id, {
      customDomains: ["auth.acme.com", "login.acme.com"],
    });
    expect(updated.customDomains).toEqual(["auth.acme.com", "login.acme.com"]);
  });

  it("returns and updates maxConcurrentSessionsPerUser via settings", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, {
      name: "Acme",
      slug: "acme",
      maxConcurrentSessionsPerUser: 5,
    });
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings!.maxConcurrentSessionsPerUser).toBe(5);
    const updated = await updateOrganizationSettings(store, org.id, {
      maxConcurrentSessionsPerUser: 10,
    });
    expect(updated.maxConcurrentSessionsPerUser).toBe(10);
  });

  it("returns null for unknown organization id", async () => {
    const store = memoryStore();
    const settings = await getOrganizationSettings(store, "org_nonexistent");
    expect(settings).toBeNull();
  });

  it("returns null for deleted organization", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    await deleteOrganization(store, org.id);
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings).toBeNull();
  });

  it("returns only settings fields (no id, name, slug, timestamps)", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    const settings = await getOrganizationSettings(store, org.id);
    expect(settings).not.toBeNull();
    const s = settings!;
    expect("id" in s).toBe(false);
    expect("name" in s).toBe(false);
    expect("slug" in s).toBe(false);
    expect("createdAt" in s).toBe(false);
    expect("updatedAt" in s).toBe(false);
    expect("deletedAt" in s).toBe(false);
  });
});

describe("updateOrganizationSettings", () => {
  it("updates only settings fields and returns new settings", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    const updated = await updateOrganizationSettings(store, org.id, {
      logoUrl: "https://acme.com/logo.png",
      maxMembers: 100,
    });
    expect(updated.logoUrl).toBe("https://acme.com/logo.png");
    expect(updated.maxMembers).toBe(100);
    const orgAfter = await getOrganization(store, org.id);
    expect(orgAfter?.name).toBe("Acme");
    expect(orgAfter?.slug).toBe("acme");
    expect(orgAfter?.logoUrl).toBe("https://acme.com/logo.png");
    expect(orgAfter?.maxMembers).toBe(100);
  });

  it("does not allow changing name or slug via settings", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    await updateOrganizationSettings(store, org.id, {
      logoUrl: "https://acme.com/logo.png",
    });
    const orgAfter = getOrganization(store, org.id);
    const o = await orgAfter;
    expect(o?.name).toBe("Acme");
    expect(o?.slug).toBe("acme");
  });

  it("throws when organization not found", async () => {
    const store = memoryStore();
    await expect(
      updateOrganizationSettings(store, "org_nonexistent", { maxMembers: 10 })
    ).rejects.toThrow("Organization not found");
  });

  it("throws when organization is deleted", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, { name: "Acme", slug: "acme" });
    await deleteOrganization(store, org.id);
    await expect(
      updateOrganizationSettings(store, org.id, { maxMembers: 10 })
    ).rejects.toThrow("Cannot update a deleted");
  });

  it("partially updates only provided fields", async () => {
    const store = memoryStore();
    const org = await createOrganization(store, {
      name: "Acme",
      slug: "acme",
      primaryColor: "#0000ff",
      maxMembers: 25,
    });
    const updated = await updateOrganizationSettings(store, org.id, { maxMembers: 50 });
    expect(updated.primaryColor).toBe("#0000ff");
    expect(updated.maxMembers).toBe(50);
  });
});
