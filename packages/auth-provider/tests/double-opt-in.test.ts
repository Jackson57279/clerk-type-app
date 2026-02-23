import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createConfirmationToken,
  verifyConfirmationToken,
  createMemoryConfirmationStore,
  createNoOpConfirmationStore,
  isSensitiveOperation,
  requireConfirmationForSensitiveOperation,
  assertConfirmationForSensitiveOperation,
  ConfirmationRequiredError,
  SENSITIVE_OPERATIONS,
  DEFAULT_CONFIRMATION_LINK_TTL_MS,
  type SensitiveOperationType,
} from "../src/double-opt-in.js";

const SECRET = "test-secret-key";

const basePayload = {
  userId: "user-1",
  email: "user@example.com",
  operation: "change_email" as SensitiveOperationType,
  operationParams: { newEmail: "new@example.com" },
};

describe("createConfirmationToken", () => {
  it("returns token, expiresAt, and jti", () => {
    const result = createConfirmationToken(basePayload, SECRET);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.jti).toBeDefined();
    expect(result.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("emits JWT format (header.payload.signature) with short expiry", () => {
    const result = createConfirmationToken(basePayload, SECRET);
    const [headerB64, payloadB64, sigB64] = result.token.split(".");
    expect(headerB64).toBeDefined();
    expect(payloadB64).toBeDefined();
    expect(sigB64).toBeDefined();
    const payload = verifyConfirmationToken(result.token, SECRET);
    expect(payload).not.toBeNull();
    const ttlMs = result.expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_CONFIRMATION_LINK_TTL_MS + 1000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_CONFIRMATION_LINK_TTL_MS - 1000);
  });

  it("uses default TTL of 15 minutes", () => {
    const before = Date.now();
    const result = createConfirmationToken(basePayload, SECRET);
    const after = Date.now();
    const fifteenMin = 15 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + fifteenMin - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + fifteenMin + 1000);
  });

  it("accepts custom ttlMs", () => {
    const result = createConfirmationToken(basePayload, SECRET, {
      ttlMs: 5 * 60 * 1000,
    });
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(fiveMinFromNow - 2000);
    expect(result.expiresAt).toBeLessThanOrEqual(fiveMinFromNow + 2000);
  });

  it("produces different jti per call", () => {
    const a = createConfirmationToken(basePayload, SECRET);
    const b = createConfirmationToken(basePayload, SECRET);
    expect(a.jti).not.toBe(b.jti);
    expect(a.token).not.toBe(b.token);
  });

  it("works for all sensitive operation types", () => {
    for (const op of SENSITIVE_OPERATIONS) {
      const result = createConfirmationToken(
        { userId: "u1", email: "e@x.com", operation: op },
        SECRET
      );
      expect(result.token).toBeDefined();
      const verified = verifyConfirmationToken(result.token, SECRET);
      expect(verified?.operation).toBe(op);
    }
  });
});

describe("verifyConfirmationToken", () => {
  it("returns payload when token is valid", () => {
    const { token } = createConfirmationToken(basePayload, SECRET);
    const payload = verifyConfirmationToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("user-1");
    expect(payload?.email).toBe("user@example.com");
    expect(payload?.operation).toBe("change_email");
    expect(payload?.operationParams).toEqual({ newEmail: "new@example.com" });
    expect(payload?.jti).toBeDefined();
  });

  it("returns null for wrong secret", () => {
    const { token } = createConfirmationToken(basePayload, SECRET);
    expect(verifyConfirmationToken(token, "wrong-secret")).toBeNull();
  });

  it("returns null for tampered token", () => {
    const { token } = createConfirmationToken(basePayload, SECRET);
    const parts = token.split(".");
    const headerB64 = parts[0] ?? "";
    const payloadB64 = parts[1] ?? "";
    const sig = parts[2] ?? "";
    const tamperedPayload =
      payloadB64.slice(0, -1) + (payloadB64.slice(-1) === "a" ? "b" : "a");
    expect(
      verifyConfirmationToken(`${headerB64}.${tamperedPayload}.${sig}`, SECRET)
    ).toBeNull();
  });

  it("returns null for malformed token (no dot)", () => {
    expect(verifyConfirmationToken("notadot", SECRET)).toBeNull();
  });

  it("returns null for two-part token (legacy format)", () => {
    expect(verifyConfirmationToken("a.b", SECRET)).toBeNull();
  });

  it("returns null for invalid base64 payload", () => {
    expect(verifyConfirmationToken("!!!.!!!.!!!", SECRET)).toBeNull();
  });

  it("round-trips without operationParams", () => {
    const { token } = createConfirmationToken(
      { userId: "u1", email: "e@x.com", operation: "delete_account" },
      SECRET
    );
    const payload = verifyConfirmationToken(token, SECRET);
    expect(payload?.operationParams).toEqual({});
  });
});

