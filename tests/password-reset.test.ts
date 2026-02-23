import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  createMemoryUsedTokenStore,
} from "../src/password-reset.js";

const SECRET = "test-secret-key";

describe("createPasswordResetToken", () => {
  it("returns token, expiresAt, and jti", () => {
    const result = createPasswordResetToken(
      { userId: "u1", email: "u@example.com" },
      SECRET
    );
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.token).toContain(".");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.jti).toBeDefined();
    expect(result.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("uses default TTL of 1 hour", () => {
    const before = Date.now();
    const result = createPasswordResetToken(
      { userId: "u1", email: "u@example.com" },
      SECRET
    );
    const after = Date.now();
    const oneHour = 60 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + oneHour - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + oneHour + 1000);
  });

  it("accepts custom ttlMs", () => {
    const result = createPasswordResetToken(
      { userId: "u1", email: "u@example.com" },
      SECRET,
      { ttlMs: 5 * 60 * 1000 }
    );
    const fiveHoursFromNow = Date.now() + 5 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(fiveHoursFromNow - 2000);
    expect(result.expiresAt).toBeLessThanOrEqual(fiveHoursFromNow + 2000);
  });

  it("produces different jti per call", () => {
    const a = createPasswordResetToken(
      { userId: "u1", email: "a@x.com" },
      SECRET
    );
    const b = createPasswordResetToken(
      { userId: "u1", email: "a@x.com" },
      SECRET
    );
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyPasswordResetToken", () => {
  it("returns payload when token is valid", () => {
    const { token } = createPasswordResetToken(
      { userId: "user-123", email: "test@example.com" },
      SECRET
    );
    const payload = verifyPasswordResetToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-123");
    expect(payload?.email).toBe("test@example.com");
    expect(payload?.jti).toBeDefined();
  });

  it("returns null for wrong secret", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET
    );
    expect(verifyPasswordResetToken(token, "wrong-secret")).toBeNull();
  });

  it("returns null for tampered token", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET
    );
    const parts = token.split(".");
    const payloadB64 = parts[0] ?? "";
    const sig = parts[1] ?? "";
    const tamperedPayload =
      payloadB64.slice(0, -1) + (payloadB64.slice(-1) === "a" ? "b" : "a");
    expect(
      verifyPasswordResetToken(`${tamperedPayload}.${sig}`, SECRET)
    ).toBeNull();
  });

  it("returns null for malformed token (no dot)", () => {
    expect(verifyPasswordResetToken("notadot", SECRET)).toBeNull();
  });

  it("returns null for invalid base64 payload", () => {
    expect(verifyPasswordResetToken("!!!.!!!", SECRET)).toBeNull();
  });
});

describe("password reset token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null after TTL has passed", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET,
      { ttlMs: 1000 }
    );
    expect(verifyPasswordResetToken(token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(verifyPasswordResetToken(token, SECRET)).toBeNull();
  });

  it("returns payload when still within TTL", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET,
      { ttlMs: 10 * 1000 }
    );
    vi.advanceTimersByTime(5000);
    expect(verifyPasswordResetToken(token, SECRET)).not.toBeNull();
  });
});

describe("single-use tracking (jti)", () => {
  it("same token yields same jti so app can enforce single-use", () => {
    const { token, jti } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET
    );
    const verified = verifyPasswordResetToken(token, SECRET);
    expect(verified?.jti).toBe(jti);
  });
});

describe("single-use: token invalidated after use", () => {
  it("first verify succeeds, second verify returns null when store is used", () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET
    );
    const first = verifyPasswordResetToken(token, SECRET, { usedTokenStore: store });
    expect(first).not.toBeNull();
    expect(first?.userId).toBe("u1");

    const second = verifyPasswordResetToken(token, SECRET, { usedTokenStore: store });
    expect(second).toBeNull();
  });

  it("without store, token can be verified multiple times (backward compatible)", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "e@x.com" },
      SECRET
    );
    expect(verifyPasswordResetToken(token, SECRET)).not.toBeNull();
    expect(verifyPasswordResetToken(token, SECRET)).not.toBeNull();
  });

  it("different tokens are independent with same store", () => {
    const store = createMemoryUsedTokenStore();
    const a = createPasswordResetToken({ userId: "u1", email: "a@x.com" }, SECRET);
    const b = createPasswordResetToken({ userId: "u2", email: "b@x.com" }, SECRET);

    expect(verifyPasswordResetToken(a.token, SECRET, { usedTokenStore: store })).not.toBeNull();
    expect(verifyPasswordResetToken(b.token, SECRET, { usedTokenStore: store })).not.toBeNull();
    expect(verifyPasswordResetToken(a.token, SECRET, { usedTokenStore: store })).toBeNull();
    expect(verifyPasswordResetToken(b.token, SECRET, { usedTokenStore: store })).toBeNull();
  });
});
