import { describe, it, expect, vi } from "vitest";
import {
  syncGroup,
  syncGroups,
  deactivateGroup,
  deleteGroup,
  deprovisionGroup,
  type GroupSyncStore,
  type SyncedGroup,
} from "../src/group-sync.js";
import type { WebhookSubscriptionStore } from "../src/realtime-webhook.js";

function memoryStore(): GroupSyncStore {
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

describe("syncGroup", () => {
  it("creates a new group when none exists", async () => {
    const store = memoryStore();
    const result = await syncGroup(
      store,
      { externalId: "ext-1", displayName: "Engineering", memberIds: ["user_1", "user_2"] },
      { organizationId: "org_1" }
    );
    expect(result.created).toBe(true);
    expect(result.group.externalId).toBe("ext-1");
    expect(result.group.displayName).toBe("Engineering");
    const memberIds = await store.listGroupMemberIds(result.group.id);
    expect(memberIds).toEqual(["user_1", "user_2"]);
  });

  it("updates existing group when matched by externalId", async () => {
    const store = memoryStore();
    await store.createGroup("org_1", { externalId: "ext-1", displayName: "Old Name" });
    const result = await syncGroup(
      store,
      { externalId: "ext-1", displayName: "New Name", memberIds: ["user_1"] },
      { organizationId: "org_1" }
    );
    expect(result.created).toBe(false);
    expect(result.group.displayName).toBe("New Name");
    const memberIds = await store.listGroupMemberIds(result.group.id);
    expect(memberIds).toEqual(["user_1"]);
  });

  it("replaces membership on update", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-1", displayName: "Team" });
    await store.setGroupMembers(created.id, ["user_1", "user_2"]);
    await syncGroup(
      store,
      { externalId: "ext-1", displayName: "Team", memberIds: ["user_2", "user_3"] },
      { organizationId: "org_1" }
    );
    const memberIds = await store.listGroupMemberIds(created.id);
    expect(memberIds).toEqual(["user_2", "user_3"]);
  });

  it("scopes groups by organizationId", async () => {
    const store = memoryStore();
    await syncGroup(
      store,
      { externalId: "ext-1", displayName: "Org1 Group", memberIds: [] },
      { organizationId: "org_1" }
    );
    const result = await syncGroup(
      store,
      { externalId: "ext-1", displayName: "Org2 Group", memberIds: [] },
      { organizationId: "org_2" }
    );
    expect(result.created).toBe(true);
    const org1Groups = await store.listGroupsByOrganization("org_1");
    const org2Groups = await store.listGroupsByOrganization("org_2");
    expect(org1Groups).toHaveLength(1);
    expect(org2Groups).toHaveLength(1);
    expect(org1Groups[0]!.displayName).toBe("Org1 Group");
    expect(org2Groups[0]!.displayName).toBe("Org2 Group");
  });
});

