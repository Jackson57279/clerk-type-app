import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMagicLinkToken,
  verifyMagicLinkToken,
  createMemoryUsedTokenStore,
  createNoOpUsedTokenStore,
  DEFAULT_MAGIC_LINK_TTL_MS,
  getMagicLinkTtlMs,
} from "../src/magic-link.js";

const SECRET = "test-secret-key";

describe("createMagicLinkToken", () => {
  it("returns token, expiresAt, and jti", () => {
    const result = createMagicLinkToken({ email: "u@example.com" }, SECRET);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.jti).toBeDefined();
    expect(result.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("emits JWT format (header.payload.signature) with short expiry", () => {
    const result = createMagicLinkToken({ email: "u@example.com" }, SECRET);
    const [headerB64, payloadB64, sigB64] = result.token.split(".");
    expect(headerB64).toBeDefined();
    expect(payloadB64).toBeDefined();
    expect(sigB64).toBeDefined();
    const payload = verifyMagicLinkToken(result.token, SECRET);
    expect(payload).not.toBeNull();
    const ttlMs = result.expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_MAGIC_LINK_TTL_MS + 1000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_MAGIC_LINK_TTL_MS - 1000);
  });

  it("uses default TTL of 15 minutes", () => {
    const before = Date.now();
    const result = createMagicLinkToken({ email: "u@example.com" }, SECRET);
    const after = Date.now();
    const fifteenMin = 15 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + fifteenMin - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + fifteenMin + 1000);
  });

  it("accepts custom ttlMs", () => {
    const result = createMagicLinkToken(
      { email: "u@example.com" },
      SECRET,
      { ttlMs: 5 * 60 * 1000 }
    );
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(fiveMinFromNow - 2000);
    expect(result.expiresAt).toBeLessThanOrEqual(fiveMinFromNow + 2000);
  });

  it("produces different jti per call", () => {
    const a = createMagicLinkToken({ email: "a@x.com" }, SECRET);
    const b = createMagicLinkToken({ email: "a@x.com" }, SECRET);
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });

  it("includes userId in payload when provided", () => {
    const { token } = createMagicLinkToken(
      { email: "u@x.com", userId: "user-1" },
      SECRET
    );
    const payload = verifyMagicLinkToken(token, SECRET);
    expect(payload?.email).toBe("u@x.com");
    expect(payload?.userId).toBe("user-1");
  });
});

describe("verifyMagicLinkToken", () => {
  it("returns payload when token is valid", () => {
    const { token } = createMagicLinkToken(
      { email: "test@example.com" },
      SECRET
    );
    const payload = verifyMagicLinkToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("test@example.com");
    expect(payload?.jti).toBeDefined();
  });

  it("returns null for wrong secret", () => {
    const { token } = createMagicLinkToken({ email: "e@x.com" }, SECRET);
    expect(verifyMagicLinkToken(token, "wrong-secret")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyMagicLinkToken("not-a-valid-token", SECRET)).toBeNull();
    expect(verifyMagicLinkToken("no-dot", SECRET)).toBeNull();
  });

  it("returns null for two-part token (legacy format)", () => {
    expect(verifyMagicLinkToken("a.b", SECRET)).toBeNull();
  });

  it("single-use: second verify returns null when usedTokenStore provided", () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "once@example.com" },
      SECRET
    );
    const first = verifyMagicLinkToken(token, SECRET, { usedTokenStore: store });
    expect(first).not.toBeNull();
    expect(first?.email).toBe("once@example.com");
    const second = verifyMagicLinkToken(token, SECRET, { usedTokenStore: store });
    expect(second).toBeNull();
  });

  it("token is invalidated after use by default (second verify returns null)", () => {
    const { token } = createMagicLinkToken({ email: "once@x.com" }, SECRET);
    const first = verifyMagicLinkToken(token, SECRET);
    expect(first?.email).toBe("once@x.com");
    const second = verifyMagicLinkToken(token, SECRET);
    expect(second).toBeNull();
  });
});

describe("magic link token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null after TTL has passed", () => {
    const { token } = createMagicLinkToken(
      { email: "exp@x.com" },
      SECRET,
      { ttlMs: 1000 }
    );
    expect(verifyMagicLinkToken(token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyMagicLinkToken(token, SECRET)).toBeNull();
  });

  it("returns payload when still within TTL", () => {
    const { token } = createMagicLinkToken(
      { email: "valid@x.com" },
      SECRET,
      { ttlMs: 10 * 1000 }
    );
    vi.advanceTimersByTime(5000);
    const result = verifyMagicLinkToken(token, SECRET);
    expect(result).not.toBeNull();
    expect(result?.email).toBe("valid@x.com");
  });
});

