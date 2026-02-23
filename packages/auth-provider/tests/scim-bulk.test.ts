import { describe, it, expect } from "vitest";
import { processBulkRequest, BULK_REQUEST_SCHEMA, BULK_RESPONSE_SCHEMA } from "../src/scim-bulk.js";
import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "../src/user-provisioning.js";
import type { GroupSyncStore, SyncedGroup } from "../src/group-sync.js";

function memoryUserStore(initial: ProvisionedUser[] = []): UserProvisioningStore {
  const users = new Map<string, ProvisionedUser>();
  const byEmail = new Map<string, string>();
  const byExternalId = new Map<string, string>();

  function index(u: ProvisionedUser) {
    users.set(u.id, u);
    if (u.active) byEmail.set(u.email.toLowerCase(), u.id);
    if (u.externalId) byExternalId.set(u.externalId, u.id);
  }

  for (const u of initial) index(u);

  return {
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

describe("processBulkRequest", () => {
  const orgId = "org_1";

  it("returns BulkResponse schema", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: { schemas: [BULK_REQUEST_SCHEMA], Operations: [] },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    expect(response.schemas).toContain(BULK_RESPONSE_SCHEMA);
    expect(response.Operations).toEqual([]);
  });

  it("bulk creates users via POST /Users", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "POST",
            path: "Users",
            bulkId: "u1",
            data: {
              userName: "a@example.com",
              externalId: "ext-a",
              name: { givenName: "A", familyName: "User" },
              active: true,
            },
          },
          {
            method: "POST",
            path: "/Users",
            bulkId: "u2",
            data: {
              emails: [{ value: "b@example.com", primary: true }],
              externalId: "ext-b",
              name: { givenName: "B", familyName: "User" },
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    expect(response.Operations).toHaveLength(2);
    const op0 = response.Operations[0]!;
    const op1 = response.Operations[1]!;
    expect(op0.status).toBe(201);
    expect(op0.response).toMatchObject({ active: true });
    expect(op1.status).toBe(201);
    const userA = await userStore.findByEmail("a@example.com");
    const userB = await userStore.findByEmail("b@example.com");
    expect(userA?.externalId).toBe("ext-a");
    expect(userB?.externalId).toBe("ext-b");
  });

  it("bulk creates group via POST /Groups", async () => {
    const userStore = memoryUserStore([
      { id: "user_1", email: "m@example.com", externalId: "ext-m", name: undefined, firstName: undefined, lastName: undefined, active: true },
    ]);
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "POST",
            path: "Groups",
            bulkId: "g1",
            data: {
              externalId: "grp-sales",
              displayName: "Sales",
              members: [{ value: "ext-m", display: "m@example.com" }],
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const createOp = response.Operations[0]!;
    expect(createOp.status).toBe(201);
    expect(createOp.response).toMatchObject({ displayName: "Sales", externalId: "grp-sales" });
    const group = await groupStore.findGroupByExternalId(orgId, "grp-sales");
    expect(group).not.toBeNull();
    expect(await groupStore.listGroupMemberIds(group!.id)).toEqual(["user_1"]);
  });

  it("bulk updates user via PATCH /Users/{id}", async () => {
    const userStore = memoryUserStore([
      { id: "user_1", email: "old@example.com", externalId: "ext-1", name: undefined, firstName: "Old", lastName: "Name", active: true },
    ]);
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "PATCH",
            path: "/Users/user_1",
            data: { name: { givenName: "New", familyName: "Name" }, active: true },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const patchOp = response.Operations[0]!;
    expect(patchOp.status).toBe(200);
    const user = await userStore.findById("user_1");
    expect(user?.firstName).toBe("New");
  });

  it("bulk deletes user via DELETE /Users/{id}", async () => {
    const userStore = memoryUserStore([
      { id: "user_1", email: "del@example.com", externalId: "ext-del", name: undefined, firstName: undefined, lastName: undefined, active: true },
    ]);
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [{ method: "DELETE", path: "Users/user_1" }],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const delUserOp = response.Operations[0]!;
    expect(delUserOp.status).toBe(204);
    const user = await userStore.findById("user_1");
    expect(user?.active).toBe(false);
  });

  it("bulk deletes group via DELETE /Groups/{id}", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    await groupStore.createGroup(orgId, { externalId: "grp-x", displayName: "X" });
    const group = await groupStore.findGroupByExternalId(orgId, "grp-x");
    expect(group).not.toBeNull();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [{ method: "DELETE", path: `Groups/${group!.id}` }],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const delGrpOp = response.Operations[0]!;
    expect(delGrpOp.status).toBe(204);
    expect(await groupStore.findGroupByExternalId(orgId, "grp-x")).toBeNull();
  });

  it("returns 400 for POST /Users without data", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [{ method: "POST", path: "Users", bulkId: "u1" }],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const badCreateOp = response.Operations[0]!;
    expect(badCreateOp.status).toBe(400);
    expect(badCreateOp.response).toMatchObject({ detail: "Missing data for User create" });
  });

  it("returns 404 for PATCH /Users/{id} when user not found", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "PATCH",
            path: "Users/nonexistent",
            data: { userName: "x@x.com", active: true },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const notFoundOp = response.Operations[0]!;
    expect(notFoundOp.status).toBe(404);
  });

  it("stops after failOnErrors and returns 0 status for remaining ops", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        failOnErrors: 1,
        Operations: [
          { method: "POST", path: "Users", bulkId: "u1" },
          { method: "POST", path: "Users", bulkId: "u2", data: { userName: "b@example.com" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const failOp0 = response.Operations[0]!;
    const failOp1 = response.Operations[1]!;
    expect(failOp0.status).toBe(400);
    expect(failOp1.status).toBe(0);
    expect(failOp1.response).toMatchObject({ detail: "Bulk request stopped: failOnErrors limit reached." });
  });

  it("includes location in response when baseUrl provided", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "Users", data: { userName: "loc@example.com" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      baseUrl: "https://api.example.com/scim/v2",
    });
    const locOp = response.Operations[0]!;
    expect(locOp.location).toMatch(/^https:\/\/api\.example\.com\/scim\/v2\/Users\/user_1$/);
  });

  it("resolves bulkId reference in path for PATCH /Users/bulkId:u1", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "Users", bulkId: "u1", data: { userName: "bulkref@example.com", name: { givenName: "Bulk" } } },
          { method: "PATCH", path: "Users/bulkId:u1", data: { name: { givenName: "Updated" } } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    expect(response.Operations[0]!.status).toBe(201);
    expect(response.Operations[1]!.status).toBe(200);
    const user = await userStore.findByEmail("bulkref@example.com");
    expect(user?.firstName).toBe("Updated");
  });

  it("resolves bulkId in group members when creating group after users", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "Users", bulkId: "u1", data: { userName: "member1@example.com" } },
          { method: "POST", path: "Users", bulkId: "u2", data: { userName: "member2@example.com" } },
          {
            method: "POST",
            path: "Groups",
            bulkId: "g1",
            data: {
              externalId: "team-alpha",
              displayName: "Team Alpha",
              members: [{ value: "bulkId:u1" }, { value: "bulkId:u2" }],
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    expect(response.Operations[0]!.status).toBe(201);
    expect(response.Operations[1]!.status).toBe(201);
    expect(response.Operations[2]!.status).toBe(201);
    const group = await groupStore.findGroupByExternalId(orgId, "team-alpha");
    expect(group).not.toBeNull();
    const memberIds = await groupStore.listGroupMemberIds(group!.id);
    expect(memberIds).toHaveLength(2);
    const u1 = await userStore.findByEmail("member1@example.com");
    const u2 = await userStore.findByEmail("member2@example.com");
    expect(memberIds).toContain(u1!.id);
    expect(memberIds).toContain(u2!.id);
  });

  it("returns 400 for unresolved bulkId reference in path", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "PATCH", path: "Users/bulkId:nonexistent", data: { userName: "x@x.com" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
    });
    const op = response.Operations[0]!;
    expect(op.status).toBe(400);
    expect(op.response).toMatchObject({ detail: "bulkId reference not found; create the resource in an earlier operation." });
  });

  it("returns 400 when Operations exceed maxOperations", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "Users", bulkId: "u1", data: { userName: "a@example.com" } },
          { method: "POST", path: "Users", bulkId: "u2", data: { userName: "b@example.com" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      maxOperations: 1,
    });
    expect(response.Operations).toHaveLength(1);
    expect(response.Operations[0]!.status).toBe(400);
    expect(response.Operations[0]!.response).toMatchObject({
      detail: "Bulk request exceeds the maximum number of operations.",
    });
    const userA = await userStore.findByEmail("a@example.com");
    expect(userA).toBeNull();
  });

  it("processes request when Operations count equals maxOperations", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "Users", bulkId: "u1", data: { userName: "one@example.com" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      maxOperations: 1,
    });
    expect(response.Operations).toHaveLength(1);
    expect(response.Operations[0]!.status).toBe(201);
    expect(await userStore.findByEmail("one@example.com")).not.toBeNull();
  });
});
