import { randomUUID } from "node:crypto";
import type { RealtimeWebhookPayload } from "./realtime-webhook.js";
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