describe("confirmation token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null after TTL has passed", () => {
    const { token } = createConfirmationToken(basePayload, SECRET, {
      ttlMs: 1000,
    });
    expect(verifyConfirmationToken(token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyConfirmationToken(token, SECRET)).toBeNull();
  });

  it("returns payload when still within TTL", () => {
    const { token } = createConfirmationToken(basePayload, SECRET, {
      ttlMs: 10 * 1000,
    });
    vi.advanceTimersByTime(5000);
    expect(verifyConfirmationToken(token, SECRET)).not.toBeNull();
  });
});

describe("single-use tracking", () => {
  it("first verify succeeds, second returns null when store is used", () => {
    const store = createMemoryConfirmationStore();
    const { token } = createConfirmationToken(basePayload, SECRET);
    const first = verifyConfirmationToken(token, SECRET, {
      usedTokenStore: store,
    });
    expect(first).not.toBeNull();
    expect(first?.userId).toBe("user-1");

    const second = verifyConfirmationToken(token, SECRET, {
      usedTokenStore: store,
    });
    expect(second).toBeNull();
  });

  it("token is invalidated after use by default (second verify returns null)", () => {
    const { token } = createConfirmationToken(basePayload, SECRET);
    expect(verifyConfirmationToken(token, SECRET)).not.toBeNull();
    expect(verifyConfirmationToken(token, SECRET)).toBeNull();
  });

  it("with no-op store, token can be verified multiple times", () => {
    const noop = createNoOpConfirmationStore();
    const { token } = createConfirmationToken(basePayload, SECRET);
    expect(verifyConfirmationToken(token, SECRET, { usedTokenStore: noop })).not.toBeNull();
    expect(verifyConfirmationToken(token, SECRET, { usedTokenStore: noop })).not.toBeNull();
  });

  it("different tokens are independent with same store", () => {
    const store = createMemoryConfirmationStore();
    const a = createConfirmationToken(
      { userId: "u1", email: "a@x.com", operation: "change_password" },
      SECRET
    );
    const b = createConfirmationToken(
      { userId: "u2", email: "b@x.com", operation: "disable_mfa" },
      SECRET
    );

    expect(
      verifyConfirmationToken(a.token, SECRET, { usedTokenStore: store })
    ).not.toBeNull();
    expect(
      verifyConfirmationToken(b.token, SECRET, { usedTokenStore: store })
    ).not.toBeNull();
    expect(
      verifyConfirmationToken(a.token, SECRET, { usedTokenStore: store })
    ).toBeNull();
    expect(
      verifyConfirmationToken(b.token, SECRET, { usedTokenStore: store })
    ).toBeNull();
  });
});

describe("isSensitiveOperation", () => {
  it("returns true for all SENSITIVE_OPERATIONS", () => {
    for (const op of SENSITIVE_OPERATIONS) {
      expect(isSensitiveOperation(op)).toBe(true);
    }
  });

  it("returns false for unknown operation", () => {
    expect(isSensitiveOperation("unknown_op")).toBe(false);
    expect(isSensitiveOperation("")).toBe(false);
  });
});

