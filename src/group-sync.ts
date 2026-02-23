export interface SyncGroupData {
  externalId: string;
  displayName: string;
  memberIds: string[];
}

export interface SyncedGroup {
  id: string;
  externalId: string;
  displayName: string;
}

export interface GroupSyncStore {
  findGroupByExternalId(organizationId: string, externalId: string): Promise<SyncedGroup | null>;
  findGroupById(id: string): Promise<SyncedGroup | null>;
  listGroupsByOrganization(organizationId: string): Promise<SyncedGroup[]>;
  createGroup(organizationId: string, data: { externalId: string; displayName: string }): Promise<SyncedGroup>;
  updateGroup(id: string, data: { displayName?: string }): Promise<SyncedGroup>;
  deleteGroup(id: string): Promise<void>;
  listGroupMemberIds(groupId: string): Promise<string[]>;
  setGroupMembers(groupId: string, userIds: string[]): Promise<void>;
}

export interface SyncGroupOptions {
  organizationId: string;
}

export interface SyncGroupResult {
  group: SyncedGroup;
  created: boolean;
}

export async function syncGroup(
  store: GroupSyncStore,
  data: SyncGroupData,
  options: SyncGroupOptions
): Promise<SyncGroupResult> {
  const { organizationId } = options;
  const existing = await store.findGroupByExternalId(organizationId, data.externalId);

  let group: SyncedGroup;
  if (existing) {
    group = await store.updateGroup(existing.id, { displayName: data.displayName });
  } else {
    group = await store.createGroup(organizationId, {
      externalId: data.externalId,
      displayName: data.displayName,
    });
  }

  await store.setGroupMembers(group.id, data.memberIds);
  return { group, created: !existing };
}

export interface SyncGroupsOptions extends SyncGroupOptions {
  removeGroupsNotInSource?: boolean;
}

export interface SyncGroupsResult {
  created: number;
  updated: number;
  removed: number;
}

export async function syncGroups(
  store: GroupSyncStore,
  groups: SyncGroupData[],
  options: SyncGroupsOptions
): Promise<SyncGroupsResult> {
  const { organizationId, removeGroupsNotInSource = false } = options;
  const externalIds = new Set(groups.map((g) => g.externalId));
  let created = 0;
  let updated = 0;

  for (const data of groups) {
    const result = await syncGroup(store, data, { organizationId });
    if (result.created) created++;
    else updated++;
  }

  let removed = 0;
  if (removeGroupsNotInSource) {
    const existing = await store.listGroupsByOrganization(organizationId);
    for (const g of existing) {
      if (!externalIds.has(g.externalId)) {
        await store.deleteGroup(g.id);
        removed++;
      }
    }
  }

  return { created, updated, removed };
}
