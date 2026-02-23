import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exchangeClientCredentials,
  verifyClientCredentialsToken,
  type ClientVerifier,
} from "../src/client-credentials.js";

const SECRET = "oauth-token-secret";

const validVerifier: ClientVerifier = (clientId, clientSecret) => {
  if (clientId === "m2m-client" && clientSecret === "client-secret")
    return { scope: "read write" };
  if (clientId === "org-client" && clientSecret === "org-secret")
    return { scope: "api", orgId: "org_123", permissions: ["read", "write"] };
  return null;
};

describe("exchangeClientCredentials", () => {
  it("returns token response for valid client_id and client_secret", () => {
    const result = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect(result).not.toBeNull();
    expect(result?.access_token).toBeDefined();
    expect(result?.access_token.split(".")).toHaveLength(3);
    expect(result?.token_type).toBe("Bearer");
    expect(result?.expires_in).toBe(3600);
    expect(result?.scope).toBe("read write");
  });

  it("returns null for invalid client credentials", () => {
    expect(
      exchangeClientCredentials("wrong", "client-secret", {
        secret: SECRET,
        clientVerifier: validVerifier,
      })
    ).toBeNull();
    expect(
      exchangeClientCredentials("m2m-client", "wrong-secret", {
        secret: SECRET,
        clientVerifier: validVerifier,
      })
    ).toBeNull();
  });

  it("includes org_id and permissions when verifier returns them", () => {
    const result = exchangeClientCredentials("org-client", "org-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect(result).not.toBeNull();
    const payload = verifyClientCredentialsToken(result!.access_token, SECRET);
    expect(payload?.client_id).toBe("org-client");
    expect(payload?.scope).toBe("api");
    expect(payload?.org_id).toBe("org_123");
    expect(payload?.permissions).toEqual(["read", "write"]);
  });

  it("accepts optional scope override and iss/aud", () => {
    const result = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
      scope: "openid",
      iss: "https://auth.example.com",
      aud: "https://api.example.com",
    });
    expect(result).not.toBeNull();
    expect(result?.scope).toBe("openid");
    const payload = verifyClientCredentialsToken(result!.access_token, SECRET);
    expect(payload?.scope).toBe("openid");
    expect(payload?.iss).toBe("https://auth.example.com");
    expect(payload?.aud).toBe("https://api.example.com");
  });

  it("accepts custom ttlMs", () => {
    const result = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
      ttlMs: 5 * 60 * 1000,
    });
    expect(result).not.toBeNull();
    expect(result?.expires_in).toBe(300);
    const payload = verifyClientCredentialsToken(result!.access_token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.exp - payload!.iat).toBe(300);
  });
});

describe("verifyClientCredentialsToken", () => {
  it("returns payload for valid token", () => {
    const issued = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect(issued).not.toBeNull();
    const payload = verifyClientCredentialsToken(issued!.access_token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("m2m-client");
    expect(payload?.client_id).toBe("m2m-client");
    expect(payload?.scope).toBe("read write");
    expect(payload?.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload?.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns null for wrong secret", () => {
    const issued = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect(issued).not.toBeNull();
    expect(verifyClientCredentialsToken(issued!.access_token, "wrong-secret")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyClientCredentialsToken("not.three.parts.here", SECRET)).toBeNull();
    expect(verifyClientCredentialsToken("a.b", SECRET)).toBeNull();
    expect(verifyClientCredentialsToken("", SECRET)).toBeNull();
  });

  it("returns null for tampered token", () => {
    const issued = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect(issued).not.toBeNull();
    const parts = issued!.access_token.split(".");
    const tampered = `${parts[0]}.${parts[1]?.slice(0, -1) ?? ""}x.${parts[2] ?? ""}`;
    expect(verifyClientCredentialsToken(tampered, SECRET)).toBeNull();
  });
});

describe("client credentials token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when token is expired", () => {
    const result = exchangeClientCredentials("m2m-client", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
      ttlMs: 1000,
    });
    expect(result).not.toBeNull();
    expect(verifyClientCredentialsToken(result!.access_token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyClientCredentialsToken(result!.access_token, SECRET)).toBeNull();
  });
});