describe("syncGroups", () => {
  it("syncs multiple groups and returns counts", async () => {
    const store = memoryStore();
    const result = await syncGroups(
      store,
      [
        { externalId: "ext-1", displayName: "Eng", memberIds: ["u1"] },
        { externalId: "ext-2", displayName: "Product", memberIds: ["u2"] },
      ],
      { organizationId: "org_1" }
    );
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    const list = await store.listGroupsByOrganization("org_1");
    expect(list).toHaveLength(2);
  });

  it("soft-deletes (deactivates) groups not in source when removeGroupsNotInSource is true", async () => {
    const store = memoryStore();
    const oldResult = await syncGroup(
      store,
      { externalId: "ext-old", displayName: "Old", memberIds: [] },
      { organizationId: "org_1" }
    );
    await syncGroups(
      store,
      [{ externalId: "ext-new", displayName: "New", memberIds: [] }],
      { organizationId: "org_1", removeGroupsNotInSource: true }
    );
    const list = await store.listGroupsByOrganization("org_1");
    expect(list).toHaveLength(1);
    expect(list[0]!.externalId).toBe("ext-new");
    const deactivated = await store.findGroupById(oldResult.group.id);
    expect(deactivated).not.toBeNull();
    expect(deactivated!.active).toBe(false);
  });

  it("hard-deletes groups not in source when removeGroupsNotInSource and hardDeleteRemoved are true", async () => {
    const store = memoryStore();
    const oldResult = await syncGroup(
      store,
      { externalId: "ext-old", displayName: "Old", memberIds: [] },
      { organizationId: "org_1" }
    );
    await syncGroups(
      store,
      [{ externalId: "ext-new", displayName: "New", memberIds: [] }],
      { organizationId: "org_1", removeGroupsNotInSource: true, hardDeleteRemoved: true }
    );
    const list = await store.listGroupsByOrganization("org_1");
    expect(list).toHaveLength(1);
    expect(list[0]!.externalId).toBe("ext-new");
    const deleted = await store.findGroupById(oldResult.group.id);
    expect(deleted).toBeNull();
  });

  it("does not remove groups when removeGroupsNotInSource is false", async () => {
    const store = memoryStore();
    await syncGroup(
      store,
      { externalId: "ext-old", displayName: "Old", memberIds: [] },
      { organizationId: "org_1" }
    );
    await syncGroups(
      store,
      [{ externalId: "ext-new", displayName: "New", memberIds: [] }],
      { organizationId: "org_1", removeGroupsNotInSource: false }
    );
    const list = await store.listGroupsByOrganization("org_1");
    expect(list).toHaveLength(2);
  });

  it("only removes groups within the specified organization", async () => {
    const store = memoryStore();
    const oldOrg1 = await syncGroup(
      store,
      { externalId: "ext-old", displayName: "Old Org1", memberIds: [] },
      { organizationId: "org_1" }
    );
    await syncGroup(
      store,
      { externalId: "ext-keep", displayName: "Keep Org1", memberIds: [] },
      { organizationId: "org_1" }
    );
    await syncGroup(
      store,
      { externalId: "ext-other-org", displayName: "Other Org2", memberIds: [] },
      { organizationId: "org_2" }
    );

    await syncGroups(
      store,
      [{ externalId: "ext-keep", displayName: "Keep Org1 Updated", memberIds: [] }],
      { organizationId: "org_1", removeGroupsNotInSource: true }
    );

    const org1Groups = await store.listGroupsByOrganization("org_1");
    const org2Groups = await store.listGroupsByOrganization("org_2");

    expect(org1Groups).toHaveLength(1);
    expect(org1Groups[0]!.externalId).toBe("ext-keep");
    expect(org1Groups[0]!.displayName).toBe("Keep Org1 Updated");

    const oldOrg1Record = await store.findGroupById(oldOrg1.group.id);
    expect(oldOrg1Record).not.toBeNull();
    expect(oldOrg1Record!.active).toBe(false);

    expect(org2Groups).toHaveLength(1);
    expect(org2Groups[0]!.externalId).toBe("ext-other-org");
    expect(org2Groups[0]!.displayName).toBe("Other Org2");
  });
});

describe("deactivateGroup / deleteGroup / deprovisionGroup (soft delete vs delete)", () => {
  it("deactivateGroup marks group inactive (soft delete)", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-1", displayName: "Team" });
    await deactivateGroup(store, created.id);
    const found = await store.findGroupById(created.id);
    expect(found).not.toBeNull();
    expect(found!.active).toBe(false);
  });

  it("deleteGroup removes group (hard delete)", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-1", displayName: "Team" });
    await deleteGroup(store, created.id);
    const found = await store.findGroupById(created.id);
    expect(found).toBeNull();
  });

  it("deprovisionGroup soft-deletes by default", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-1", displayName: "Team" });
    await deprovisionGroup(store, created.id);
    const found = await store.findGroupById(created.id);
    expect(found).not.toBeNull();
    expect(found!.active).toBe(false);
  });

  it("deprovisionGroup hard-deletes when options.hard is true", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-1", displayName: "Team" });
    await deprovisionGroup(store, created.id, { hard: true });
    const found = await store.findGroupById(created.id);
    expect(found).toBeNull();
  });

  it("deactivate vs delete: deactivate marks inactive, delete removes", async () => {
    const store = memoryStore();
    const g1 = await store.createGroup("org_1", { externalId: "ext-1", displayName: "One" });
    const g2 = await store.createGroup("org_1", { externalId: "ext-2", displayName: "Two" });
    await deactivateGroup(store, g1.id);
    await deleteGroup(store, g2.id);
    const afterDeactivate = await store.findGroupById(g1.id);
    const afterDelete = await store.findGroupById(g2.id);
    expect(afterDeactivate).not.toBeNull();
    expect(afterDeactivate!.active).toBe(false);
    expect(afterDelete).toBeNull();
  });

  it("deactivateGroup is no-op when group does not exist", async () => {
    const store = memoryStore();
    await expect(deactivateGroup(store, "nonexistent")).resolves.toBeUndefined();
  });

  it("deleteGroup is no-op when group does not exist", async () => {
    const store = memoryStore();
    await expect(deleteGroup(store, "nonexistent")).resolves.toBeUndefined();
  });

  it("deprovisionGroup is no-op when group does not exist", async () => {
    const store = memoryStore();
    await expect(deprovisionGroup(store, "nonexistent")).resolves.toBeUndefined();
  });
});

