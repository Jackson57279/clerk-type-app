import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEmailVerificationToken,
  verifyEmailVerificationToken,
  createMemoryEmailVerificationStore,
  createNoOpEmailVerificationStore,
  DEFAULT_EMAIL_VERIFICATION_LINK_TTL_MS,
} from "../src/email-verification.js";

const SECRET = "test-secret-key";

const basePayload = {
  userId: "user-1",
  email: "user@example.com",
};

describe("createEmailVerificationToken", () => {
  it("returns token, expiresAt, and jti", () => {
    const result = createEmailVerificationToken(basePayload, SECRET);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.jti).toBeDefined();
    expect(result.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("emits JWT format (header.payload.signature) with short expiry", () => {
    const result = createEmailVerificationToken(basePayload, SECRET);
    const [headerB64, payloadB64, sigB64] = result.token.split(".");
    expect(headerB64).toBeDefined();
    expect(payloadB64).toBeDefined();
    expect(sigB64).toBeDefined();
    const payload = verifyEmailVerificationToken(result.token, SECRET);
    expect(payload).not.toBeNull();
    const ttlMs = result.expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_EMAIL_VERIFICATION_LINK_TTL_MS + 1000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_EMAIL_VERIFICATION_LINK_TTL_MS - 1000);
  });

  it("uses default TTL of 15 minutes", () => {
    const before = Date.now();
    const result = createEmailVerificationToken(basePayload, SECRET);
    const after = Date.now();
    const fifteenMin = 15 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + fifteenMin - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + fifteenMin + 1000);
  });

  it("accepts custom ttlMs", () => {
    const result = createEmailVerificationToken(basePayload, SECRET, {
      ttlMs: 5 * 60 * 1000,
    });
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(fiveMinFromNow - 2000);
    expect(result.expiresAt).toBeLessThanOrEqual(fiveMinFromNow + 2000);
  });

  it("produces different jti per call", () => {
    const a = createEmailVerificationToken(basePayload, SECRET);
    const b = createEmailVerificationToken(basePayload, SECRET);
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyEmailVerificationToken", () => {
  it("returns payload when token is valid", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    const payload = verifyEmailVerificationToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-1");
    expect(payload?.email).toBe("user@example.com");
    expect(payload?.jti).toBeDefined();
  });

  it("returns null for wrong secret", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    expect(verifyEmailVerificationToken(token, "wrong-secret")).toBeNull();
  });

  it("returns null for tampered token", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    const parts = token.split(".");
    const headerB64 = parts[0] ?? "";
    const payloadB64 = parts[1] ?? "";
    const sig = parts[2] ?? "";
    const tamperedPayload =
      payloadB64.slice(0, -1) + (payloadB64.slice(-1) === "a" ? "b" : "a");
    expect(
      verifyEmailVerificationToken(`${headerB64}.${tamperedPayload}.${sig}`, SECRET)
    ).toBeNull();
  });

  it("returns null for malformed token (no dot)", () => {
    expect(verifyEmailVerificationToken("notadot", SECRET)).toBeNull();
  });

  it("returns null for two-part token (legacy format)", () => {
    expect(verifyEmailVerificationToken("a.b", SECRET)).toBeNull();
  });

  it("returns null for invalid base64 payload", () => {
    expect(verifyEmailVerificationToken("!!!.!!!.!!!", SECRET)).toBeNull();
  });
});

describe("email verification token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null after TTL has passed", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET, {
      ttlMs: 1000,
    });
    expect(verifyEmailVerificationToken(token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyEmailVerificationToken(token, SECRET)).toBeNull();
  });

  it("returns payload when still within TTL", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET, {
      ttlMs: 10 * 1000,
    });
    vi.advanceTimersByTime(5000);
    expect(verifyEmailVerificationToken(token, SECRET)).not.toBeNull();
  });
});

describe("single-use tracking", () => {
  it("first verify succeeds, second returns null when store is used", () => {
    const store = createMemoryEmailVerificationStore();
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    const first = verifyEmailVerificationToken(token, SECRET, {
      usedTokenStore: store,
    });
    expect(first).not.toBeNull();
    expect(first?.userId).toBe("user-1");

    const second = verifyEmailVerificationToken(token, SECRET, {
      usedTokenStore: store,
    });
    expect(second).toBeNull();
  });

  it("token is invalidated after use by default (second verify returns null)", () => {
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    expect(verifyEmailVerificationToken(token, SECRET)).not.toBeNull();
    expect(verifyEmailVerificationToken(token, SECRET)).toBeNull();
  });

  it("with no-op store, token can be verified multiple times", () => {
    const noop = createNoOpEmailVerificationStore();
    const { token } = createEmailVerificationToken(basePayload, SECRET);
    expect(
      verifyEmailVerificationToken(token, SECRET, { usedTokenStore: noop })
    ).not.toBeNull();
    expect(
      verifyEmailVerificationToken(token, SECRET, { usedTokenStore: noop })
    ).not.toBeNull();
  });

  it("different tokens are independent with same store", () => {
    const store = createMemoryEmailVerificationStore();
    const a = createEmailVerificationToken(
      { userId: "u1", email: "a@x.com" },
      SECRET
    );
    const b = createEmailVerificationToken(
      { userId: "u2", email: "b@x.com" },
      SECRET
    );

    expect(
      verifyEmailVerificationToken(a.token, SECRET, { usedTokenStore: store })
    ).not.toBeNull();
    expect(
      verifyEmailVerificationToken(b.token, SECRET, { usedTokenStore: store })
    ).not.toBeNull();
    expect(
      verifyEmailVerificationToken(a.token, SECRET, { usedTokenStore: store })
    ).toBeNull();
    expect(
      verifyEmailVerificationToken(b.token, SECRET, { usedTokenStore: store })
    ).toBeNull();
  });
});
