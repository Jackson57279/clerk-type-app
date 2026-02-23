import { describe, it, expect } from "vitest";
import { handleScimRequest, type ScimServerUserStore } from "../src/scim-server.js";
import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "../src/user-provisioning.js";
import type { GroupSyncStore, SyncedGroup } from "../src/group-sync.js";

function memoryScimUserStore(initial: ProvisionedUser[] = []): ScimServerUserStore {
  const users = new Map<string, ProvisionedUser>();
  const byEmail = new Map<string, string>();
  const byExternalId = new Map<string, string>();

  function index(u: ProvisionedUser) {
    users.set(u.id, u);
    if (u.active) byEmail.set(u.email.toLowerCase(), u.id);
    if (u.externalId) byExternalId.set(u.externalId, u.id);
  }

  for (const u of initial) index(u);

  const base: UserProvisioningStore = {
    async findById(id: string) {
      return users.get(id) ?? null;
    },
    async findByEmail(email: string) {
      const id = byEmail.get(email.toLowerCase());
      return id ? users.get(id) ?? null : null;
    },
    async findByExternalId(externalId: string) {
      const id = byExternalId.get(externalId);
      return id ? users.get(id) ?? null : null;
    },
    async create(data: ProvisionUserData): Promise<ProvisionedUser> {
      const id = `user_${users.size + 1}`;
      const user: ProvisionedUser = {
        id,
        email: data.email,
        externalId: data.externalId,
        name: data.name,
        firstName: data.firstName,
        lastName: data.lastName,
        active: data.active ?? true,
      };
      index(user);
      return user;
    },
    async update(id: string, data: Partial<ProvisionUserData>): Promise<ProvisionedUser> {
      const existing = users.get(id);
      if (!existing) throw new Error("User not found");
      const user: ProvisionedUser = {
        ...existing,
        ...data,
        email: data.email ?? existing.email,
        externalId: data.externalId !== undefined ? data.externalId : existing.externalId,
        active: data.active !== undefined ? data.active : existing.active,
      };
      byEmail.delete(existing.email.toLowerCase());
      if (existing.externalId) byExternalId.delete(existing.externalId);
      index(user);
      return user;
    },
    async softDelete(id: string) {
      const u = users.get(id);
      if (!u) return;
      const deactivated: ProvisionedUser = { ...u, active: false };
      users.set(id, deactivated);
      byEmail.delete(u.email.toLowerCase());
      if (u.externalId) byExternalId.delete(u.externalId);
    },
    async hardDelete(id: string) {
      const u = users.get(id);
      if (u) {
        byEmail.delete(u.email.toLowerCase());
        if (u.externalId) byExternalId.delete(u.externalId);
      }
      users.delete(id);
    },
  };

  return {
    ...base,
    async listUsers() {
      return Array.from(users.values()).filter((u) => u.active);
    },
  };
}

function memoryGroupStore(): GroupSyncStore {
  const groups = new Map<string, SyncedGroup & { organizationId: string }>();
  const byOrgExternal = new Map<string, Map<string, string>>();
  const members = new Map<string, string[]>();

  function orgMap(orgId: string): Map<string, string> {
    let m = byOrgExternal.get(orgId);
    if (!m) {
      m = new Map();
      byOrgExternal.set(orgId, m);
    }
    return m;
  }

  return {
    async findGroupByExternalId(organizationId: string, externalId: string) {
      const id = byOrgExternal.get(organizationId)?.get(externalId);
      const g = id ? groups.get(id) : null;
      return g?.active ? { id: g.id, externalId: g.externalId, displayName: g.displayName, active: g.active } : null;
    },
    async findGroupById(id: string) {
      const g = groups.get(id);
      return g ? { id: g.id, externalId: g.externalId, displayName: g.displayName, active: g.active } : null;
    },
    async listGroupsByOrganization(organizationId: string) {
      const list: SyncedGroup[] = [];
      for (const g of groups.values()) {
        if (g.organizationId === organizationId && g.active)
          list.push({ id: g.id, externalId: g.externalId, displayName: g.displayName, active: g.active });
      }
      return list;
    },
    async createGroup(organizationId: string, data: { externalId: string; displayName: string }) {
      const id = `grp_${groups.size + 1}`;
      const group: SyncedGroup & { organizationId: string } = {
        id,
        organizationId,
        externalId: data.externalId,
        displayName: data.displayName,
        active: true,
      };
      groups.set(id, group);
      orgMap(organizationId).set(data.externalId, id);
      members.set(id, []);
      return { id: group.id, externalId: group.externalId, displayName: group.displayName, active: group.active };
    },
    async updateGroup(id: string, data: { displayName?: string }) {
      const g = groups.get(id);
      if (!g) throw new Error("Group not found");
      if (data.displayName !== undefined) g.displayName = data.displayName;
      return { id: g.id, externalId: g.externalId, displayName: g.displayName, active: g.active };
    },
    async softDeleteGroup(id: string) {
      const g = groups.get(id);
      if (!g) return;
      const deactivated = { ...g, active: false };
      groups.set(id, deactivated);
      byOrgExternal.get(g.organizationId)?.delete(g.externalId);
    },
    async hardDeleteGroup(id: string) {
      const g = groups.get(id);
      if (g) byOrgExternal.get(g.organizationId)?.delete(g.externalId);
      groups.delete(id);
      members.delete(id);
    },
    async listGroupMemberIds(groupId: string) {
      return [...(members.get(groupId) ?? [])];
    },
    async setGroupMembers(groupId: string, userIds: string[]) {
      members.set(groupId, [...userIds]);
    },
  };
}

