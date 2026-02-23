import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  signWebhookPayload,
  deliverWebhook,
  deliverRealtimeWebhook,
  type RealtimeWebhookPayload,
  type WebhookSubscriptionStore,
} from "../src/realtime-webhook.js";

describe("signWebhookPayload", () => {
  const secret = "whsec_test";
  const body = '{"type":"user.created","id":"evt_1","data":{},"timestamp":"2024-01-01T00:00:00Z"}';

  it("produces sha256= prefixed HMAC hex", () => {
    const sig = signWebhookPayload(secret, body);
    expect(sig.startsWith("sha256=")).toBe(true);
    const hex = sig.slice(7);
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    expect(hex).toBe(expected);
  });

  it("differs for different body", () => {
    const sig1 = signWebhookPayload(secret, body);
    const sig2 = signWebhookPayload(secret, body + "x");
    expect(sig1).not.toBe(sig2);
  });

  it("differs for different secret", () => {
    const sig1 = signWebhookPayload(secret, body);
    const sig2 = signWebhookPayload("other", body);
    expect(sig1).not.toBe(sig2);
  });
});

describe("deliverWebhook", () => {
  const payload: RealtimeWebhookPayload = {
    type: "user.created",
    id: "evt_1",
    timestamp: new Date().toISOString(),
    data: { id: "user_123", email: "u@example.com", created_at: new Date().toISOString() },
  };
  const subscription = { url: "https://example.com/webhook", secret: "whsec_abc" };

  it("POSTs JSON with signature and idempotency headers and returns ok on 2xx", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const mockFetch: typeof fetch = async (url, init) => {
      captured = { url: typeof url === "string" ? url : url.toString(), init: init ?? {} };
      return new Response(null, { status: 200 });
    };
    const result = await deliverWebhook(subscription, payload, { fetchFn: mockFetch });
    expect(result.ok).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(subscription.url);
    expect(captured!.init?.method).toBe("POST");
    const headers = (captured!.init?.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-webhook-signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers["x-idempotency-key"]).toBe(payload.id);
    const bodyStr = captured!.init?.body as string;
    expect(JSON.parse(bodyStr)).toEqual(payload);
  });

  it("returns not ok on HTTP 500 and does not retry when retryDelaysMs empty", async () => {
    const mockFetch: typeof fetch = async () => new Response(null, { status: 500 });
    const result = await deliverWebhook(subscription, payload, {
      fetchFn: mockFetch,
      retryDelaysMs: [],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("retries on failure and returns ok if later attempt succeeds", async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls++;
      if (calls < 2) return new Response(null, { status: 503 });
      return new Response(null, { status: 200 });
    };
    const result = await deliverWebhook(subscription, payload, {
      fetchFn: mockFetch,
      retryDelaysMs: [10, 10],
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("returns not ok after all retries exhausted", async () => {
    const mockFetch: typeof fetch = async () => new Response(null, { status: 500 });
    const result = await deliverWebhook(subscription, payload, {
      fetchFn: mockFetch,
      retryDelaysMs: [0, 0],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("returns not ok on network error after retries", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await deliverWebhook(subscription, payload, {
      fetchFn: mockFetch,
      retryDelaysMs: [0],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("deliverRealtimeWebhook", () => {
  const orgId = "org_1";
  const payload: RealtimeWebhookPayload = {
    type: "session.revoked",
    id: "evt_2",
    timestamp: new Date().toISOString(),
    data: { session_id: "sess_1" },
  };

  it("delivers to all subscriptions returned by store", async () => {
    const subs = [
      { url: "https://a.com/wh", secret: "s1" },
      { url: "https://b.com/wh", secret: "s2" },
    ];
    const store: WebhookSubscriptionStore = {
      async listSubscriptions(organizationId, eventType) {
        expect(organizationId).toBe(orgId);
        expect(eventType).toBe("session.revoked");
        return subs;
      },
    };
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(null, { status: 200 });
    };
    const result = await deliverRealtimeWebhook(store, orgId, payload, { fetchFn: mockFetch });
    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(callCount).toBe(2);
  });

  it("reports failed and delivered counts correctly", async () => {
    const subs = [
      { url: "https://ok.com/wh", secret: "s1" },
      { url: "https://fail.com/wh", secret: "s2" },
    ];
    const store: WebhookSubscriptionStore = {
      async listSubscriptions() {
        return subs;
      },
    };
    const mockFetch: typeof fetch = async (url: unknown) => {
      if (String(url).includes("fail")) return new Response(null, { status: 500 });
      return new Response(null, { status: 200 });
    };
    const result = await deliverRealtimeWebhook(store, orgId, payload, {
      fetchFn: mockFetch,
      retryDelaysMs: [],
    });
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.url.includes("ok"))?.ok).toBe(true);
    expect(result.results.find((r) => r.url.includes("fail"))?.ok).toBe(false);
  });

  it("delivers to zero endpoints when store returns empty", async () => {
    const store: WebhookSubscriptionStore = {
      async listSubscriptions() {
        return [];
      },
    };
    const result = await deliverRealtimeWebhook(store, orgId, payload);
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});
