import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserProvisioningStore } from "./user-provisioning.js";
import { provisionUser, deprovisionUser } from "./user-provisioning.js";
import type { GroupSyncStore } from "./group-sync.js";
import { syncGroup } from "./group-sync.js";
import { deliverRealtimeWebhook } from "./realtime-webhook.js";
import type { DeliverWebhookOptions, RealtimeWebhookPayload } from "./realtime-webhook.js";
import type { WebhookSubscriptionStore } from "./realtime-webhook.js";

export type ScimWebhookEventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "group.created"
  | "group.updated"
  | "group.deleted";

export interface ScimWebhookUserData {
  id?: string;
  externalId?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

export interface ScimWebhookGroupMember {
  value: string;
  display?: string;
}

export interface ScimWebhookGroupData {
  id?: string;
  externalId: string;
  displayName: string;
  members?: ScimWebhookGroupMember[];
}

export interface ScimWebhookPayloadBase {
  type: ScimWebhookEventType;
  id: string;
  timestamp: string;
  organizationId?: string;
}

export interface ScimWebhookUserPayload extends ScimWebhookPayloadBase {
  type: "user.created" | "user.updated" | "user.deleted";
  data: ScimWebhookUserData;
}

export interface ScimWebhookGroupPayload extends ScimWebhookPayloadBase {
  type: "group.created" | "group.updated" | "group.deleted";
  data: ScimWebhookGroupData;
}

export type ScimWebhookPayload = ScimWebhookUserPayload | ScimWebhookGroupPayload;

export interface ProcessWebhookResult {
  ok: boolean;
  eventId: string;
  created?: boolean;
  error?: string;
}

const SIGNATURE_PREFIX = "sha256=";

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string
): boolean {
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const actual = hmac.digest("hex");
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}

export interface ProcessScimWebhookParams {
  payload: ScimWebhookPayload;
  userStore: UserProvisioningStore;
  groupStore: GroupSyncStore;
  organizationId: string;
  webhookStore?: WebhookSubscriptionStore;
  webhookDeliveryOptions?: DeliverWebhookOptions;
  isAllowedEmail?: (email: string) => boolean;
}

function toRealtimePayload(payload: ScimWebhookPayload): RealtimeWebhookPayload {
  return {
    type: payload.type,
    id: payload.id,
    timestamp: payload.timestamp,
    data: payload.data as Record<string, unknown>,
  };
}

export async function processScimWebhook(
  params: ProcessScimWebhookParams
): Promise<ProcessWebhookResult> {
  const { payload, userStore, groupStore, organizationId, webhookStore, webhookDeliveryOptions, isAllowedEmail } = params;
  const eventId = payload.id;

  if (payload.type === "user.deleted") {
    const { data } = payload;
    const externalId = data.externalId ?? data.id;
    if (!externalId) {
      return { ok: false, eventId, error: "user.deleted requires data.externalId or data.id" };
    }
    const user = await userStore.findByExternalId(externalId);
    if (!user) return { ok: true, eventId };
    await deprovisionUser(userStore, user.id, { hard: false });
    if (webhookStore) {
      await deliverRealtimeWebhook(webhookStore, organizationId, toRealtimePayload(payload), webhookDeliveryOptions);
    }
    return { ok: true, eventId };
  }

  if (payload.type === "user.created" || payload.type === "user.updated") {
    const { data } = payload;
    if (!data.email) {
      return { ok: false, eventId, error: "user.created/updated requires data.email" };
    }
    const result = await provisionUser(
      userStore,
      {
        email: data.email,
        externalId: data.externalId ?? data.id,
        name: data.name,
        firstName: data.firstName,
        lastName: data.lastName,
        active: data.active ?? true,
      },
      { organizationId, reactivateIfDeactivated: true, isAllowedEmail }
    );
    if (webhookStore) {
      await deliverRealtimeWebhook(webhookStore, organizationId, toRealtimePayload(payload), webhookDeliveryOptions);
    }
    return { ok: true, eventId, created: result.created };
  }

  if (payload.type === "group.deleted") {
    const { data } = payload;
    const group = await groupStore.findGroupByExternalId(organizationId, data.externalId);
    if (!group) return { ok: true, eventId };
    await groupStore.softDeleteGroup(group.id);
    if (webhookStore) {
      await deliverRealtimeWebhook(webhookStore, organizationId, toRealtimePayload(payload), webhookDeliveryOptions);
    }
    return { ok: true, eventId };
  }

  if (payload.type === "group.created" || payload.type === "group.updated") {
    const { data } = payload;
    const memberIds: string[] = [];
    if (data.members?.length) {
      for (const m of data.members) {
        const user =
          (await userStore.findByExternalId(m.value)) ?? (await userStore.findById(m.value));
        if (user?.active) memberIds.push(user.id);
      }
    }
    const result = await syncGroup(
      groupStore,
      {
        externalId: data.externalId,
        displayName: data.displayName,
        memberIds,
      },
      { organizationId }
    );
    if (webhookStore) {
      await deliverRealtimeWebhook(webhookStore, organizationId, toRealtimePayload(payload), webhookDeliveryOptions);
    }
    return { ok: true, eventId, created: result.created };
  }

  return { ok: false, eventId, error: `Unknown event type: ${(payload as ScimWebhookPayload).type}` };
}
