import type { UserProvisioningStore, ProvisionedUser, ProvisionUserData } from "./user-provisioning.js";
import { provisionUser, deprovisionUser } from "./user-provisioning.js";
import type { GroupSyncStore } from "./group-sync.js";
import { syncGroups } from "./group-sync.js";
import type { DeliverWebhookOptions, WebhookSubscriptionStore } from "./realtime-webhook.js";

export interface DirectoryUser {
  externalId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  active?: boolean;
}

export interface DirectoryGroup {
  externalId: string;
  displayName: string;
  memberExternalIds?: string[];
  memberEmails?: string[];
}

export interface DirectorySource {
  listUsers(): Promise<DirectoryUser[]>;
  listGroups(): Promise<DirectoryGroup[]>;
}

export interface DirectorySyncUserStore extends UserProvisioningStore {
  listUsers(organizationId: string): Promise<ProvisionedUser[]>;
}

export interface RealtimeWebhookOptions {
  organizationId: string;
  webhookStore: WebhookSubscriptionStore;
  webhookDeliveryOptions?: DeliverWebhookOptions;
}

export interface RunDirectorySyncOptions {
  removeUsersNotInSource?: boolean;
  removeGroupsNotInSource?: boolean;
  hardDeleteRemoved?: boolean;
  isAllowedEmail?: (email: string) => boolean;
  realtimeWebhook?: RealtimeWebhookOptions;
}

export interface DirectorySyncResult {
  usersCreated: number;
  usersUpdated: number;
  usersRemoved: number;
  groupsCreated: number;
  groupsUpdated: number;
  groupsRemoved: number;
}

function directoryUserToProvisionData(u: DirectoryUser): ProvisionUserData {
  return {
    email: u.email,
    externalId: u.externalId,
    firstName: u.firstName,
    lastName: u.lastName,
    name: u.name,
    active: u.active ?? true,
  };
}

export async function runDirectorySync(
  organizationId: string,
  source: DirectorySource,
  userStore: DirectorySyncUserStore,
  groupStore: GroupSyncStore,
  options: RunDirectorySyncOptions = {}
): Promise<DirectorySyncResult> {
  const {
    removeUsersNotInSource = false,
    removeGroupsNotInSource = false,
    hardDeleteRemoved = false,
    isAllowedEmail,
    realtimeWebhook,
  } = options;

  const idByExternalId = new Map<string, string>();
  const idByEmail = new Map<string, string>();

  const directoryUsers = await source.listUsers();
  let usersCreated = 0;
  let usersUpdated = 0;

  for (const u of directoryUsers) {
    const data = directoryUserToProvisionData(u);
    try {
      const result = await provisionUser(userStore, data, {
        organizationId,
        isAllowedEmail,
        realtimeWebhook,
      });
      if (result.user.externalId) idByExternalId.set(result.user.externalId, result.user.id);
      idByEmail.set(result.user.email.toLowerCase(), result.user.id);
      if (result.created) usersCreated++;
      else usersUpdated++;
    } catch {
      // skip user (e.g. domain not allowed)
    }
  }

  function resolveMemberRefs(group: DirectoryGroup): string[] {
    const ids = new Set<string>();
    for (const extId of group.memberExternalIds ?? []) {
      const id = idByExternalId.get(extId);
      if (id) ids.add(id);
    }
    for (const email of group.memberEmails ?? []) {
      const id = idByEmail.get(email.toLowerCase());
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }

  const directoryGroups = await source.listGroups();
  const syncGroupDataList = directoryGroups.map((g) => ({
    externalId: g.externalId,
    displayName: g.displayName,
    memberIds: resolveMemberRefs(g),
  }));

  const groupResult = await syncGroups(groupStore, syncGroupDataList, {
    organizationId,
    removeGroupsNotInSource,
    hardDeleteRemoved,
    realtimeWebhook,
  });

  let usersRemoved = 0;
  if (removeUsersNotInSource) {
    const directoryEmails = new Set(directoryUsers.map((u) => u.email.toLowerCase()));
    const directoryExternalIds = new Set(
      directoryUsers.map((u) => u.externalId).filter((x): x is string => !!x)
    );
    const existing = await userStore.listUsers(organizationId);
    for (const user of existing) {
      const inSource =
        (user.externalId && directoryExternalIds.has(user.externalId)) ||
        directoryEmails.has(user.email.toLowerCase());
      if (!inSource) {
        await deprovisionUser(userStore, user.id, {
          hard: hardDeleteRemoved,
          realtimeWebhook,
        });
        usersRemoved++;
      }
    }
  }

  return {
    usersCreated,
    usersUpdated,
    usersRemoved,
    groupsCreated: groupResult.created,
    groupsUpdated: groupResult.updated,
    groupsRemoved: groupResult.removed,
  };
}
