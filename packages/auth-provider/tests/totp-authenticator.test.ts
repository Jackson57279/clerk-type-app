import { describe, it, expect, beforeEach } from "vitest";
import { decode as base32Decode } from "hi-base32";
import {
  generateTotpSecret,
  buildOtpauthUri,
  generateTotpQrDataUrl,
  startTotpSetup,
  confirmTotpSetup,
  verifyTotpChallenge,
  disableTotp,
  hasTotp,
  createMemoryTotpStore,
} from "../src/totp-authenticator.js";
import { generateTOTP } from "../src/totp.js";

function secretToBuffer(secretBase32: string): Buffer {
  return Buffer.from(base32Decode.asBytes(secretBase32));
}

describe("generateTotpSecret", () => {
  it("returns a base32 string without padding", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret).not.toContain("=");
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("returns different secrets each call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });
});

describe("buildOtpauthUri", () => {
  it("includes issuer, account, secret and algorithm for authenticator apps", () => {
    const uri = buildOtpauthUri("MyApp", "user@example.com", "JBSWY3DPEHPK3PXP");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=MyApp");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("period=30");
    expect(uri).toContain("digits=6");
  });

  it("encodes special characters in label", () => {
    const uri = buildOtpauthUri("App:Test", "user@example.com", "SECRET");
    expect(uri).toContain("otpauth://totp/");
  });
});

describe("generateTotpQrDataUrl", () => {
  it("returns a data URL for a PNG image", async () => {
    const url = await generateTotpQrDataUrl("otpauth://totp/Test:user?secret=ABC");
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("TOTP authenticator flow", () => {
  const store = createMemoryTotpStore();
  const userId = "user-1";
  const issuer = "TestApp";
  const accountName = "user@test.com";

  beforeEach(async () => {
    await store.set(userId, { secret: null, enabled: false, pendingSecret: null });
  });

  describe("startTotpSetup", () => {
    it("returns secret, otpauthUri and qrDataUrl and stores pending secret", async () => {
      const result = await startTotpSetup(userId, issuer, accountName, store);
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUri).toContain(result.secret);
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      const data = await store.get(userId);
      expect(data.pendingSecret).toBe(result.secret);
      expect(data.secret).toBeNull();
      expect(data.enabled).toBe(false);
    });

    it("throws if TOTP already enabled", async () => {
      await store.set(userId, { secret: "EXISTING", enabled: true, pendingSecret: null });
      await expect(
        startTotpSetup(userId, issuer, accountName, store)
      ).rejects.toThrow("TOTP already enabled");
    });
  });

  describe("confirmTotpSetup", () => {
    it("returns false when no pending secret", async () => {
      const ok = await confirmTotpSetup(userId, "123456", store);
      expect(ok).toBe(false);
    });

    it("returns false when code is invalid", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      const badCode = "000000";
      const ok = await confirmTotpSetup(userId, badCode, store);
      expect(ok).toBe(false);
      const data = await store.get(userId);
      expect(data.pendingSecret).toBe(secret);
      expect(data.enabled).toBe(false);
    });

    it("verifies code and enables TOTP, clears pending", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
      const ok = await confirmTotpSetup(userId, code, store);
      expect(ok).toBe(true);
      const data = await store.get(userId);
      expect(data.secret).toBe(secret);
      expect(data.enabled).toBe(true);
      expect(data.pendingSecret).toBeNull();
    });
  });

  describe("verifyTotpChallenge", () => {
    it("returns false when TOTP not enabled", async () => {
      const ok = await verifyTotpChallenge(userId, "123456", store);
      expect(ok).toBe(false);
    });

    it("returns true for valid code after setup", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
      await confirmTotpSetup(userId, code, store);
      const nextCode = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
      const ok = await verifyTotpChallenge(userId, nextCode, store);
      expect(ok).toBe(true);
    });

    it("returns false for wrong code", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      await confirmTotpSetup(userId, generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 }), store);
      const ok = await verifyTotpChallenge(userId, "000000", store);
      expect(ok).toBe(false);
    });
  });

  describe("disableTotp", () => {
    it("returns false when TOTP not enabled", async () => {
      const ok = await disableTotp(userId, "123456", store);
      expect(ok).toBe(false);
    });

    it("returns false when code is wrong", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      await confirmTotpSetup(userId, generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 }), store);
      const ok = await disableTotp(userId, "000000", store);
      expect(ok).toBe(false);
      expect(await hasTotp(userId, store)).toBe(true);
    });

    it("disables TOTP and clears secret when code is valid", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      await confirmTotpSetup(userId, generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 }), store);
      const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
      const ok = await disableTotp(userId, code, store);
      expect(ok).toBe(true);
      const data = await store.get(userId);
      expect(data.secret).toBeNull();
      expect(data.enabled).toBe(false);
      expect(await hasTotp(userId, store)).toBe(false);
    });
  });

  describe("hasTotp", () => {
    it("returns false when no secret or not enabled", async () => {
      expect(await hasTotp(userId, store)).toBe(false);
      await store.set(userId, { secret: "X", enabled: false, pendingSecret: null });
      expect(await hasTotp(userId, store)).toBe(false);
    });

    it("returns true when secret and enabled", async () => {
      const { secret } = await startTotpSetup(userId, issuer, accountName, store);
      await confirmTotpSetup(userId, generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 }), store);
      expect(await hasTotp(userId, store)).toBe(true);
    });
  });
});

describe("createMemoryTotpStore", () => {
  it("returns empty data for unknown user", async () => {
    const store = createMemoryTotpStore();
    const data = await store.get("unknown");
    expect(data).toEqual({
      secret: null,
      enabled: false,
      pendingSecret: null,
    });
  });

  it("persists and overwrites fields with set", async () => {
    const store = createMemoryTotpStore();
    await store.set("u1", { pendingSecret: "PEND" });
    expect((await store.get("u1")).pendingSecret).toBe("PEND");
    await store.set("u1", { secret: "S", enabled: true });
    const data = await store.get("u1");
    expect(data.secret).toBe("S");
    expect(data.enabled).toBe(true);
    expect(data.pendingSecret).toBe("PEND");
    await store.set("u1", { pendingSecret: null });
    expect((await store.get("u1")).pendingSecret).toBeNull();
  });
});