describe("requireConfirmationForSensitiveOperation", () => {
  const context = {
    userId: "user-1",
    email: "user@example.com",
    operation: "change_email" as SensitiveOperationType,
  };

  it("requires double-opt-in for all sensitive operations (no bypass without token)", () => {
    for (const operation of SENSITIVE_OPERATIONS) {
      const result = requireConfirmationForSensitiveOperation(
        operation,
        undefined,
        { ...context, operation },
        SECRET
      );
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe("missing_token");
    }
  });

  it("returns allowed: true when valid token matches context", () => {
    const { token } = createConfirmationToken(
      {
        userId: context.userId,
        email: context.email,
        operation: context.operation,
      },
      SECRET
    );
    const result = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.payload.userId).toBe("user-1");
      expect(result.payload.email).toBe("user@example.com");
      expect(result.payload.operation).toBe("change_email");
    }
  });

  it("returns not_sensitive for unknown operation", () => {
    const result = requireConfirmationForSensitiveOperation(
      "unknown_op",
      "any-token",
      context,
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("not_sensitive");
  });

  it("returns missing_token when token is undefined", () => {
    const result = requireConfirmationForSensitiveOperation(
      "change_password",
      undefined,
      { ...context, operation: "change_password" },
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("missing_token");
  });

  it("returns missing_token when token is empty string", () => {
    const result = requireConfirmationForSensitiveOperation(
      "delete_account",
      "",
      { ...context, operation: "delete_account" },
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("missing_token");
  });

  it("returns invalid_token when token is wrong or tampered", () => {
    const r1 = requireConfirmationForSensitiveOperation(
      "change_email",
      "invalid.jwt.here",
      context,
      SECRET
    );
    expect(r1.allowed).toBe(false);
    if (!r1.allowed) expect(r1.reason).toBe("invalid_token");

    const { token } = createConfirmationToken(
      { userId: "u", email: "e@x.com", operation: "change_email" },
      SECRET
    );
    const r2 = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      "wrong-secret"
    );
    expect(r2.allowed).toBe(false);
    if (!r2.allowed) expect(r2.reason).toBe("invalid_token");
  });

  it("returns user_mismatch when token userId does not match context", () => {
    const { token } = createConfirmationToken(
      { userId: "other-user", email: context.email, operation: context.operation },
      SECRET
    );
    const result = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("user_mismatch");
  });

  it("returns user_mismatch when token email does not match context", () => {
    const { token } = createConfirmationToken(
      { userId: context.userId, email: "other@example.com", operation: context.operation },
      SECRET
    );
    const result = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("user_mismatch");
  });

  it("returns user_mismatch when token operation does not match context", () => {
    const { token } = createConfirmationToken(
      { userId: context.userId, email: context.email, operation: "delete_account" },
      SECRET
    );
    const result = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("user_mismatch");
  });

  it("honors usedTokenStore so single-use tokens cannot be reused", () => {
    const store = createMemoryConfirmationStore();
    const { token } = createConfirmationToken(
      { userId: context.userId, email: context.email, operation: context.operation },
      SECRET
    );
    const first = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET,
      { usedTokenStore: store }
    );
    expect(first.allowed).toBe(true);
    const second = requireConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET,
      { usedTokenStore: store }
    );
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("invalid_token");
  });
});

describe("ConfirmationRequiredError", () => {
  it("has name ConfirmationRequiredError and reason", () => {
    const err = new ConfirmationRequiredError("missing_token");
    expect(err.name).toBe("ConfirmationRequiredError");
    expect(err.reason).toBe("missing_token");
    expect(err.message).toContain("missing_token");
  });

  it("accepts custom message", () => {
    const err = new ConfirmationRequiredError("invalid_token", "Custom message");
    expect(err.message).toBe("Custom message");
    expect(err.reason).toBe("invalid_token");
  });
});

describe("assertConfirmationForSensitiveOperation", () => {
  const context = {
    userId: "user-1",
    email: "user@example.com",
    operation: "change_email" as SensitiveOperationType,
  };

  it("returns payload when valid token matches context", () => {
    const { token } = createConfirmationToken(
      { userId: context.userId, email: context.email, operation: context.operation },
      SECRET
    );
    const payload = assertConfirmationForSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET
    );
    expect(payload.userId).toBe("user-1");
    expect(payload.email).toBe("user@example.com");
    expect(payload.operation).toBe("change_email");
  });

  it("throws ConfirmationRequiredError with not_sensitive for unknown operation", () => {
    expect(() =>
      assertConfirmationForSensitiveOperation("unknown_op", "any-token", context, SECRET)
    ).toThrow(ConfirmationRequiredError);
    try {
      assertConfirmationForSensitiveOperation("unknown_op", "any-token", context, SECRET);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      expect((e as ConfirmationRequiredError).reason).toBe("not_sensitive");
    }
  });

  it("throws ConfirmationRequiredError with missing_token when token is undefined", () => {
    try {
      assertConfirmationForSensitiveOperation(
        "change_password",
        undefined,
        { ...context, operation: "change_password" },
        SECRET
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      expect((e as ConfirmationRequiredError).reason).toBe("missing_token");
    }
  });

  it("throws ConfirmationRequiredError with invalid_token when token is bad", () => {
    try {
      assertConfirmationForSensitiveOperation(
        "change_email",
        "invalid.jwt.here",
        context,
        SECRET
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      expect((e as ConfirmationRequiredError).reason).toBe("invalid_token");
    }
  });

  it("throws ConfirmationRequiredError with user_mismatch when token user does not match", () => {
    const { token } = createConfirmationToken(
      { userId: "other-user", email: context.email, operation: context.operation },
      SECRET
    );
    try {
      assertConfirmationForSensitiveOperation("change_email", token, context, SECRET);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmationRequiredError);
      expect((e as ConfirmationRequiredError).reason).toBe("user_mismatch");
    }
  });
});
