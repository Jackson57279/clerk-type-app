import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendPhoneVerificationCode,
  verifyPhoneVerificationCode,
  createMemoryPhoneVerificationStore,
  createDeleteAllPhoneVerificationForUser,
} from "../src/phone-verification.js";
import type { SmsSender } from "../src/sms-otp.js";

function capturingSender(): SmsSender & {
  lastBody: string;
  lastPhone: string;
} {
  let lastPhone = "";
  let lastBody = "";
  return {
    async send(phone: string, body: string) {
      lastPhone = phone;
      lastBody = body;
    },
    get lastPhone() {
      return lastPhone;
    },
    get lastBody() {
      return lastBody;
    },
  };
}

describe("sendPhoneVerificationCode", () => {
  it("sends code and stores for verification keyed by userId and phone", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "user-1";
    const phone = "+15551234567";
    const result = await sendPhoneVerificationCode(userId, phone, {
      store,
      sender,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    expect(sender.lastPhone).toBe(phone);
    const code = /Code: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(code).toBeDefined();
    const ok = await verifyPhoneVerificationCode(userId, phone, code!, {
      store,
    });
    expect(ok).toBe(true);
  });

  it("same phone for different users has independent codes", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const phone = "+15559999999";
    await sendPhoneVerificationCode("user-a", phone, {
      store,
      sender,
      template: "A: {{code}}",
    });
    const codeA = /A: (\d{6})/.exec(sender.lastBody)?.[1];
    await sendPhoneVerificationCode("user-b", phone, {
      store,
      sender,
      template: "B: {{code}}",
    });
    const codeB = /B: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(await verifyPhoneVerificationCode("user-a", phone, codeA!, { store })).toBe(true);
    expect(await verifyPhoneVerificationCode("user-b", phone, codeB!, { store })).toBe(true);
    expect(await verifyPhoneVerificationCode("user-a", phone, codeB!, { store })).toBe(false);
    expect(await verifyPhoneVerificationCode("user-b", phone, codeA!, { store })).toBe(false);
  });

  it("uses custom template", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    await sendPhoneVerificationCode("u1", "+15550001111", {
      store,
      sender,
      template: "Verify: {{code}}. Thanks!",
    });
    expect(sender.lastBody).toMatch(/^Verify: \d{6}\. Thanks!$/);
  });

  it("rate limits by verification key (userId:phone) by default", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "user-1";
    const phone = "+15551111111";
    await sendPhoneVerificationCode(userId, phone, { store, sender });
    await sendPhoneVerificationCode(userId, phone, { store, sender });
    await sendPhoneVerificationCode(userId, phone, { store, sender });
    const fourth = await sendPhoneVerificationCode(userId, phone, {
      store,
      sender,
    });
    expect(fourth.success).toBe(false);
    expect(fourth.retryAfterSeconds).toBeDefined();
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows different userId+phone pairs independently", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    await sendPhoneVerificationCode("u1", "+15552222221", { store, sender });
    await sendPhoneVerificationCode("u1", "+15552222222", { store, sender });
    await sendPhoneVerificationCode("u2", "+15552222221", { store, sender });
    const result = await sendPhoneVerificationCode("u2", "+15552222222", {
      store,
      sender,
    });
    expect(result.success).toBe(true);
  });

  it("throws when sender is missing", async () => {
    const store = createMemoryPhoneVerificationStore();
    await expect(
      sendPhoneVerificationCode("u1", "+15550000000", { store })
    ).rejects.toThrow("SMS sender is required");
  });

  it("uses fallback sender when primary fails", async () => {
    const store = createMemoryPhoneVerificationStore();
    const fallback = capturingSender();
    const failingSender: SmsSender = {
      send: async () => {
        throw new Error("Provider down");
      },
    };
    const userId = "u1";
    const phone = "+15558888001";
    const result = await sendPhoneVerificationCode(userId, phone, {
      store,
      sender: failingSender,
      fallbackSender: fallback,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    expect(fallback.lastPhone).toBe(phone);
    const code = /Code: (\d{6})/.exec(fallback.lastBody)?.[1];
    expect(code).toBeDefined();
    expect(
      await verifyPhoneVerificationCode(userId, phone, code!, { store })
    ).toBe(true);
  });
});

