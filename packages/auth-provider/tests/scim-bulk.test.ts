import { describe, it, expect, vi } from "vitest";
import {
  processBulkRequest,
  processGroupSync,
  BULK_REQUEST_SCHEMA,
  BULK_RESPONSE_SCHEMA,
} from "../src/scim-bulk.js";
import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "../src/user-provisioning.js";
import type { GroupSyncStore, SyncedGroup } from "../src/group-sync.js";
import type { WebhookSubscriptionStore } from "../src/realtime-webhook.js";

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
      isAllowedEmail: () => true,
    });
    expect(response.schemas).toContain(BULK_RESPONSE_SCHEMA);
    expect(response.Operations).toEqual([]);
  });

  it("accepts paths with /v2/ prefix (path normalization)", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          { method: "POST", path: "/v2/Users", bulkId: "u1", data: { userName: "v2path@example.com" } },
          { method: "POST", path: "/v2/Groups", bulkId: "g1", data: { externalId: "grp-v2", displayName: "V2 Group" } },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
    });
    expect(response.Operations[0]!.status).toBe(201);
    expect(response.Operations[1]!.status).toBe(201);
    expect(await userStore.findByEmail("v2path@example.com")).not.toBeNull();
    expect(await groupStore.findGroupByExternalId(orgId, "grp-v2")).not.toBeNull();
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
      isAllowedEmail: () => true,
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

  it("uses scimUserAttributeMapping when provided for user create and update", async () => {
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
              userName: "mapped-login@corp.com",
              emails: [{ value: "other@corp.com" }],
              name: { formatted: "Mapped User", givenName: "Mapped", familyName: "User" },
              active: true,
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
      scimUserAttributeMapping: { emailPath: "userName" },
    });
    expect(response.Operations[0]!.status).toBe(201);
    const user = await userStore.findByEmail("mapped-login@corp.com");
    expect(user).not.toBeNull();
    expect(user?.name).toBe("Mapped User");
    expect(user?.firstName).toBe("Mapped");
    expect(user?.lastName).toBe("User");
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
    });
    const patchOp = response.Operations[0]!;
    expect(patchOp.status).toBe(200);
    const user = await userStore.findById("user_1");
    expect(user?.firstName).toBe("New");
  });

  it("bulk updates user via PUT /Users/{id} (full replace)", async () => {
    const userStore = memoryUserStore([
      { id: "user_1", email: "old@example.com", externalId: "ext-1", name: undefined, firstName: "Old", lastName: "Name", active: true },
    ]);
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "PUT",
            path: "Users/user_1",
            data: {
              userName: "replaced@example.com",
              externalId: "ext-replaced",
              name: { givenName: "Replaced", familyName: "User" },
              active: false,
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
    });
    const putOp = response.Operations[0]!;
    expect(putOp.status).toBe(200);
    const user = await userStore.findById("user_1");
    expect(user?.email).toBe("replaced@example.com");
    expect(user?.externalId).toBe("ext-replaced");
    expect(user?.firstName).toBe("Replaced");
    expect(user?.active).toBe(false);
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
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
      isAllowedEmail: () => true,
      maxOperations: 1,
    });
    expect(response.Operations).toHaveLength(1);
    expect(response.Operations[0]!.status).toBe(201);
    expect(await userStore.findByEmail("one@example.com")).not.toBeNull();
  });

  it("bulk updates group via PUT /Groups/{id}", async () => {
    const userStore = memoryUserStore([
      { id: "user_1", email: "m@example.com", externalId: "ext-m", name: undefined, firstName: undefined, lastName: undefined, active: true },
    ]);
    const groupStore = memoryGroupStore();
    await groupStore.createGroup(orgId, { externalId: "grp-put", displayName: "Old" });
    await groupStore.setGroupMembers((await groupStore.findGroupByExternalId(orgId, "grp-put"))!.id, ["user_1"]);
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "PUT",
            path: "Groups/grp-put",
            data: {
              externalId: "grp-put",
              displayName: "Updated Name",
              members: [{ value: "ext-m", display: "m@example.com" }],
            },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
    });
    const putOp = response.Operations[0]!;
    expect(putOp.status).toBe(200);
    const group = await groupStore.findGroupByExternalId(orgId, "grp-put");
    expect(group?.displayName).toBe("Updated Name");
    expect(await groupStore.listGroupMemberIds(group!.id)).toEqual(["user_1"]);
  });

  it("resolves bulkId reference in path for PATCH /Groups/bulkId:g1", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "POST",
            path: "Groups",
            bulkId: "g1",
            data: { externalId: "grp-patch", displayName: "Old Name" },
          },
          {
            method: "PATCH",
            path: "Groups/bulkId:g1",
            data: { displayName: "New Name" },
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
    });
    expect(response.Operations[0]!.status).toBe(201);
    expect(response.Operations[1]!.status).toBe(200);
    const group = await groupStore.findGroupByExternalId(orgId, "grp-patch");
    expect(group?.displayName).toBe("New Name");
  });

  it("resolves bulkId reference in path for DELETE /Groups/bulkId:g1", async () => {
    const userStore = memoryUserStore();
    const groupStore = memoryGroupStore();
    const response = await processBulkRequest({
      request: {
        schemas: [BULK_REQUEST_SCHEMA],
        Operations: [
          {
            method: "POST",
            path: "Groups",
            bulkId: "g1",
            data: { externalId: "grp-del", displayName: "To Delete" },
          },
          {
            method: "DELETE",
            path: "Groups/bulkId:g1",
          },
        ],
      },
      userStore,
      groupStore,
      organizationId: orgId,
      isAllowedEmail: () => true,
    });
    expect(response.Operations[0]!.status).toBe(201);
    expect(response.Operations[1]!.status).toBe(204);
    const group = await groupStore.findGroupByExternalId(orgId, "grp-del");
    expect(group).toBeNull();
  });

  describe("GroupSync (full group synchronization)", () => {
    it("syncs multiple groups and returns created/updated/removed counts", async () => {
      const userStore = memoryUserStore([
        { id: "user_1", email: "a@example.com", externalId: "ext-a", name: undefined, firstName: undefined, lastName: undefined, active: true },
      ]);
      const groupStore = memoryGroupStore();
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [
                  { externalId: "grp-1", displayName: "Engineering", members: [{ value: "ext-a" }] },
                  { externalId: "grp-2", displayName: "Product", members: [] },
                ],
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      const op = response.Operations[0]!;
      expect(op.status).toBe(200);
      expect(op.response).toMatchObject({ created: 2, updated: 0, removed: 0 });
      const list = await groupStore.listGroupsByOrganization(orgId);
      expect(list).toHaveLength(2);
      const grp1 = await groupStore.findGroupByExternalId(orgId, "grp-1");
      expect(grp1?.displayName).toBe("Engineering");
      expect(await groupStore.listGroupMemberIds(grp1!.id)).toEqual(["user_1"]);
    });

    it("updates existing groups when externalId matches", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      await groupStore.createGroup(orgId, { externalId: "grp-existing", displayName: "Old Name" });
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [{ externalId: "grp-existing", displayName: "New Name", members: [] }],
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      const op = response.Operations[0]!;
      expect(op.status).toBe(200);
      expect(op.response).toMatchObject({ created: 0, updated: 1, removed: 0 });
      const g = await groupStore.findGroupByExternalId(orgId, "grp-existing");
      expect(g?.displayName).toBe("New Name");
    });

    it("soft-deletes groups not in source when removeGroupsNotInSource is true", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const created = await groupStore.createGroup(orgId, { externalId: "grp-old", displayName: "Old" });
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [{ externalId: "grp-new", displayName: "New", members: [] }],
                removeGroupsNotInSource: true,
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      const op = response.Operations[0]!;
      expect(op.status).toBe(200);
      expect(op.response).toMatchObject({ created: 1, updated: 0, removed: 1 });
      const list = await groupStore.listGroupsByOrganization(orgId);
      expect(list).toHaveLength(1);
      expect(list[0]!.externalId).toBe("grp-new");
      const deactivated = await groupStore.findGroupById(created.id);
      expect(deactivated).not.toBeNull();
      expect(deactivated!.active).toBe(false);
    });

    it("hard-deletes groups not in source when hardDeleteRemoved is true", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const created = await groupStore.createGroup(orgId, { externalId: "grp-old", displayName: "Old" });
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [{ externalId: "grp-new", displayName: "New", members: [] }],
                removeGroupsNotInSource: true,
                hardDeleteRemoved: true,
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      const op = response.Operations[0]!;
      expect(op.status).toBe(200);
      expect(op.response).toMatchObject({ removed: 1 });
      const deleted = await groupStore.findGroupById(created.id);
      expect(deleted).toBeNull();
    });

    it("returns 400 when data.groups is missing", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [{ method: "POST", path: "GroupSync", data: {} }],
        },
        userStore,
        groupStore,
        organizationId: orgId,
      });
      const op = response.Operations[0]!;
      expect(op.status).toBe(400);
      expect(op.response).toMatchObject({ detail: "GroupSync requires data.groups array" });
    });
  });

  describe("processGroupSync (standalone group synchronization)", () => {
    it("syncs groups and returns created/updated/removed counts", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "a@example.com",
          externalId: "ext-a",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const result = await processGroupSync({
        organizationId: orgId,
        userStore,
        groupStore,
        data: {
          groups: [
            { externalId: "grp-1", displayName: "Engineering", members: [{ value: "ext-a" }] },
            { externalId: "grp-2", displayName: "Product", members: [] },
          ],
        },
      });
      expect(result).toEqual({ created: 2, updated: 0, removed: 0 });
      const list = await groupStore.listGroupsByOrganization(orgId);
      expect(list).toHaveLength(2);
      const grp1 = await groupStore.findGroupByExternalId(orgId, "grp-1");
      expect(grp1?.displayName).toBe("Engineering");
      expect(await groupStore.listGroupMemberIds(grp1!.id)).toEqual(["user_1"]);
    });

    it("resolves members by internal user id", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "a@example.com",
          externalId: "ext-a",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      await processGroupSync({
        organizationId: orgId,
        userStore,
        groupStore,
        data: {
          groups: [{ externalId: "grp-1", displayName: "Team", members: [{ value: "user_1" }] }],
        },
      });
      const grp1 = await groupStore.findGroupByExternalId(orgId, "grp-1");
      expect(await groupStore.listGroupMemberIds(grp1!.id)).toEqual(["user_1"]);
    });

    it("throws when data.groups is missing", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      await expect(
        processGroupSync({
          organizationId: orgId,
          userStore,
          groupStore,
          data: { groups: undefined as unknown as [] },
        })
      ).rejects.toThrow("GroupSync requires data.groups array");
    });

    it("throws when data has no groups array", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      await expect(
        processGroupSync({
          organizationId: orgId,
          userStore,
          groupStore,
          data: { groups: null } as unknown as { groups: Array<{ externalId: string; displayName: string }> },
        })
      ).rejects.toThrow("GroupSync requires data.groups array");
    });

    it("removeGroupsNotInSource soft-deletes groups not in payload", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      await groupStore.createGroup(orgId, { externalId: "grp-old", displayName: "Old" });
      const result = await processGroupSync({
        organizationId: orgId,
        userStore,
        groupStore,
        data: {
          groups: [{ externalId: "grp-new", displayName: "New", members: [] }],
          removeGroupsNotInSource: true,
        },
      });
      expect(result).toEqual({ created: 1, updated: 0, removed: 1 });
      const list = await groupStore.listGroupsByOrganization(orgId);
      expect(list).toHaveLength(1);
      expect(list[0]!.externalId).toBe("grp-new");
    });

    it("delivers webhooks when webhookStore provided", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processGroupSync({
        organizationId: orgId,
        userStore,
        groupStore,
        data: {
          groups: [
            { externalId: "grp-1", displayName: "Eng", members: [] },
            { externalId: "grp-2", displayName: "Product", members: [] },
          ],
        },
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(2);
      expect(delivered.map((d) => d.type)).toEqual(["group.created", "group.created"]);
      expect(delivered[0]!.data.externalId).toBe("grp-1");
      expect(delivered[1]!.data.externalId).toBe("grp-2");
    });
  });

  describe("realtime webhook delivery", () => {
    it("delivers user.created webhook when webhookStore provided and user created via bulk", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async (organizationId) => {
          expect(organizationId).toBe(orgId);
          return [{ url: "https://hooks.example.com/wh", secret: "sec" }];
        }),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: "POST", path: "Users", bulkId: "u1", data: { userName: "wh@example.com", externalId: "ext-wh" } },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.type).toBe("user.created");
      expect(delivered[0]!.data.email).toBe("wh@example.com");
      expect(delivered[0]!.data.externalId).toBe("ext-wh");
    });

    it("delivers group.created webhook when webhookStore provided and group created via bulk", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "Groups",
              bulkId: "g1",
              data: { externalId: "grp-wh", displayName: "Webhook Group" },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.type).toBe("group.created");
      expect(delivered[0]!.data.externalId).toBe("grp-wh");
      expect(delivered[0]!.data.displayName).toBe("Webhook Group");
    });

    it("succeeds without webhook delivery when webhookStore not provided", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const response = await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [{ method: "POST", path: "Users", data: { userName: "nowh@example.com" } }],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(response.Operations[0]!.status).toBe(201);
      expect(await userStore.findByEmail("nowh@example.com")).not.toBeNull();
    });

    it("GroupSync delivers group.created webhooks for each created group", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [
                  { externalId: "sync-grp-1", displayName: "Sync One", members: [] },
                  { externalId: "sync-grp-2", displayName: "Sync Two", members: [] },
                ],
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(2);
      expect(delivered.map((d) => d.type)).toEqual(["group.created", "group.created"]);
      expect(delivered.map((d) => d.data.displayName).sort()).toEqual(["Sync One", "Sync Two"]);
      expect(delivered.map((d) => d.data.externalId).sort()).toEqual(["sync-grp-1", "sync-grp-2"]);
    });

    it("GroupSync delivers group.updated webhook for updated groups", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      await groupStore.createGroup(orgId, { externalId: "grp-upd", displayName: "Before" });
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [{ externalId: "grp-upd", displayName: "After", members: [] }],
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.type).toBe("group.updated");
      expect(delivered[0]!.data.displayName).toBe("After");
      expect(delivered[0]!.data.externalId).toBe("grp-upd");
    });

    it("GroupSync delivers group.deleted webhook for removed groups when removeGroupsNotInSource", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const created = await groupStore.createGroup(orgId, { externalId: "grp-removed", displayName: "Gone" });
      const delivered: { type: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      await processBulkRequest({
        request: {
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: "POST",
              path: "GroupSync",
              data: {
                groups: [{ externalId: "grp-kept", displayName: "Kept", members: [] }],
                removeGroupsNotInSource: true,
              },
            },
          ],
        },
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(delivered).toHaveLength(2);
      expect(delivered.find((d) => d.type === "group.created")?.data.externalId).toBe("grp-kept");
      expect(delivered.find((d) => d.type === "group.deleted")?.data.externalId).toBe("grp-removed");
      expect(delivered.find((d) => d.type === "group.deleted")?.data.id).toBe(created.id);
    });
  });
});
