import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  processScimWebhook,
  type ScimWebhookUserPayload,
  type ScimWebhookGroupPayload,
} from "../src/scim-webhook.js";
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
      return g?.active
        ? { id: g.id, externalId: g.externalId, displayName: g.displayName, active: g.active }
        : null;
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

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret";
  const body = '{"type":"user.created","id":"evt_1","data":{"email":"a@b.com"}}';

  it("returns true for valid sha256 signature", () => {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body, `sha256=${sig}`)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const sig = createHmac("sha256", "wrong").update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body, `sha256=${sig}`)).toBe(false);
  });

  it("returns false for tampered body", () => {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body + "x", `sha256=${sig}`)).toBe(false);
  });

  it("returns false when header does not start with sha256=", () => {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body, sig)).toBe(false);
  });
});

describe("processScimWebhook", () => {
  const orgId = "org_1";

  describe("user events", () => {
    it("user.created provisions a new user", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookUserPayload = {
        type: "user.created",
        id: "evt_1",
        timestamp: new Date().toISOString(),
        data: { email: "new@example.com", externalId: "ext-1", firstName: "New", lastName: "User" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);
      const user = await userStore.findByEmail("new@example.com");
      expect(user).not.toBeNull();
      expect(user?.externalId).toBe("ext-1");
      expect(user?.firstName).toBe("New");
    });

    it("user.updated updates existing user by externalId", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "old@example.com",
          externalId: "ext-1",
          name: undefined,
          firstName: "Old",
          lastName: "Name",
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookUserPayload = {
        type: "user.updated",
        id: "evt_2",
        timestamp: new Date().toISOString(),
        data: { email: "old@example.com", externalId: "ext-1", firstName: "Updated" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      expect(result.created).toBe(false);
      const user = await userStore.findByExternalId("ext-1");
      expect(user?.firstName).toBe("Updated");
    });

    it("user.deleted soft-deletes user by externalId", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "del@example.com",
          externalId: "ext-del",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookUserPayload = {
        type: "user.deleted",
        id: "evt_3",
        timestamp: new Date().toISOString(),
        data: { email: "del@example.com", externalId: "ext-del" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      const user = await userStore.findById("user_1");
      expect(user?.active).toBe(false);
    });

    it("user.deleted returns ok when user not found", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookUserPayload = {
        type: "user.deleted",
        id: "evt_4",
        timestamp: new Date().toISOString(),
        data: { externalId: "nonexistent" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
    });

    it("user.deleted returns error when externalId and id missing", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookUserPayload = {
        type: "user.deleted",
        id: "evt_5",
        timestamp: new Date().toISOString(),
        data: { email: "a@b.com" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("externalId");
    });
  });

  describe("group events", () => {
    it("group.created creates group and resolves member externalIds", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "u1@example.com",
          externalId: "ext-u1",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
        {
          id: "user_2",
          email: "u2@example.com",
          externalId: "ext-u2",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookGroupPayload = {
        type: "group.created",
        id: "evt_g1",
        timestamp: new Date().toISOString(),
        data: {
          externalId: "grp-ext-1",
          displayName: "Engineering",
          members: [
            { value: "ext-u1" },
            { value: "ext-u2" },
          ],
        },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      expect(result.created).toBe(true);
      const group = await groupStore.findGroupByExternalId(orgId, "grp-ext-1");
      expect(group?.displayName).toBe("Engineering");
      const memberIds = await groupStore.listGroupMemberIds(group!.id);
      expect(memberIds.sort()).toEqual(["user_1", "user_2"]);
    });

    it("group.updated updates existing group and membership", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "u1@example.com",
          externalId: "ext-u1",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      await groupStore.createGroup(orgId, { externalId: "grp-ext-1", displayName: "Old Name" });
      const payload: ScimWebhookGroupPayload = {
        type: "group.updated",
        id: "evt_g2",
        timestamp: new Date().toISOString(),
        data: {
          externalId: "grp-ext-1",
          displayName: "New Name",
          members: [{ value: "ext-u1" }],
        },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      expect(result.created).toBe(false);
      const group = await groupStore.findGroupByExternalId(orgId, "grp-ext-1");
      expect(group?.displayName).toBe("New Name");
      const memberIds = await groupStore.listGroupMemberIds(group!.id);
      expect(memberIds).toEqual(["user_1"]);
    });

    it("group.deleted soft-deletes group", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const created = await groupStore.createGroup(orgId, {
        externalId: "grp-del",
        displayName: "To Delete",
      });
      const payload: ScimWebhookGroupPayload = {
        type: "group.deleted",
        id: "evt_g3",
        timestamp: new Date().toISOString(),
        data: { externalId: "grp-del", displayName: "To Delete" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      const list = await groupStore.listGroupsByOrganization(orgId);
      expect(list).toHaveLength(0);
      const group = await groupStore.findGroupById(created.id);
      expect(group).not.toBeNull();
      expect(group!.active).toBe(false);
    });

    it("group members with unknown externalId are skipped", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "u1@example.com",
          externalId: "ext-u1",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookGroupPayload = {
        type: "group.created",
        id: "evt_g4",
        timestamp: new Date().toISOString(),
        data: {
          externalId: "grp-1",
          displayName: "Team",
          members: [
            { value: "ext-u1" },
            { value: "ext-unknown" },
          ],
        },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      const group = await groupStore.findGroupByExternalId(orgId, "grp-1");
      const memberIds = await groupStore.listGroupMemberIds(group!.id);
      expect(memberIds).toEqual(["user_1"]);
    });

    it("group.created resolves members by user id when value is id", async () => {
      const userStore = memoryUserStore([
        {
          id: "user_1",
          email: "u1@example.com",
          externalId: "ext-u1",
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
        {
          id: "user_2",
          email: "u2@example.com",
          externalId: undefined,
          name: undefined,
          firstName: undefined,
          lastName: undefined,
          active: true,
        },
      ]);
      const groupStore = memoryGroupStore();
      const payload: ScimWebhookGroupPayload = {
        type: "group.created",
        id: "evt_g5",
        timestamp: new Date().toISOString(),
        data: {
          externalId: "grp-by-id",
          displayName: "By Id",
          members: [
            { value: "ext-u1" },
            { value: "user_2" },
          ],
        },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
      });
      expect(result.ok).toBe(true);
      const group = await groupStore.findGroupByExternalId(orgId, "grp-by-id");
      expect(group?.displayName).toBe("By Id");
      const memberIds = await groupStore.listGroupMemberIds(group!.id);
      expect(memberIds.sort()).toEqual(["user_1", "user_2"]);
    });
  });

  describe("realtime webhook delivery", () => {
    it("delivers realtime webhook when webhookStore provided and user.created processed", async () => {
      const userStore = memoryUserStore();
      const groupStore = memoryGroupStore();
      const delivered: { type: string; id: string; data: Record<string, unknown> }[] = [];
      const webhookStore: WebhookSubscriptionStore = {
        listSubscriptions: vi.fn(async () => [{ url: "https://hooks.example.com/wh", secret: "sec" }]),
      };
      const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = init?.body as string;
        if (body) {
          const parsed = JSON.parse(body) as { type: string; id: string; data: Record<string, unknown> };
          delivered.push({ type: parsed.type, id: parsed.id, data: parsed.data });
        }
        return new Response(null, { status: 200 });
      });
      const payload: ScimWebhookUserPayload = {
        type: "user.created",
        id: "evt_rt_1",
        timestamp: new Date().toISOString(),
        data: { email: "realtime@example.com", externalId: "ext-rt", firstName: "Realtime" },
      };
      const result = await processScimWebhook({
        payload,
        userStore,
        groupStore,
        organizationId: orgId,
        isAllowedEmail: () => true,
        webhookStore,
        webhookDeliveryOptions: { fetchFn: mockFetch },
      });
      expect(result.ok).toBe(true);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]!.type).toBe("user.created");
      expect(delivered[0]!.id).toBe("evt_rt_1");
      expect(delivered[0]!.data.email).toBe("realtime@example.com");
    });
  });
});
