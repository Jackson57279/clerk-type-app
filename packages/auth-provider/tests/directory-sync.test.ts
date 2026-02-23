import { describe, it, expect } from "vitest";
import {
  runDirectorySync,
  type DirectorySource,
  type DirectoryUser,
  type DirectoryGroup,
  type DirectorySyncUserStore,
} from "../src/directory-sync.js";
import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "../src/user-provisioning.js";
import type { GroupSyncStore, SyncedGroup } from "../src/group-sync.js";

function memoryDirectorySyncUserStore(initial: ProvisionedUser[] = []): DirectorySyncUserStore {
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
    async listUsers(organizationId: string) {
      void organizationId;
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

function staticSource(users: DirectoryUser[], groups: DirectoryGroup[]): DirectorySource {
  return {
    async listUsers() {
      return [...users];
    },
    async listGroups() {
      return [...groups];
    },
  };
}

describe("directory-sync", () => {
  it("provisions users from directory source", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    const source = staticSource(
      [
        { externalId: "ext1", email: "a@example.com", firstName: "A", lastName: "User" },
        { email: "b@example.com", name: "B User" },
      ],
      []
    );

    const result = await runDirectorySync("org_1", source, userStore, groupStore, {
      isAllowedEmail: () => true,
    });

    expect(result.usersCreated).toBe(2);
    expect(result.usersUpdated).toBe(0);
    expect(result.usersRemoved).toBe(0);
    expect(result.groupsCreated).toBe(0);

    const list = await userStore.listUsers("org_1");
    expect(list).toHaveLength(2);
    expect(list.map((u) => u.email).sort()).toEqual(["a@example.com", "b@example.com"]);
    const a = await userStore.findByExternalId("ext1");
    expect(a?.firstName).toBe("A");
  });

  it("updates existing users by externalId", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    await runDirectorySync(
      "org_1",
      staticSource([{ externalId: "ext1", email: "a@example.com", firstName: "Alice" }], []),
      userStore,
      groupStore,
      { isAllowedEmail: () => true }
    );

    const result = await runDirectorySync(
      "org_1",
      staticSource([{ externalId: "ext1", email: "a@example.com", firstName: "Alicia" }], []),
      userStore,
      groupStore,
      { isAllowedEmail: () => true }
    );

    expect(result.usersCreated).toBe(0);
    expect(result.usersUpdated).toBe(1);
    const u = await userStore.findByExternalId("ext1");
    expect(u?.firstName).toBe("Alicia");
  });

  it("syncs groups with members by externalId and email", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    const source = staticSource(
      [
        { externalId: "e1", email: "u1@example.com" },
        { externalId: "e2", email: "u2@example.com" },
      ],
      [
        {
          externalId: "g1",
          displayName: "Team Alpha",
          memberExternalIds: ["e1"],
          memberEmails: ["u2@example.com"],
        },
      ]
    );

    const result = await runDirectorySync("org_1", source, userStore, groupStore, {
      isAllowedEmail: () => true,
    });

    expect(result.usersCreated).toBe(2);
    expect(result.groupsCreated).toBe(1);

    const groups = await groupStore.listGroupsByOrganization("org_1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.displayName).toBe("Team Alpha");
    const memberIds = await groupStore.listGroupMemberIds(groups[0]!.id);
    expect(memberIds).toHaveLength(2);
  });

  it("removeUsersNotInSource deprovisions users not in directory", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    const allowAll = () => true;
    await runDirectorySync(
      "org_1",
      staticSource(
        [
          { externalId: "e1", email: "keep@example.com" },
          { externalId: "e2", email: "remove@example.com" },
        ],
        []
      ),
      userStore,
      groupStore,
      { isAllowedEmail: allowAll }
    );

    const result = await runDirectorySync(
      "org_1",
      staticSource([{ externalId: "e1", email: "keep@example.com" }], []),
      userStore,
      groupStore,
      { removeUsersNotInSource: true, isAllowedEmail: allowAll }
    );

    expect(result.usersRemoved).toBe(1);
    const list = await userStore.listUsers("org_1");
    expect(list).toHaveLength(1);
    expect(list[0]?.email).toBe("keep@example.com");
  });

  it("removeGroupsNotInSource soft-deletes groups not in directory", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    await runDirectorySync(
      "org_1",
      staticSource(
        [{ email: "u@example.com" }],
        [
          { externalId: "g1", displayName: "Keep" },
          { externalId: "g2", displayName: "Remove" },
        ]
      ),
      userStore,
      groupStore,
      { isAllowedEmail: () => true }
    );

    const result = await runDirectorySync(
      "org_1",
      staticSource(
        [{ email: "u@example.com" }],
        [{ externalId: "g1", displayName: "Keep" }]
      ),
      userStore,
      groupStore,
      { removeGroupsNotInSource: true, isAllowedEmail: () => true }
    );

    expect(result.groupsRemoved).toBe(1);
    const groups = await groupStore.listGroupsByOrganization("org_1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.externalId).toBe("g1");
  });

  it("isAllowedEmail skips disallowed users", async () => {
    const userStore = memoryDirectorySyncUserStore();
    const groupStore = memoryGroupStore();
    const source = staticSource(
      [
        { email: "allowed@company.com" },
        { email: "blocked@other.com" },
      ],
      []
    );

    await runDirectorySync("org_1", source, userStore, groupStore, {
      isAllowedEmail: (email) => email.endsWith("@company.com"),
    });

    const list = await userStore.listUsers("org_1");
    expect(list).toHaveLength(1);
    expect(list[0]?.email).toBe("allowed@company.com");
  });
});