describe("verifyPhoneVerificationCode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for correct code and consumes code", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "u1";
    const phone = "+15553333333";
    await sendPhoneVerificationCode(userId, phone, {
      store,
      sender,
      template: "{{code}}",
    });
    const code = sender.lastBody;
    expect(
      await verifyPhoneVerificationCode(userId, phone, code, { store })
    ).toBe(true);
    expect(
      await verifyPhoneVerificationCode(userId, phone, code, { store })
    ).toBe(false);
  });

  it("returns false for wrong code", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "u1";
    const phone = "+15554444444";
    await sendPhoneVerificationCode(userId, phone, {
      store,
      sender,
      template: "{{code}}",
    });
    expect(
      await verifyPhoneVerificationCode(userId, phone, "000000", { store })
    ).toBe(false);
  });

  it("returns false for wrong userId", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const phone = "+15556666666";
    await sendPhoneVerificationCode("user-a", phone, {
      store,
      sender,
      template: "{{code}}",
    });
    const code = sender.lastBody;
    expect(
      await verifyPhoneVerificationCode("user-b", phone, code, { store })
    ).toBe(false);
    expect(
      await verifyPhoneVerificationCode("user-a", phone, code, { store })
    ).toBe(true);
  });

  it("returns false for unknown userId and phone", async () => {
    const store = createMemoryPhoneVerificationStore();
    expect(
      await verifyPhoneVerificationCode("u1", "+15557777777", "123456", {
        store,
      })
    ).toBe(false);
  });

  it("returns false after expiry", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "u1";
    const phone = "+15558888888";
    await sendPhoneVerificationCode(userId, phone, {
      store,
      sender,
      template: "{{code}}",
      ttlMs: 10 * 60 * 1000,
    });
    const code = sender.lastBody;
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(
      await verifyPhoneVerificationCode(userId, phone, code, { store })
    ).toBe(false);
  });
});

describe("deleteAllForUser", () => {
  it("removes all pending verifications for the user", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    const userId = "user-gdpr";
    await sendPhoneVerificationCode(userId, "+15550000001", {
      store,
      sender,
      template: "{{code}}",
    });
    const code1 = sender.lastBody;
    await sendPhoneVerificationCode(userId, "+15550000002", {
      store,
      sender,
      template: "{{code}}",
    });
    await store.deleteAllForUser(userId);
    expect(
      await verifyPhoneVerificationCode(userId, "+15550000001", code1, {
        store,
      })
    ).toBe(false);
  });

  it("leaves other users pending verifications intact", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    await sendPhoneVerificationCode("user-a", "+15551111111", {
      store,
      sender,
      template: "{{code}}",
    });
    const codeA = sender.lastBody;
    await sendPhoneVerificationCode("user-b", "+15552222222", {
      store,
      sender,
      template: "{{code}}",
    });
    const codeB = sender.lastBody;
    await store.deleteAllForUser("user-a");
    expect(
      await verifyPhoneVerificationCode("user-b", "+15552222222", codeB, {
        store,
      })
    ).toBe(true);
    expect(
      await verifyPhoneVerificationCode("user-a", "+15551111111", codeA, {
        store,
      })
    ).toBe(false);
  });
});

describe("createDeleteAllPhoneVerificationForUser", () => {
  it("returns a function that calls store.deleteAllForUser", async () => {
    const store = createMemoryPhoneVerificationStore();
    const sender = capturingSender();
    await sendPhoneVerificationCode("u1", "+15559999999", {
      store,
      sender,
      template: "{{code}}",
    });
    const deleteAll = createDeleteAllPhoneVerificationForUser(store);
    await deleteAll("u1");
    expect(
      await verifyPhoneVerificationCode("u1", "+15559999999", sender.lastBody, {
        store,
      })
    ).toBe(false);
  });
});