function ctx(
  overrides: {
    method?: string;
    path?: string;
    query?: Record<string, string>;
    body?: unknown;
    userStore?: ScimServerUserStore;
    groupStore?: GroupSyncStore;
    organizationId?: string;
    baseUrl?: string;
    isAllowedEmail?: (email: string) => boolean;
  } = {}
) {
  return {
    method: "GET",
    path: "/scim/v2/ServiceProviderConfig",
    query: {},
    userStore: memoryScimUserStore(),
    groupStore: memoryGroupStore(),
    organizationId: "org_1",
    ...overrides,
  };
}

describe("handleScimRequest", () => {
  describe("ServiceProviderConfig", () => {
    it("GET /scim/v2/ServiceProviderConfig returns config", async () => {
      const res = await handleScimRequest(ctx({ path: "/scim/v2/ServiceProviderConfig" }));
      expect(res.status).toBe(200);
      const body = res.body as { schemas?: string[]; bulk?: { supported: boolean }; patch?: { supported: boolean } };
      expect(body.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig");
      expect(body.patch?.supported).toBe(true);
      expect(body.bulk?.supported).toBe(true);
    });

    it("POST ServiceProviderConfig returns 405", async () => {
      const res = await handleScimRequest(ctx({ method: "POST", path: "/scim/v2/ServiceProviderConfig" }));
      expect(res.status).toBe(405);
    });
  });

  describe("ResourceTypes", () => {
    it("GET /scim/v2/ResourceTypes returns list", async () => {
      const res = await handleScimRequest(ctx({ path: "/scim/v2/ResourceTypes" }));
      expect(res.status).toBe(200);
      const body = res.body as { Resources?: { id: string }[]; totalResults?: number };
      expect(body.Resources?.length).toBeGreaterThanOrEqual(2);
      expect(body.Resources?.some((r) => r.id === "User")).toBe(true);
      expect(body.Resources?.some((r) => r.id === "Group")).toBe(true);
    });

    it("GET /scim/v2/ResourceTypes/User returns User type", async () => {
      const res = await handleScimRequest(ctx({ path: "/scim/v2/ResourceTypes/User" }));
      expect(res.status).toBe(200);
      const body = res.body as { id: string; endpoint: string };
      expect(body.id).toBe("User");
      expect(body.endpoint).toBe("/Users");
    });
  });

  describe("Schemas", () => {
    it("GET /scim/v2/Schemas returns schemas", async () => {
      const res = await handleScimRequest(ctx({ path: "/scim/v2/Schemas" }));
      expect(res.status).toBe(200);
      const body = res.body as { Resources?: { id: string }[] };
      expect(body.Resources?.length).toBeGreaterThanOrEqual(2);
    });

    it("GET /scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User returns User schema", async () => {
      const schemaId = "urn:ietf:params:scim:schemas:core:2.0:User";
      const res = await handleScimRequest(ctx({ path: `/scim/v2/Schemas/${encodeURIComponent(schemaId)}` }));
      expect(res.status).toBe(200);
      const body = res.body as { id: string; name: string };
      expect(body.id).toBe(schemaId);
      expect(body.name).toBe("User");
    });
  });

  describe("Users", () => {
    it("POST /Users creates user and returns 201", async () => {
      const userStore = memoryScimUserStore();
      const groupStore = memoryGroupStore();
      const res = await handleScimRequest(
        ctx({
          method: "POST",
          path: "/scim/v2/Users",
          body: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "jensen@example.com",
            externalId: "ext-1",
            name: { formatted: "Barbara Jensen", givenName: "Barbara", familyName: "Jensen" },
            active: true,
          },
          userStore,
          groupStore,
          isAllowedEmail: () => true,
          baseUrl: "https://api.example.com/scim/v2",
        })
      );
      expect(res.status).toBe(201);
      expect(res.headers?.Location).toMatch(/\/Users\/user_1$/);
      const body = res.body as { id: string; userName: string; externalId: string; active: boolean };
      expect(body.id).toBe("user_1");
      expect(body.userName).toBe("jensen@example.com");
      expect(body.externalId).toBe("ext-1");
      expect(body.active).toBe(true);
    });

    it("GET /Users/:id returns user", async () => {
      const userStore = memoryScimUserStore([
        {
          id: "user_1",
          email: "a@example.com",
          externalId: "ext-1",
          name: "Alice",
          firstName: "Alice",
          lastName: "A",
          active: true,
        },
      ]);
      const res = await handleScimRequest(ctx({ path: "/scim/v2/Users/user_1", userStore }));
      expect(res.status).toBe(200);
      const body = res.body as { id: string; userName: string; name: { formatted: string } };
      expect(body.id).toBe("user_1");
      expect(body.userName).toBe("a@example.com");
      expect(body.name.formatted).toBe("Alice");
    });

    it("GET /Users returns list with totalResults and Resources", async () => {
      const userStore = memoryScimUserStore([
        {
          id: "user_1",
          email: "a@example.com",
          externalId: undefined,
          name: "A",
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const res = await handleScimRequest(ctx({ path: "/scim/v2/Users", query: {}, userStore }));
      expect(res.status).toBe(200);
      const body = res.body as { schemas: string[]; totalResults: number; Resources: unknown[] };
      expect(body.schemas).toContain("urn:ietf:params:scim:api:messages:2.0:ListResponse");
      expect(body.totalResults).toBe(1);
      expect(body.Resources).toHaveLength(1);
    });

    it("GET /Users?filter=userName eq \"a@example.com\" returns filtered list", async () => {
      const userStore = memoryScimUserStore([
        { id: "user_1", email: "a@example.com", externalId: undefined, name: "A", firstName: undefined, lastName: undefined, active: true },
        { id: "user_2", email: "b@example.com", externalId: undefined, name: "B", firstName: undefined, lastName: undefined, active: true },
      ]);
      const res = await handleScimRequest(
        ctx({ path: "/scim/v2/Users", query: { filter: 'userName eq "a@example.com"' }, userStore })
      );
      expect(res.status).toBe(200);
      const body = res.body as { totalResults: number; Resources: { userName: string }[] };
      expect(body.totalResults).toBe(1);
      expect(body.Resources[0]?.userName).toBe("a@example.com");
    });

    it("PUT /Users/:id replaces user", async () => {
      const userStore = memoryScimUserStore([
        { id: "user_1", email: "old@example.com", externalId: undefined, name: "Old", firstName: undefined, lastName: undefined, active: true },
      ]);
      const res = await handleScimRequest(
        ctx({
          method: "PUT",
          path: "/scim/v2/Users/user_1",
          body: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "new@example.com",
            name: { formatted: "New Name", givenName: "New", familyName: "Name" },
            active: false,
          },
          userStore,
        })
      );
      expect(res.status).toBe(200);
      const body = res.body as { userName: string; active: boolean };
      expect(body.userName).toBe("new@example.com");
      expect(body.active).toBe(false);
    });

    it("PATCH /Users/:id updates active", async () => {
      const userStore = memoryScimUserStore([
        { id: "user_1", email: "u@example.com", externalId: undefined, name: "U", firstName: undefined, lastName: undefined, active: true },
      ]);
      const res = await handleScimRequest(
        ctx({
          method: "PATCH",
          path: "/scim/v2/Users/user_1",
          body: { Operations: [{ op: "replace", path: "active", value: false }] },
          userStore,
        })
      );
      expect(res.status).toBe(200);
      const body = res.body as { active: boolean };
      expect(body.active).toBe(false);
    });

    it("DELETE /Users/:id returns 204", async () => {
      const userStore = memoryScimUserStore([
        { id: "user_1", email: "del@example.com", externalId: undefined, name: "D", firstName: undefined, lastName: undefined, active: true },
      ]);
      const res = await handleScimRequest(ctx({ method: "DELETE", path: "/scim/v2/Users/user_1", userStore }));
      expect(res.status).toBe(204);
      const still = await userStore.findById("user_1");
      expect(still?.active).toBe(false);
    });

    it("GET /Users/:id for missing user returns 404", async () => {
      const res = await handleScimRequest(ctx({ path: "/scim/v2/Users/nonexistent" }));
      expect(res.status).toBe(404);
    });
  });

  describe("Groups", () => {
    it("POST /Groups creates group", async () => {
      const userStore = memoryScimUserStore();
      const groupStore = memoryGroupStore();
      const res = await handleScimRequest(
        ctx({
          method: "POST",
          path: "/scim/v2/Groups",
          body: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Engineers",
            externalId: "eng",
          },
          userStore,
          groupStore,
        })
      );
      expect(res.status).toBe(201);
      const body = res.body as { id: string; displayName: string; externalId: string };
      expect(body.displayName).toBe("Engineers");
      expect(body.externalId).toBe("eng");
    });

    it("GET /Groups returns list", async () => {
      const userStore = memoryScimUserStore();
      const groupStore = memoryGroupStore();
      await groupStore.createGroup("org_1", { externalId: "g1", displayName: "Group 1" });
      const res = await handleScimRequest(ctx({ path: "/scim/v2/Groups", userStore, groupStore }));
      expect(res.status).toBe(200);
      const body = res.body as { totalResults: number; Resources: unknown[] };
      expect(body.totalResults).toBe(1);
      expect((body.Resources as { displayName: string }[])[0]?.displayName).toBe("Group 1");
    });

    it("GET /Groups/:id returns group with members", async () => {
      const userStore = memoryScimUserStore([
        { id: "user_1", email: "m@example.com", externalId: undefined, name: "M", firstName: undefined, lastName: undefined, active: true },
      ]);
      const groupStore = memoryGroupStore();
      const g = await groupStore.createGroup("org_1", { externalId: "g1", displayName: "G1" });
      await groupStore.setGroupMembers(g.id, ["user_1"]);
      const res = await handleScimRequest(ctx({ path: `/scim/v2/Groups/${g.id}`, userStore, groupStore }));
      expect(res.status).toBe(200);
      const body = res.body as { displayName: string; members: { value: string }[] };
      expect(body.displayName).toBe("G1");
      expect(body.members).toHaveLength(1);
      expect(body.members[0]?.value).toBe("user_1");
    });

    it("PATCH /Groups/:id updates displayName", async () => {
      const groupStore = memoryGroupStore();
      const g = await groupStore.createGroup("org_1", { externalId: "g1", displayName: "Old" });
      const res = await handleScimRequest(
        ctx({
          method: "PATCH",
          path: `/scim/v2/Groups/${g.id}`,
          body: { Operations: [{ op: "replace", path: "displayName", value: "New Name" }] },
          groupStore,
        })
      );
      expect(res.status).toBe(200);
      const body = res.body as { displayName: string };
      expect(body.displayName).toBe("New Name");
    });

    it("DELETE /Groups/:id returns 204", async () => {
      const groupStore = memoryGroupStore();
      const g = await groupStore.createGroup("org_1", { externalId: "g1", displayName: "G1" });
      const res = await handleScimRequest(ctx({ method: "DELETE", path: `/scim/v2/Groups/${g.id}`, groupStore }));
      expect(res.status).toBe(204);
      const list = await groupStore.listGroupsByOrganization("org_1");
      expect(list.find((x) => x.id === g.id)).toBeUndefined();
    });
  });

  describe("Bulk", () => {
    it("POST /Bulk runs bulk operations", async () => {
      const userStore = memoryScimUserStore();
      const groupStore = memoryGroupStore();
      const res = await handleScimRequest(
        ctx({
          method: "POST",
          path: "/scim/v2/Bulk",
          body: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
            Operations: [
              {
                method: "POST",
                path: "Users",
                bulkId: "u1",
                data: {
                  userName: "bulk@example.com",
                  name: { givenName: "Bulk", familyName: "User" },
                },
              },
            ],
          },
          userStore,
          groupStore,
          isAllowedEmail: () => true,
        })
      );
      expect(res.status).toBe(200);
      const body = res.body as { Operations: { status: number; response?: { id: string } }[] };
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0]?.status).toBe(201);
      expect(body.Operations[0]?.response).toHaveProperty("id");
    });
  });

  describe("path normalization", () => {
    it("accepts path without /scim/v2 prefix", async () => {
      const res = await handleScimRequest(ctx({ path: "ServiceProviderConfig" }));
      expect(res.status).toBe(200);
    });

    it("accepts path with v2 only", async () => {
      const res = await handleScimRequest(ctx({ path: "v2/ResourceTypes" }));
      expect(res.status).toBe(200);
    });
  });
});
