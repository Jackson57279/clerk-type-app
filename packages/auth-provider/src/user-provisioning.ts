export interface ProvisionUserData {
  email: string;
  externalId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

export interface ProvisionedUser {
  id: string;
  email: string;
  externalId: string | undefined;
  name: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  active: boolean;
}

export interface UserProvisioningStore {
  findById(id: string): Promise<ProvisionedUser | null>;
  findByEmail(email: string): Promise<ProvisionedUser | null>;
  findByExternalId(externalId: string): Promise<ProvisionedUser | null>;
  create(data: ProvisionUserData): Promise<ProvisionedUser>;
  update(id: string, data: Partial<ProvisionUserData>): Promise<ProvisionedUser>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
}

export interface ProvisionOptions {
  organizationId?: string;
  reactivateIfDeactivated?: boolean;
  isAllowedEmail?: (email: string) => boolean;
  realtimeWebhook?: RealtimeWebhookOptions;
}

export interface ProvisionResult {
  user: ProvisionedUser;
  created: boolean;
}

import { createDefaultEmailDomainChecker } from "./email-domain-restriction.js";
import { validateNoCardDataInRecord } from "./pci-dss.js";
import {
  deactivateEntity,
  deleteEntity,
  deprovisionEntity,
  type DeprovisionOptions,
} from "./soft-delete.js";
import {
  createRealtimeSyncPayload,
  deliverRealtimeWebhook,
  type DeliverWebhookOptions,
  type WebhookSubscriptionStore,
} from "./realtime-webhook.js";
export type { DeprovisionOptions } from "./soft-delete.js";

export interface RealtimeWebhookOptions {
  organizationId: string;
  webhookStore: WebhookSubscriptionStore;
  webhookDeliveryOptions?: DeliverWebhookOptions;
}

function userToSyncData(user: ProvisionedUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    externalId: user.externalId,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    active: user.active,
  };
}

function ensureNoCardDataInProvisionData(data: ProvisionUserData | Partial<ProvisionUserData>): void {
  const r = validateNoCardDataInRecord({
    email: data.email,
    externalId: data.externalId,
    name: data.name,
    firstName: data.firstName,
    lastName: data.lastName,
  });
  if (!r.ok) throw new Error(r.reason);
}

export async function provisionUser(
  store: UserProvisioningStore,
  data: ProvisionUserData,
  options: ProvisionOptions = {}
): Promise<ProvisionResult> {
  const { reactivateIfDeactivated = true, isAllowedEmail: isAllowedEmailOpt, realtimeWebhook } = options;

  ensureNoCardDataInProvisionData(data);

  if (data.externalId) {
    const byExternal = await store.findByExternalId(data.externalId);
    if (byExternal) {
      if (!byExternal.active && reactivateIfDeactivated) {
        const updated = await store.update(byExternal.id, {
          ...data,
          active: data.active ?? true,
        });
        if (realtimeWebhook) {
          const payload = createRealtimeSyncPayload("user.updated", userToSyncData(updated));
          await deliverRealtimeWebhook(
            realtimeWebhook.webhookStore,
            realtimeWebhook.organizationId,
            payload,
            realtimeWebhook.webhookDeliveryOptions
          );
        }
        return { user: updated, created: false };
      }
      if (byExternal.active) {
        const updated = await store.update(byExternal.id, data);
        if (realtimeWebhook) {
          const payload = createRealtimeSyncPayload("user.updated", userToSyncData(updated));
          await deliverRealtimeWebhook(
            realtimeWebhook.webhookStore,
            realtimeWebhook.organizationId,
            payload,
            realtimeWebhook.webhookDeliveryOptions
          );
        }
        return { user: updated, created: false };
      }
    }
  }

  const byEmail = await store.findByEmail(data.email);
  if (byEmail) {
    if (!byEmail.active && reactivateIfDeactivated) {
      const updated = await store.update(byEmail.id, {
        ...data,
        active: data.active ?? true,
      });
      if (realtimeWebhook) {
        const payload = createRealtimeSyncPayload("user.updated", userToSyncData(updated));
        await deliverRealtimeWebhook(
          realtimeWebhook.webhookStore,
          realtimeWebhook.organizationId,
          payload,
          realtimeWebhook.webhookDeliveryOptions
        );
      }
      return { user: updated, created: false };
    }
    if (byEmail.active) {
      const updated = await store.update(byEmail.id, data);
      if (realtimeWebhook) {
        const payload = createRealtimeSyncPayload("user.updated", userToSyncData(updated));
        await deliverRealtimeWebhook(
          realtimeWebhook.webhookStore,
          realtimeWebhook.organizationId,
          payload,
          realtimeWebhook.webhookDeliveryOptions
        );
      }
      return { user: updated, created: false };
    }
  }

  const isAllowed = isAllowedEmailOpt ?? createDefaultEmailDomainChecker();
  if (!isAllowed(data.email)) {
    throw new Error("Email domain not allowed");
  }

  const user = await store.create({
    ...data,
    active: data.active ?? true,
  });
  if (realtimeWebhook) {
    const payload = createRealtimeSyncPayload("user.created", userToSyncData(user));
    await deliverRealtimeWebhook(
      realtimeWebhook.webhookStore,
      realtimeWebhook.organizationId,
      payload,
      realtimeWebhook.webhookDeliveryOptions
    );
  }
  return { user, created: true };
}

export async function deactivateUser(
  store: UserProvisioningStore,
  userId: string
): Promise<void> {
  return deactivateEntity(store, userId);
}

export async function deleteUser(
  store: UserProvisioningStore,
  userId: string
): Promise<void> {
  return deleteEntity(store, userId);
}

export interface DeprovisionUserOptions extends DeprovisionOptions {
  realtimeWebhook?: RealtimeWebhookOptions;
}

export async function deprovisionUser(
  store: UserProvisioningStore,
  userId: string,
  options: DeprovisionUserOptions = {}
): Promise<void> {
  const { realtimeWebhook, ...deprovisionOpts } = options;
  if (realtimeWebhook) {
    const user = await store.findById(userId);
    if (user) {
      const payload = createRealtimeSyncPayload("user.deleted", userToSyncData(user));
      await deliverRealtimeWebhook(
        realtimeWebhook.webhookStore,
        realtimeWebhook.organizationId,
        payload,
        realtimeWebhook.webhookDeliveryOptions
      );
    }
  }
  return deprovisionEntity(store, userId, deprovisionOpts);
}
