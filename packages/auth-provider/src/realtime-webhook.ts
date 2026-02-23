import { createHmac, randomUUID } from "node:crypto";

export type RealtimeWebhookEventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "group.created"
  | "group.updated"
  | "group.deleted"
  | "session.created"
  | "session.revoked"
  | "organization.created"
  | "organization_membership.created"
  | "organization_invitation.accepted"
  | "billing.seat_usage";

export interface RealtimeWebhookPayload {
  type: RealtimeWebhookEventType;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
}

export type RealtimeSyncEventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "group.created"
  | "group.updated"
  | "group.deleted";

export function createRealtimeSyncPayload(
  type: RealtimeSyncEventType,
  data: Record<string, unknown>,
  id: string = randomUUID()
): RealtimeWebhookPayload {
  return {
    type,
    id,
    timestamp: new Date().toISOString(),
    data,
  };
}

export interface WebhookSubscription {
  url: string;
  secret: string;
}

export interface WebhookSubscriptionStore {
  listSubscriptions(organizationId: string, eventType?: RealtimeWebhookEventType): Promise<WebhookSubscription[]>;
}

const SIGNATURE_HEADER = "x-webhook-signature";
const IDEMPOTENCY_HEADER = "x-idempotency-key";
const SIGNATURE_PREFIX = "sha256=";

export function signWebhookPayload(secret: string, rawBody: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  return SIGNATURE_PREFIX + hmac.digest("hex");
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface DeliverWebhookOptions {
  retryDelaysMs?: number[];
  fetchFn?: typeof fetch;
}

export async function deliverWebhook(
  subscription: WebhookSubscription,
  payload: RealtimeWebhookPayload,
  options: DeliverWebhookOptions = {}
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, fetchFn = fetch } = options;
  const rawBody = JSON.stringify(payload);
  const signature = signWebhookPayload(subscription.secret, rawBody);

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  const attempt = async (): Promise<{ ok: boolean; status?: number; error?: string }> => {
    try {
      const res = await fetchFn(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [IDEMPOTENCY_HEADER]: payload.id,
        },
        body: rawBody,
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status };
      lastError = `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: lastError };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: lastError };
    }
  };

  let result = await attempt();
  if (result.ok) return result;

  for (const delayMs of retryDelaysMs) {
    await new Promise((r) => setTimeout(r, delayMs));
    result = await attempt();
    if (result.ok) return result;
  }

  return { ok: false, status: lastStatus, error: lastError };
}

export async function deliverRealtimeWebhook(
  store: WebhookSubscriptionStore,
  organizationId: string,
  payload: RealtimeWebhookPayload,
  options: DeliverWebhookOptions = {}
): Promise<{ delivered: number; failed: number; results: { url: string; ok: boolean }[] }> {
  const subscriptions = await store.listSubscriptions(organizationId, payload.type);
  const results: { url: string; ok: boolean }[] = [];
  let delivered = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    const result = await deliverWebhook(sub, payload, options);
    results.push({ url: sub.url, ok: result.ok });
    if (result.ok) delivered++;
    else failed++;
  }

  return { delivered, failed, results };
}
