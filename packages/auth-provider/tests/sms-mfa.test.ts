import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMemoryUserMfaPhoneStore,
  createMemorySmsMfaChallengeStore,
  hasSmsMfa,
  sendLoginSmsOtp,
  verifyLoginSmsOtp,
  maskPhone,
} from "../src/sms-mfa.js";
import type { SmsSender } from "../src/sms-otp.js";

function capturingSender(): SmsSender & { lastBody: string; lastPhone: string } {
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

describe("maskPhone", () => {
  it("masks to last 4 digits", () => {
    expect(maskPhone("+15551234567")).toBe("*******4567");
  });

  it("returns **** for short input", () => {
    expect(maskPhone("123")).toBe("****");
  });
});

describe("hasSmsMfa", () => {
  it("returns false when user has no phone", async () => {
    const store = createMemoryUserMfaPhoneStore();
    expect(await hasSmsMfa("user-1", store)).toBe(false);
  });

  it("returns true when user has phone set", async () => {
    const store = createMemoryUserMfaPhoneStore();
    await store.set("user-1", "+15551234567");
    expect(await hasSmsMfa("user-1", store)).toBe(true);
  });

  it("returns false after phone deleted", async () => {
    const store = createMemoryUserMfaPhoneStore();
    await store.set("user-1", "+15551234567");
    await store.delete("user-1");
    expect(await hasSmsMfa("user-1", store)).toBe(false);
  });
});

describe("sendLoginSmsOtp", () => {
  it("returns success: false when user has no MFA phone", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    const result = await sendLoginSmsOtp("user-no-phone", {
      phoneStore,
      challengeStore,
      sender,
    });
    expect(result.success).toBe(false);
  });

  it("sends OTP and stores challenge", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("user-1", "+15551234567");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    const result = await sendLoginSmsOtp("user-1", {
      phoneStore,
      challengeStore,
      sender,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    expect(result.phoneMasked).toBe("*******4567");
    expect(sender.lastPhone).toBe("+15551234567");
    const code = /Code: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(code).toBeDefined();
    const ok = await verifyLoginSmsOtp("user-1", code!, { challengeStore });
    expect(ok).toBe(true);
  });

  it("rate limits to 3 per hour per user", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("u1", "+15551111111");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    await sendLoginSmsOtp("u1", {
      phoneStore,
      challengeStore,
      sender,
      rateLimitKey: "u1",
    });
    await sendLoginSmsOtp("u1", {
      phoneStore,
      challengeStore,
      sender,
      rateLimitKey: "u1",
    });
    await sendLoginSmsOtp("u1", {
      phoneStore,
      challengeStore,
      sender,
      rateLimitKey: "u1",
    });
    const fourth = await sendLoginSmsOtp("u1", {
      phoneStore,
      challengeStore,
      sender,
      rateLimitKey: "u1",
    });
    expect(fourth.success).toBe(false);
    expect(fourth.retryAfterSeconds).toBeDefined();
  });

  it("uses fallback sender when primary fails", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("u-fallback", "+15552222222");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const fallback = capturingSender();
    const failingSender: SmsSender = {
      send: async () => {
        throw new Error("Provider down");
      },
    };
    const result = await sendLoginSmsOtp("u-fallback", {
      phoneStore,
      challengeStore,
      sender: failingSender,
      fallbackSender: fallback,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    const code = /Code: (\d{6})/.exec(fallback.lastBody)?.[1];
    expect(await verifyLoginSmsOtp("u-fallback", code!, { challengeStore })).toBe(
      true
    );
  });
});

describe("verifyLoginSmsOtp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for correct code and consumes challenge", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("u-consume", "+15553333333");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    await sendLoginSmsOtp("u-consume", {
      phoneStore,
      challengeStore,
      sender,
      template: "{{code}}",
    });
    const code = sender.lastBody;
    expect(await verifyLoginSmsOtp("u-consume", code, { challengeStore })).toBe(true);
    expect(await verifyLoginSmsOtp("u-consume", code, { challengeStore })).toBe(false);
  });

  it("returns false for wrong code", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("u-wrong", "+15554444444");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    await sendLoginSmsOtp("u-wrong", {
      phoneStore,
      challengeStore,
      sender,
      template: "{{code}}",
    });
    expect(
      await verifyLoginSmsOtp("u-wrong", "000000", { challengeStore })
    ).toBe(false);
  });

  it("returns false for unknown user", async () => {
    const challengeStore = createMemorySmsMfaChallengeStore();
    expect(
      await verifyLoginSmsOtp("unknown", "123456", { challengeStore })
    ).toBe(false);
  });

  it("returns false after expiry", async () => {
    const phoneStore = createMemoryUserMfaPhoneStore();
    await phoneStore.set("u-expiry", "+15557777777");
    const challengeStore = createMemorySmsMfaChallengeStore();
    const sender = capturingSender();
    await sendLoginSmsOtp("u-expiry", {
      phoneStore,
      challengeStore,
      sender,
      template: "{{code}}",
      ttlMs: 10 * 60 * 1000,
    });
    const code = sender.lastBody;
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(await verifyLoginSmsOtp("u-expiry", code, { challengeStore })).toBe(
      false
    );
  });
});
