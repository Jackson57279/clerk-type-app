import { describe, it, expect } from "vitest";
import {
  syncGroup,
  syncGroups,
  type GroupSyncStore,
  type SyncedGroup,
} from "../src/group-sync.js";

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
      return id ? groups.get(id) ?? null : null;
    },
    async findGroupById(id: string) {
      return groups.get(id) ?? null;
    },
    async listGroupsByOrganization(organizationId: string) {
      const list: SyncedGroup[] = [];
      for (const g of groups.values()) {
        if (g.organizationId === organizationId) list.push({ id: g.id, externalId: g.externalId, displayName: g.displayName });
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
      };
      groups.set(id, group);
      orgMap(organizationId).set(data.externalId, id);
      members.set(id, []);
      return { id: group.id, externalId: group.externalId, displayName: group.displayName };
    },
    async updateGroup(id: string, data: { displayName?: string }) {
      const g = groups.get(id);
      if (!g) throw new Error("Group not found");
      if (data.displayName !== undefined) g.displayName = data.displayName;
      return { id: g.id, externalId: g.externalId, displayName: g.displayName };
    },
    async deleteGroup(id: string) {
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

  it("removes groups not in source when removeGroupsNotInSource is true", async () => {
    const store = memoryStore();
    await syncGroup(
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
});
