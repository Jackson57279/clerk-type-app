import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSmsOtpCode,
  sendSmsOtp,
  verifySmsOtp,
  createMemorySmsOtpStore,
  createTwilioSender,
  type SmsOtpStore,
  type SmsSender,
} from "../src/sms-otp.js";

function memoryStore(): SmsOtpStore {
  const map = new Map<string, { codeHash: string; expiresAt: number }>();
  return {
    async set(phone: string, codeHash: string, expiresAt: number) {
      map.set(phone, { codeHash, expiresAt });
    },
    async get(phone: string) {
      return map.get(phone) ?? null;
    },
    async delete(phone: string) {
      map.delete(phone);
    },
  };
}

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

describe("generateSmsOtpCode", () => {
  it("returns 6-digit string by default", () => {
    const code = generateSmsOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("returns custom digits when specified", () => {
    const code = generateSmsOtpCode(8);
    expect(code).toMatch(/^\d{8}$/);
  });
});

describe("createTwilioSender", () => {
  const orig = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  };
  afterEach(() => {
    process.env.TWILIO_ACCOUNT_SID = orig.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = orig.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_PHONE_NUMBER = orig.TWILIO_PHONE_NUMBER;
  });

  it("throws when TWILIO_ACCOUNT_SID is missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_PHONE_NUMBER = "+15551234567";
    const sender = createTwilioSender();
    await expect(sender.send("+15551234567", "test")).rejects.toThrow(
      "TWILIO_ACCOUNT_SID"
    );
  });

  it("throws when TWILIO_AUTH_TOKEN is missing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "sid";
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_PHONE_NUMBER = "+15551234567";
    const sender = createTwilioSender();
    await expect(sender.send("+15551234567", "test")).rejects.toThrow(
      "TWILIO_AUTH_TOKEN"
    );
  });

  it("throws when TWILIO_PHONE_NUMBER is missing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "sid";
    process.env.TWILIO_AUTH_TOKEN = "token";
    delete process.env.TWILIO_PHONE_NUMBER;
    const sender = createTwilioSender();
    await expect(sender.send("+15551234567", "test")).rejects.toThrow(
      "TWILIO_PHONE_NUMBER"
    );
  });
});

describe("createMemorySmsOtpStore", () => {
  it("returns a store that persists OTP for verification", async () => {
    const store = createMemorySmsOtpStore();
    const sender = capturingSender();
    const phone = "+15551234000";
    await sendSmsOtp(phone, { store, sender, template: "Code: {{code}}" });
    const code = /Code: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(code).toBeDefined();
    expect(await verifySmsOtp(phone, code!, { store })).toBe(true);
  });
});

describe("sendSmsOtp", () => {
  it("sends OTP and stores for verification", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15551234567";
    const result = await sendSmsOtp(phone, {
      store,
      sender,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    expect(sender.lastPhone).toBe(phone);
    const code = /Code: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(code).toBeDefined();
    const ok = await verifySmsOtp(phone, code!, { store });
    expect(ok).toBe(true);
  });

  it("uses custom template", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    await sendSmsOtp("+15559999999", {
      store,
      sender,
      template: "Your code is {{code}}. Thanks!",
    });
    expect(sender.lastBody).toMatch(/^Your code is \d{6}\. Thanks!$/);
  });

  it("uses default template when template not provided", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    await sendSmsOtp("+15559999998", { store, sender });
    expect(sender.lastBody).toMatch(
      /^Your verification code is \d{6}\. Valid for 10 minutes\.$/
    );
  });

  it("rate limits to 3 per hour per phone", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15551111111";
    const key = phone;
    await sendSmsOtp(phone, { store, sender, rateLimitKey: key });
    await sendSmsOtp(phone, { store, sender, rateLimitKey: key });
    await sendSmsOtp(phone, { store, sender, rateLimitKey: key });
    const fourth = await sendSmsOtp(phone, {
      store,
      sender,
      rateLimitKey: key,
    });
    expect(fourth.success).toBe(false);
    expect(fourth.retryAfterSeconds).toBeDefined();
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rate limits by phone when rateLimitKey not provided", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15551111112";
    await sendSmsOtp(phone, { store, sender });
    await sendSmsOtp(phone, { store, sender });
    await sendSmsOtp(phone, { store, sender });
    const fourth = await sendSmsOtp(phone, { store, sender });
    expect(fourth.success).toBe(false);
    expect(fourth.retryAfterSeconds).toBeDefined();
  });

  it("allows different phones independently", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    await sendSmsOtp("+15552222221", { store, sender });
    await sendSmsOtp("+15552222222", { store, sender });
    await sendSmsOtp("+15552222223", { store, sender });
    const result = await sendSmsOtp("+15552222224", { store, sender });
    expect(result.success).toBe(true);
  });

  it("throws when sender is missing", async () => {
    const store = memoryStore();
    await expect(
      sendSmsOtp("+15550000000", { store })
    ).rejects.toThrow("SMS sender is required");
  });

  it("uses fallback sender when primary fails", async () => {
    const store = memoryStore();
    const fallback = capturingSender();
    const failingSender: SmsSender = {
      send: async () => {
        throw new Error("Provider down");
      },
    };
    const phone = "+15558888001";
    const result = await sendSmsOtp(phone, {
      store,
      sender: failingSender,
      fallbackSender: fallback,
      template: "Code: {{code}}",
    });
    expect(result.success).toBe(true);
    expect(fallback.lastPhone).toBe(phone);
    const code = /Code: (\d{6})/.exec(fallback.lastBody)?.[1];
    expect(code).toBeDefined();
    expect(await verifySmsOtp(phone, code!, { store })).toBe(true);
  });
});

describe("verifySmsOtp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for correct code and consumes OTP", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15553333333";
    await sendSmsOtp(phone, { store, sender, template: "{{code}}" });
    const code = sender.lastBody;
    expect(await verifySmsOtp(phone, code, { store })).toBe(true);
    expect(await verifySmsOtp(phone, code, { store })).toBe(false);
  });

  it("returns false for wrong code", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15554444444";
    await sendSmsOtp(phone, { store, sender, template: "{{code}}" });
    expect(await verifySmsOtp(phone, "000000", { store })).toBe(false);
  });

  it("returns false for unknown phone", async () => {
    const store = memoryStore();
    expect(await verifySmsOtp("+15556666666", "123456", { store })).toBe(
      false
    );
  });

  it("returns false for empty code", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15550000001";
    await sendSmsOtp(phone, { store, sender, template: "{{code}}" });
    expect(await verifySmsOtp(phone, "", { store })).toBe(false);
  });

  it("returns false after expiry", async () => {
    const store = memoryStore();
    const sender = capturingSender();
    const phone = "+15557777777";
    await sendSmsOtp(phone, {
      store,
      sender,
      template: "{{code}}",
      ttlMs: 10 * 60 * 1000,
    });
    const code = sender.lastBody;
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(await verifySmsOtp(phone, code, { store })).toBe(false);
  });
});
