import {
  createRealtimeSyncPayload,
  deliverRealtimeWebhook,
  type DeliverWebhookOptions,
  type WebhookSubscriptionStore,
} from "./realtime-webhook.js";

export interface SyncGroupData {
  externalId: string;
  displayName: string;
  memberIds: string[];
}

export interface SyncedGroup {
  id: string;
  externalId: string;
  displayName: string;
  active: boolean;
}

export interface GroupSyncStore {
  findGroupByExternalId(organizationId: string, externalId: string): Promise<SyncedGroup | null>;
  findGroupById(id: string): Promise<SyncedGroup | null>;
  listGroupsByOrganization(organizationId: string): Promise<SyncedGroup[]>;
  createGroup(organizationId: string, data: { externalId: string; displayName: string }): Promise<SyncedGroup>;
  updateGroup(id: string, data: { displayName?: string }): Promise<SyncedGroup>;
  softDeleteGroup(id: string): Promise<void>;
  hardDeleteGroup(id: string): Promise<void>;
  listGroupMemberIds(groupId: string): Promise<string[]>;
  setGroupMembers(groupId: string, userIds: string[]): Promise<void>;
}

export interface RealtimeWebhookOptions {
  organizationId: string;
  webhookStore: WebhookSubscriptionStore;
  webhookDeliveryOptions?: DeliverWebhookOptions;
}

export interface SyncGroupOptions {
  organizationId: string;
  realtimeWebhook?: RealtimeWebhookOptions;
}

export interface SyncGroupResult {
  group: SyncedGroup;
  created: boolean;
}

function groupToSyncData(group: SyncedGroup, memberIds?: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: group.id,
    externalId: group.externalId,
    displayName: group.displayName,
    active: group.active,
  };
  if (memberIds !== undefined) data.members = memberIds.map((id) => ({ value: id }));
  return data;
}

export async function syncGroup(
  store: GroupSyncStore,
  data: SyncGroupData,
  options: SyncGroupOptions
): Promise<SyncGroupResult> {
  const { organizationId, realtimeWebhook } = options;
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

  if (realtimeWebhook) {
    const payload = createRealtimeSyncPayload(
      existing ? "group.updated" : "group.created",
      groupToSyncData(group, data.memberIds)
    );
    await deliverRealtimeWebhook(
      realtimeWebhook.webhookStore,
      realtimeWebhook.organizationId,
      payload,
      realtimeWebhook.webhookDeliveryOptions
    );
  }
  return { group, created: !existing };
}

export interface SyncGroupsOptions extends SyncGroupOptions {
  removeGroupsNotInSource?: boolean;
  hardDeleteRemoved?: boolean;
}

export interface SyncGroupsResult {
  created: number;
  updated: number;
  removed: number;
  createdGroups: SyncedGroup[];
  updatedGroups: SyncedGroup[];
  removedGroups: SyncedGroup[];
}

export async function syncGroups(
  store: GroupSyncStore,
  groups: SyncGroupData[],
  options: SyncGroupsOptions
): Promise<SyncGroupsResult> {
  const { organizationId, removeGroupsNotInSource = false, realtimeWebhook } = options;
  const externalIds = new Set(groups.map((g) => g.externalId));
  const createdGroups: SyncedGroup[] = [];
  const updatedGroups: SyncedGroup[] = [];

  for (const data of groups) {
    const result = await syncGroup(store, data, { organizationId, realtimeWebhook });
    if (result.created) createdGroups.push(result.group);
    else updatedGroups.push(result.group);
  }

  const removedGroups: SyncedGroup[] = [];
  if (removeGroupsNotInSource) {
    const existing = await store.listGroupsByOrganization(organizationId);
    const hardDeleteRemoved = options.hardDeleteRemoved ?? false;
    for (const g of existing) {
      if (!externalIds.has(g.externalId)) {
        removedGroups.push(g);
        if (realtimeWebhook) {
          const payload = createRealtimeSyncPayload("group.deleted", groupToSyncData(g));
          await deliverRealtimeWebhook(
            realtimeWebhook.webhookStore,
            realtimeWebhook.organizationId,
            payload,
            realtimeWebhook.webhookDeliveryOptions
          );
        }
        if (hardDeleteRemoved) await store.hardDeleteGroup(g.id);
        else await store.softDeleteGroup(g.id);
      }
    }
  }

  return {
    created: createdGroups.length,
    updated: updatedGroups.length,
    removed: removedGroups.length,
    createdGroups,
    updatedGroups,
    removedGroups,
  };
}

export interface GroupDeprovisionOptions {
  hard?: boolean;
  realtimeWebhook?: RealtimeWebhookOptions;
}

export async function deactivateGroup(
  store: GroupSyncStore,
  groupId: string
): Promise<void> {
  const group = await store.findGroupById(groupId);
  if (!group) return;
  await store.softDeleteGroup(groupId);
}

export async function deleteGroup(
  store: GroupSyncStore,
  groupId: string
): Promise<void> {
  const group = await store.findGroupById(groupId);
  if (!group) return;
  await store.hardDeleteGroup(groupId);
}

export async function deprovisionGroup(
  store: GroupSyncStore,
  groupId: string,
  options: GroupDeprovisionOptions = {}
): Promise<void> {
  const group = await store.findGroupById(groupId);
  if (!group) return;
  const { realtimeWebhook, hard } = options;
  if (realtimeWebhook) {
    const payload = createRealtimeSyncPayload("group.deleted", groupToSyncData(group));
    await deliverRealtimeWebhook(
      realtimeWebhook.webhookStore,
      realtimeWebhook.organizationId,
      payload,
      realtimeWebhook.webhookDeliveryOptions
    );
  }
  if (hard) {
    await store.hardDeleteGroup(groupId);
  } else {
    await store.softDeleteGroup(groupId);
  }
}
