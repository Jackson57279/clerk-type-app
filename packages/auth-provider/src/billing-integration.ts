import { randomUUID } from "node:crypto";
import {
  deliverRealtimeWebhook,
  type DeliverWebhookOptions,
  type RealtimeWebhookPayload,
  type WebhookSubscriptionStore,
} from "./realtime-webhook.js";
import {
  getBillingSeatPayloads,
  type BillingSeatPayload,
  type OrganizationMembershipsInput,
} from "./seat-management.js";

export type { BillingSeatPayload, OrganizationMembershipsInput };
export { getBillingSeatPayloads };

export interface BillingReporter {
  reportSeatUsage(payloads: BillingSeatPayload[]): Promise<void>;
}

export function createSeatUsageWebhookPayload(
  payload: BillingSeatPayload,
  id: string = randomUUID()
): RealtimeWebhookPayload {
  const now = new Date().toISOString();
  return {
    type: "billing.seat_usage",
    id,
    timestamp: now,
    data: {
      organizationId: payload.organizationId,
      seatCount: payload.seatCount,
      at: payload.at,
    },
  };
}

export function createSeatUsageWebhookPayloads(
  organizations: OrganizationMembershipsInput[],
  at: Date = new Date()
): RealtimeWebhookPayload[] {
  const payloads = getBillingSeatPayloads(organizations, at);
  return payloads.map((p) => createSeatUsageWebhookPayload(p));
}

export interface DeliverSeatUsageWebhooksParams {
  organizations: OrganizationMembershipsInput[];
  webhookStore: WebhookSubscriptionStore;
  at?: Date;
  webhookDeliveryOptions?: DeliverWebhookOptions;
}

export interface DeliverSeatUsageWebhooksResult {
  payloadsCreated: number;
  byOrganization: {
    organizationId: string;
    delivered: number;
    failed: number;
    results: { url: string; ok: boolean }[];
  }[];
}

export async function deliverSeatUsageWebhooks(
  params: DeliverSeatUsageWebhooksParams
): Promise<DeliverSeatUsageWebhooksResult> {
  const {
    organizations,
    webhookStore,
    at = new Date(),
    webhookDeliveryOptions,
  } = params;
  const payloads = createSeatUsageWebhookPayloads(organizations, at);
  const byOrganization: DeliverSeatUsageWebhooksResult["byOrganization"] = [];
  for (const payload of payloads) {
    const orgId = (payload.data as { organizationId: string }).organizationId;
    const result = await deliverRealtimeWebhook(
      webhookStore,
      orgId,
      payload,
      webhookDeliveryOptions
    );
    byOrganization.push({ organizationId: orgId, ...result });
  }
  return {
    payloadsCreated: payloads.length,
    byOrganization,
  };
}