describe("realtime sync webhook", () => {
  const orgId = "org_1";
  const delivered: { type: string; data: Record<string, unknown> }[] = [];
  const webhookStore: WebhookSubscriptionStore = {
    listSubscriptions: async () => [{ url: "https://hooks.example.com/sync", secret: "sec" }],
  };
  const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = init?.body as string;
    if (body) {
      const parsed = JSON.parse(body) as { type: string; data: Record<string, unknown> };
      delivered.push({ type: parsed.type, data: parsed.data });
    }
    return new Response(null, { status: 200 });
  });

  beforeEach(() => {
    delivered.length = 0;
    mockFetch.mockClear();
  });

  it("delivers group.created when syncGroup creates a group with realtimeWebhook", async () => {
    const store = memoryStore();
    const result = await syncGroup(
      store,
      { externalId: "ext-sync", displayName: "Sync Team", memberIds: ["user_1"] },
      { organizationId: orgId, realtimeWebhook: { organizationId: orgId, webhookStore, webhookDeliveryOptions: { fetchFn: mockFetch } } }
    );
    expect(result.created).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.type).toBe("group.created");
    expect(delivered[0]!.data.displayName).toBe("Sync Team");
    expect((delivered[0]!.data.members as { value: string }[])?.map((m) => m.value)).toEqual(["user_1"]);
  });

  it("delivers group.updated when syncGroup updates existing group with realtimeWebhook", async () => {
    const store = memoryStore();
    await syncGroup(
      store,
      { externalId: "ext-upd", displayName: "Original", memberIds: [] },
      { organizationId: orgId }
    );
    delivered.length = 0;
    const result = await syncGroup(
      store,
      { externalId: "ext-upd", displayName: "Updated Name", memberIds: ["user_1"] },
      { organizationId: orgId, realtimeWebhook: { organizationId: orgId, webhookStore, webhookDeliveryOptions: { fetchFn: mockFetch } } }
    );
    expect(result.created).toBe(false);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.type).toBe("group.updated");
    expect(delivered[0]!.data.displayName).toBe("Updated Name");
  });

  it("delivers group.deleted for each removed group when syncGroups removeGroupsNotInSource with realtimeWebhook", async () => {
    const store = memoryStore();
    await syncGroup(
      store,
      { externalId: "ext-rm", displayName: "To Remove", memberIds: [] },
      { organizationId: orgId }
    );
    await syncGroup(
      store,
      { externalId: "ext-keep", displayName: "To Keep", memberIds: [] },
      { organizationId: orgId }
    );
    delivered.length = 0;
    await syncGroups(
      store,
      [{ externalId: "ext-keep", displayName: "To Keep", memberIds: [] }],
      { organizationId: orgId, removeGroupsNotInSource: true, realtimeWebhook: { organizationId: orgId, webhookStore, webhookDeliveryOptions: { fetchFn: mockFetch } } }
    );
    const deletedEvents = delivered.filter((d) => d.type === "group.deleted");
    expect(deletedEvents).toHaveLength(1);
    expect(deletedEvents[0]!.data.displayName).toBe("To Remove");
  });

  it("delivers group.deleted when deprovisionGroup called with realtimeWebhook", async () => {
    const store = memoryStore();
    const created = await store.createGroup("org_1", { externalId: "ext-dep", displayName: "Deprovisioned" });
    await deprovisionGroup(store, created.id, {
      realtimeWebhook: { organizationId: orgId, webhookStore, webhookDeliveryOptions: { fetchFn: mockFetch } },
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.type).toBe("group.deleted");
    expect(delivered[0]!.data.displayName).toBe("Deprovisioned");
  });
});
