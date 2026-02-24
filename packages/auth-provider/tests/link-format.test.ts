import { describe, it, expect, vi } from "vitest";
import {
  buildJwtLink,
  parseJwtFromLink,
  DEFAULT_LINK_TTL_MS,
  DEFAULT_LINK_TOKEN_PARAM,
} from "../src/link-format.js";
import { createMagicLinkToken, verifyMagicLinkToken } from "../src/magic-link.js";
import { createConfirmationToken, verifyConfirmationToken } from "../src/double-opt-in.js";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "../src/password-reset.js";
import {
  createEmailVerificationToken,
  verifyEmailVerificationToken,
  createNoOpEmailVerificationStore,
} from "../src/email-verification.js";

const SECRET = "link-format-secret";

describe("link format constants", () => {
  it("DEFAULT_LINK_TTL_MS is 15 minutes", () => {
    expect(DEFAULT_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });

  it("DEFAULT_LINK_TOKEN_PARAM is token", () => {
    expect(DEFAULT_LINK_TOKEN_PARAM).toBe("token");
  });
});

describe("buildJwtLink", () => {
  it("appends token param with default name", () => {
    const link = buildJwtLink("https://app.example.com/confirm", "jwt.here.sig");
    expect(link).toBe("https://app.example.com/confirm?token=jwt.here.sig");
  });

  it("uses custom param name", () => {
    const link = buildJwtLink("https://x.com/v", "a.b.c", { paramName: "t" });
    expect(link).toBe("https://x.com/v?t=a.b.c");
  });

  it("appends with & when baseUrl already has query", () => {
    const link = buildJwtLink("https://app.example.com/confirm?from=email", "jwt.sig");
    expect(link).toBe("https://app.example.com/confirm?from=email&token=jwt.sig");
  });

  it("encodes JWT for URL safety", () => {
    const jwt = "a+b/c=d.e_f-g";
    const link = buildJwtLink("https://example.com", jwt);
    expect(parseJwtFromLink(link)).toBe(jwt);
  });

  it("appends token before existing hash", () => {
    const link = buildJwtLink("https://app.example.com/confirm#section", "t.o.k");
    expect(link).toBe("https://app.example.com/confirm?token=t.o.k#section");
  });
});

describe("parseJwtFromLink", () => {
  it("extracts token from URL with default param", () => {
    const url = "https://app.example.com/login?token=header.payload.sig";
    expect(parseJwtFromLink(url)).toBe("header.payload.sig");
  });

  it("extracts token with custom param name", () => {
    const url = "https://x.com?t=my.jwt.sig";
    expect(parseJwtFromLink(url, { paramName: "t" })).toBe("my.jwt.sig");
  });

  it("returns null when param missing", () => {
    expect(parseJwtFromLink("https://example.com/confirm")).toBeNull();
    expect(parseJwtFromLink("https://example.com?other=1")).toBeNull();
  });

  it("returns null for empty param", () => {
    expect(parseJwtFromLink("https://example.com?token=")).toBeNull();
  });

  it("round-trips with buildJwtLink", () => {
    const base = "https://app.example.com/confirm";
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.sig";
    const link = buildJwtLink(base, jwt);
    expect(parseJwtFromLink(link)).toBe(jwt);
  });
});

describe("JWT-based link with short expiry (magic link)", () => {
  it("buildJwtLink produces URL whose token is valid JWT with short expiry", () => {
    const { token, expiresAt } = createMagicLinkToken({ email: "u@example.com" }, SECRET);
    const link = buildJwtLink("https://app.example.com/login", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).toBe(token);
    const payload = verifyMagicLinkToken(extracted!, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("u@example.com");
    const ttlMs = expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_LINK_TTL_MS + 2000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_LINK_TTL_MS - 2000);
  });
});

describe("JWT-based link with short expiry (confirmation)", () => {
  it("buildJwtLink produces URL whose token is valid JWT with short expiry", () => {
    const { token, expiresAt } = createConfirmationToken(
      { userId: "u1", email: "u@example.com", operation: "change_email" },
      SECRET
    );
    const link = buildJwtLink("https://app.example.com/confirm", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).toBe(token);
    const payload = verifyConfirmationToken(extracted!, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("u@example.com");
    expect(payload?.operation).toBe("change_email");
    const ttlMs = expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_LINK_TTL_MS + 2000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_LINK_TTL_MS - 2000);
  });
});

describe("JWT-based link with short expiry (email verification)", () => {
  it("buildJwtLink produces URL whose token is valid JWT with short expiry", () => {
    const { token, expiresAt } = createEmailVerificationToken(
      { userId: "u1", email: "u@example.com" },
      SECRET
    );
    const link = buildJwtLink("https://app.example.com/verify-email", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).toBe(token);
    const payload = verifyEmailVerificationToken(extracted!, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("u@example.com");
    const ttlMs = expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_LINK_TTL_MS + 2000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_LINK_TTL_MS - 2000);
  });
});

describe("JWT-based link with short expiry (password reset)", () => {
  it("buildJwtLink produces URL whose token is valid JWT with short expiry", () => {
    const { token, expiresAt } = createPasswordResetToken(
      { userId: "u1", email: "u@example.com" },
      SECRET
    );
    const link = buildJwtLink("https://app.example.com/reset", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).toBe(token);
    const payload = verifyPasswordResetToken(extracted!, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("u@example.com");
    const ttlMs = expiresAt - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_LINK_TTL_MS + 2000);
    expect(ttlMs).toBeGreaterThanOrEqual(DEFAULT_LINK_TTL_MS - 2000);
  });
});

describe("JWT in link has exp claim and short expiry", () => {
  it("decoded JWT payload from link contains exp within DEFAULT_LINK_TTL_MS", () => {
    const { token } = createMagicLinkToken({ email: "u@example.com" }, SECRET);
    const link = buildJwtLink("https://app.example.com/login", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).not.toBeNull();
    const parts = (extracted as string).split(".");
    expect(parts).toHaveLength(3);
    const b64 = parts[1];
    if (!b64) throw new Error("missing payload");
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4);
    const payloadJson = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    expect(payload.exp).toBeDefined();
    const nowSec = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(nowSec);
    expect(payload.exp).toBeLessThanOrEqual(nowSec + Math.ceil(DEFAULT_LINK_TTL_MS / 1000) + 2);
  });

  it("expired JWT extracted from link fails verification", () => {
    vi.useFakeTimers();
    const store = createNoOpEmailVerificationStore();
    const { token } = createEmailVerificationToken(
      { userId: "u1", email: "u@example.com" },
      SECRET,
      { ttlMs: 1000 }
    );
    const link = buildJwtLink("https://app.example.com/verify-email", token);
    const extracted = parseJwtFromLink(link);
    expect(extracted).toBe(token);
    expect(
      verifyEmailVerificationToken(extracted!, SECRET, { usedTokenStore: store })
    ).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(
      verifyEmailVerificationToken(extracted!, SECRET, { usedTokenStore: store })
    ).toBeNull();
    vi.useRealTimers();
  });
});