describe("magic link device binding", () => {
  it("verify succeeds when no fingerprint was stored (optional)", () => {
    const noop = createNoOpUsedTokenStore();
    const { token } = createMagicLinkToken({ email: "u@x.com" }, SECRET);
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop })).not.toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop, deviceFingerprint: null })).not.toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop, deviceFingerprint: "any" })).not.toBeNull();
  });

  it("verify succeeds when token has fingerprint and current fingerprint matches", () => {
    const { token } = createMagicLinkToken(
      { email: "u@x.com", deviceFingerprint: "device-A" },
      SECRET
    );
    const payload = verifyMagicLinkToken(token, SECRET, { deviceFingerprint: "device-A" });
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("u@x.com");
  });

  it("verify succeeds when fingerprint matches after trim", () => {
    const noop = createNoOpUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "u@x.com", deviceFingerprint: " device-A " },
      SECRET
    );
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop, deviceFingerprint: "device-A" })).not.toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop, deviceFingerprint: "  device-A  " })).not.toBeNull();
  });

  it("verify returns null when token has fingerprint but current is missing", () => {
    const { token } = createMagicLinkToken(
      { email: "u@x.com", deviceFingerprint: "device-A" },
      SECRET
    );
    expect(verifyMagicLinkToken(token, SECRET)).toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { deviceFingerprint: null })).toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { deviceFingerprint: undefined })).toBeNull();
  });

  it("verify returns null when token has fingerprint but current does not match", () => {
    const { token } = createMagicLinkToken(
      { email: "u@x.com", deviceFingerprint: "device-A" },
      SECRET
    );
    expect(verifyMagicLinkToken(token, SECRET, { deviceFingerprint: "device-B" })).toBeNull();
  });

  it("create ignores empty string deviceFingerprint (no binding)", () => {
    const noop = createNoOpUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "u@x.com", deviceFingerprint: "" },
      SECRET
    );
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop })).not.toBeNull();
    expect(verifyMagicLinkToken(token, SECRET, { usedTokenStore: noop, deviceFingerprint: null })).not.toBeNull();
  });
});

describe("DEFAULT_MAGIC_LINK_TTL_MS", () => {
  it("is 15 minutes in milliseconds", () => {
    expect(DEFAULT_MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe("getMagicLinkTtlMs", () => {
  const orig = process.env.MAGIC_LINK_TTL_MINUTES;

  afterEach(() => {
    if (orig !== undefined) {
      process.env.MAGIC_LINK_TTL_MINUTES = orig;
    } else {
      delete process.env.MAGIC_LINK_TTL_MINUTES;
    }
  });

  it("returns 15 min default when MAGIC_LINK_TTL_MINUTES is unset", () => {
    delete process.env.MAGIC_LINK_TTL_MINUTES;
    expect(getMagicLinkTtlMs()).toBe(15 * 60 * 1000);
  });

  it("returns 15 min default when MAGIC_LINK_TTL_MINUTES is empty", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "";
    expect(getMagicLinkTtlMs()).toBe(15 * 60 * 1000);
  });

  it("returns configured minutes in ms when valid", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "5";
    expect(getMagicLinkTtlMs()).toBe(5 * 60 * 1000);
    process.env.MAGIC_LINK_TTL_MINUTES = "60";
    expect(getMagicLinkTtlMs()).toBe(60 * 60 * 1000);
    process.env.MAGIC_LINK_TTL_MINUTES = "1440";
    expect(getMagicLinkTtlMs()).toBe(1440 * 60 * 1000);
  });

  it("returns default when value is below 1", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "0";
    expect(getMagicLinkTtlMs()).toBe(DEFAULT_MAGIC_LINK_TTL_MS);
    process.env.MAGIC_LINK_TTL_MINUTES = "-1";
    expect(getMagicLinkTtlMs()).toBe(DEFAULT_MAGIC_LINK_TTL_MS);
  });

  it("returns default when value is above 1440", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "1441";
    expect(getMagicLinkTtlMs()).toBe(DEFAULT_MAGIC_LINK_TTL_MS);
  });

  it("returns default when value is not an integer", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "5.5";
    expect(getMagicLinkTtlMs()).toBe(DEFAULT_MAGIC_LINK_TTL_MS);
    process.env.MAGIC_LINK_TTL_MINUTES = "abc";
    expect(getMagicLinkTtlMs()).toBe(DEFAULT_MAGIC_LINK_TTL_MS);
  });
});

describe("magic link configurable expiration", () => {
  const orig = process.env.MAGIC_LINK_TTL_MINUTES;

  afterEach(() => {
    if (orig !== undefined) {
      process.env.MAGIC_LINK_TTL_MINUTES = orig;
    } else {
      delete process.env.MAGIC_LINK_TTL_MINUTES;
    }
  });

  it("createMagicLinkToken uses env TTL when options.ttlMs not provided", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "7";
    const result = createMagicLinkToken({ email: "u@x.com" }, SECRET);
    const expectedExpiry = 7 * 60 * 1000;
    const ttlMs = result.expiresAt - Date.now();
    expect(ttlMs).toBeGreaterThanOrEqual(expectedExpiry - 2000);
    expect(ttlMs).toBeLessThanOrEqual(expectedExpiry + 2000);
  });

  it("createMagicLinkToken options.ttlMs overrides env", () => {
    process.env.MAGIC_LINK_TTL_MINUTES = "60";
    const result = createMagicLinkToken(
      { email: "u@x.com" },
      SECRET,
      { ttlMs: 2 * 60 * 1000 }
    );
    const ttlMs = result.expiresAt - Date.now();
    expect(ttlMs).toBeGreaterThanOrEqual(2 * 60 * 1000 - 2000);
    expect(ttlMs).toBeLessThanOrEqual(2 * 60 * 1000 + 2000);
  });
});
