import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exchangeClientCredentials,
  handleClientCredentialsFlow,
  verifyClientCredentialsToken,
  type ClientVerifier,
  type TokenResponse,
} from "../src/client-credentials.js";

function isTokenResponse(
  r: ReturnType<typeof exchangeClientCredentials>
): r is TokenResponse {
  return "access_token" in r;
}

function assertTokenResponse(
  r: ReturnType<typeof exchangeClientCredentials>
): asserts r is TokenResponse {
  expect(isTokenResponse(r)).toBe(true);
}

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
    assertTokenResponse(result);
    expect(result.access_token).toBeDefined();
    expect(result.access_token.split(".")).toHaveLength(3);
    expect(result.token_type).toBe("Bearer");
    expect(result.expires_in).toBe(3600);
    expect(result.scope).toBe("read write");
  });

  it("returns invalid_client error for invalid client credentials", () => {
    const r1 = exchangeClientCredentials("wrong", "client-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect("error" in r1 && r1.error).toBe("invalid_client");
    expect("error" in r1 && r1.error_description).toBeDefined();
    const r2 = exchangeClientCredentials("m2m-client", "wrong-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    expect("error" in r2 && r2.error).toBe("invalid_client");
  });

  it("includes org_id and permissions when verifier returns them", () => {
    const result = exchangeClientCredentials("org-client", "org-secret", {
      secret: SECRET,
      clientVerifier: validVerifier,
    });
    assertTokenResponse(result);
    const payload = verifyClientCredentialsToken(result.access_token, SECRET);
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
    assertTokenResponse(result);
    expect(result.scope).toBe("openid");
    const payload = verifyClientCredentialsToken(result.access_token, SECRET);
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
    assertTokenResponse(result);
    expect(result.expires_in).toBe(300);
    const payload = verifyClientCredentialsToken(result.access_token, SECRET);
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
    assertTokenResponse(issued);
    const payload = verifyClientCredentialsToken(issued.access_token, SECRET);
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
    assertTokenResponse(issued);
    expect(verifyClientCredentialsToken(issued.access_token, "wrong-secret")).toBeNull();
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
    assertTokenResponse(issued);
    const parts = issued.access_token.split(".");
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
    assertTokenResponse(result);
    expect(verifyClientCredentialsToken(result.access_token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyClientCredentialsToken(result.access_token, SECRET)).toBeNull();
  });
});

describe("handleClientCredentialsFlow", () => {
  const flowOptions = {
    secret: SECRET,
    clientVerifier: validVerifier,
  };

  it("returns token response for valid grant_type, client_id, and client_secret", () => {
    const result = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: "m2m-client",
        client_secret: "client-secret",
      },
      flowOptions
    );
    assertTokenResponse(result);
    expect(result.access_token).toBeDefined();
    expect(result.token_type).toBe("Bearer");
    expect(result.expires_in).toBe(3600);
    expect(result.scope).toBe("read write");
  });

  it("returns unsupported_grant_type when grant_type is not client_credentials", () => {
    const r = handleClientCredentialsFlow(
      {
        grant_type: "refresh_token",
        client_id: "m2m-client",
        client_secret: "client-secret",
      },
      flowOptions
    );
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("unsupported_grant_type");
      expect(r.error_description).toContain("client_credentials");
    }
  });

  it("returns invalid_request when client_id is missing or empty", () => {
    const r1 = handleClientCredentialsFlow(
      { grant_type: "client_credentials", client_secret: "client-secret" },
      flowOptions
    );
    expect("error" in r1).toBe(true);
    if ("error" in r1) {
      expect(r1.error).toBe("invalid_request");
      expect(r1.error_description).toContain("client_id");
    }
    const r2 = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: "   ",
        client_secret: "client-secret",
      },
      flowOptions
    );
    expect("error" in r2).toBe(true);
    if ("error" in r2) expect(r2.error).toBe("invalid_request");
  });

  it("returns invalid_request when client_secret is missing or empty", () => {
    const r = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: "m2m-client",
      },
      flowOptions
    );
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toBe("invalid_request");
      expect(r.error_description).toContain("client_secret");
    }
  });

  it("returns invalid_client when verifier rejects credentials", () => {
    const r = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: "wrong",
        client_secret: "client-secret",
      },
      flowOptions
    );
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_client");
  });

  it("forwards optional scope from params", () => {
    const result = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: "m2m-client",
        client_secret: "client-secret",
        scope: "custom:scope",
      },
      flowOptions
    );
    assertTokenResponse(result);
    expect(result.scope).toBe("custom:scope");
    const payload = verifyClientCredentialsToken(result.access_token, SECRET);
    expect(payload?.scope).toBe("custom:scope");
  });
});
