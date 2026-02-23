import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRefreshToken,
  verifyRefreshToken,
  verifyRefreshTokenWithKeySet,
  exchangeRefreshToken,
  createMemoryUsedRefreshTokenStore,
  createNoOpUsedRefreshTokenStore,
  handleRefreshTokenFlow,
} from "../src/refresh-token.js";
import {
  createMemorySigningKeyStore,
  asKeySetView,
  generateSigningKey,
} from "../src/key-rotation.js";

const SECRET = "refresh-token-secret";

describe("createRefreshToken", () => {
  it("returns refresh_token and expires_in", () => {
    const result = createRefreshToken(
      { sub: "user-1", clientId: "client-a" },
      SECRET
    );
    expect(result.refresh_token).toBeDefined();
    expect(result.refresh_token.split(".")).toHaveLength(3);
    expect(result.expires_in).toBeGreaterThan(0);
  });

  it("includes scope when provided", () => {
    const result = createRefreshToken(
      { sub: "u", clientId: "c", scope: "openid profile" },
      SECRET
    );
    const payload = verifyRefreshToken(result.refresh_token, SECRET);
    expect(payload?.scope).toBe("openid profile");
  });

  it("accepts iss and aud", () => {
    const result = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET,
      { iss: "https://auth.example.com", aud: "https://api.example.com" }
    );
    const payload = verifyRefreshToken(result.refresh_token, SECRET);
    expect(payload?.iss).toBe("https://auth.example.com");
    expect(payload?.aud).toBe("https://api.example.com");
  });
});

describe("verifyRefreshToken", () => {
  it("returns payload for valid token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "user-42", clientId: "my-client", scope: "read" },
      SECRET
    );
    const payload = verifyRefreshToken(refresh_token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-42");
    expect(payload?.client_id).toBe("my-client");
    expect(payload?.scope).toBe("read");
    expect(typeof payload?.jti).toBe("string");
    expect(typeof payload?.exp).toBe("number");
    expect(typeof payload?.iat).toBe("number");
  });

  it("returns null for wrong secret", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    expect(verifyRefreshToken(refresh_token, "wrong-secret")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyRefreshToken("not-three-parts", SECRET)).toBeNull();
    expect(verifyRefreshToken("a.b", SECRET)).toBeNull();
  });

  it("returns null for tampered token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const parts = refresh_token.split(".");
    const tampered = `${parts[0]}.${parts[1]?.slice(0, -1)}x.${parts[2] ?? ""}`;
    expect(verifyRefreshToken(tampered, SECRET)).toBeNull();
  });
});

describe("refresh token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when token is expired", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET,
      { expiresInSec: 60 }
    );
    vi.advanceTimersByTime(61 * 1000);
    expect(verifyRefreshToken(refresh_token, SECRET)).toBeNull();
  });

  it("returns payload when token is not yet expired", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET,
      { expiresInSec: 120 }
    );
    vi.advanceTimersByTime(60 * 1000);
    expect(verifyRefreshToken(refresh_token, SECRET)).not.toBeNull();
  });
});

describe("exchangeRefreshToken", () => {
  it("returns access_token for valid refresh_token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "user-1", clientId: "client-x" },
      SECRET
    );
    const result = exchangeRefreshToken(refresh_token, { secret: SECRET });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.access_token).toBeDefined();
      expect(result.access_token.split(".")).toHaveLength(3);
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBeGreaterThan(0);
    }
  });

  it("includes scope in response when present", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c", scope: "openid email" },
      SECRET
    );
    const result = exchangeRefreshToken(refresh_token, { secret: SECRET });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.scope).toBe("openid email");
    }
  });

  it("returns invalid_grant for invalid refresh_token", () => {
    const result = exchangeRefreshToken("invalid-token", { secret: SECRET });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
      expect(result.error_description).toBeDefined();
    }
  });

  it("returns invalid_grant for wrong secret", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const result = exchangeRefreshToken(refresh_token, { secret: "wrong" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("uses custom access token TTL", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const result = exchangeRefreshToken(refresh_token, {
      secret: SECRET,
      accessTokenTtlMs: 15 * 60 * 1000,
    });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.expires_in).toBe(15 * 60);
    }
  });

  it("passes iss and aud to access token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET,
      { iss: "https://auth.example.com" }
    );
    const result = exchangeRefreshToken(refresh_token, {
      secret: SECRET,
      iss: "https://auth.example.com",
      aud: "https://api.example.com",
    });
    expect("access_token" in result).toBe(true);
    if (!("access_token" in result)) return;
    const payloadB64 = result.access_token.split(".")[1];
    if (!payloadB64) return;
    const payload = JSON.parse(
      Buffer.from(
        payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    ) as Record<string, unknown>;
    expect(payload.iss).toBe("https://auth.example.com");
    expect(payload.aud).toBe("https://api.example.com");
  });

  it("with rotateRefreshToken and store, returns new refresh_token and marks old used", () => {
    const store = createMemoryUsedRefreshTokenStore();
    const { refresh_token: first } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const result1 = exchangeRefreshToken(first, {
      secret: SECRET,
      usedTokenStore: store,
      rotateRefreshToken: true,
    });
    expect("access_token" in result1).toBe(true);
    expect("refresh_token" in result1).toBe(true);
    const newRefresh: string = "refresh_token" in result1 ? (result1.refresh_token ?? "") : "";
    expect(newRefresh).not.toBe(first);

    const result2 = exchangeRefreshToken(newRefresh, {
      secret: SECRET,
      usedTokenStore: store,
      rotateRefreshToken: true,
    });
    expect("access_token" in result2).toBe(true);

    const result3 = exchangeRefreshToken(first, {
      secret: SECRET,
      usedTokenStore: store,
    });
    expect("error" in result3).toBe(true);
    if ("error" in result3) expect(result3.error).toBe("invalid_grant");
  });

  it("without rotateRefreshToken, same refresh_token can be used multiple times when no-op store provided", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const noop = createNoOpUsedRefreshTokenStore();
    const r1 = exchangeRefreshToken(refresh_token, { secret: SECRET, usedTokenStore: noop });
    const r2 = exchangeRefreshToken(refresh_token, { secret: SECRET, usedTokenStore: noop });
    expect("access_token" in r1).toBe(true);
    expect("access_token" in r2).toBe(true);
    if ("access_token" in r1 && "access_token" in r2) {
      expect(r1.access_token).not.toBe(r2.access_token);
    }
  });

  it("single-use by default: token invalidated after first use when usedTokenStore omitted", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const first = exchangeRefreshToken(refresh_token, { secret: SECRET });
    expect("access_token" in first).toBe(true);
    const second = exchangeRefreshToken(refresh_token, { secret: SECRET });
    expect("error" in second).toBe(true);
    if ("error" in second) {
      expect(second.error).toBe("invalid_grant");
      expect(second.error_description).toBe("Refresh token was already used");
    }
  });

  it("single-use: with usedTokenStore and no rotation, token invalidated after first use", () => {
    const store = createMemoryUsedRefreshTokenStore();
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const first = exchangeRefreshToken(refresh_token, {
      secret: SECRET,
      usedTokenStore: store,
    });
    expect("access_token" in first).toBe(true);
    expect("refresh_token" in first).toBe(false);

    const second = exchangeRefreshToken(refresh_token, {
      secret: SECRET,
      usedTokenStore: store,
    });
    expect("error" in second).toBe(true);
    if ("error" in second) {
      expect(second.error).toBe("invalid_grant");
      expect(second.error_description).toBe("Refresh token was already used");
    }
  });
});

describe("handleRefreshTokenFlow", () => {
  it("returns access_token for valid grant_type and refresh_token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "user-1", clientId: "client-a" },
      SECRET
    );
    const result = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token },
      { secret: SECRET }
    );
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.access_token).toBeDefined();
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBeGreaterThan(0);
    }
  });

  it("returns unsupported_grant_type when grant_type is not refresh_token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const r1 = handleRefreshTokenFlow(
      { grant_type: "authorization_code", refresh_token },
      { secret: SECRET }
    );
    expect("error" in r1).toBe(true);
    if ("error" in r1) {
      expect(r1.error).toBe("unsupported_grant_type");
      expect(r1.error_description).toContain("refresh_token");
    }
    const r2 = handleRefreshTokenFlow(
      { grant_type: "client_credentials", refresh_token },
      { secret: SECRET }
    );
    expect("error" in r2).toBe(true);
    if ("error" in r2) expect(r2.error).toBe("unsupported_grant_type");
  });

  it("returns invalid_request when refresh_token is missing or empty", () => {
    const r1 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: undefined },
      { secret: SECRET }
    );
    expect("error" in r1).toBe(true);
    if ("error" in r1) {
      expect(r1.error).toBe("invalid_request");
      expect(r1.error_description).toContain("required");
    }
    const r2 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: "" },
      { secret: SECRET }
    );
    expect("error" in r2).toBe(true);
    if ("error" in r2) expect(r2.error).toBe("invalid_request");
    const r3 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: "   " },
      { secret: SECRET }
    );
    expect("error" in r3).toBe(true);
    if ("error" in r3) expect(r3.error).toBe("invalid_request");
  });

  it("returns invalid_grant for invalid or expired refresh_token", () => {
    const r1 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: "invalid.jwt.here" },
      { secret: SECRET }
    );
    expect("error" in r1).toBe(true);
    if ("error" in r1) {
      expect(r1.error).toBe("invalid_grant");
      expect(r1.error_description).toBeDefined();
    }
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const r2 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token },
      { secret: "wrong-secret" }
    );
    expect("error" in r2).toBe(true);
    if ("error" in r2) expect(r2.error).toBe("invalid_grant");
  });

  it("accepts client_id and rejects when it does not match token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "client-x" },
      SECRET
    );
    const result = handleRefreshTokenFlow(
      {
        grant_type: "refresh_token",
        refresh_token,
        client_id: "other-client",
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
      expect(result.error_description).toContain("client_id");
    }
  });

  it("accepts client_id and succeeds when it matches token", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "client-x" },
      SECRET
    );
    const result = handleRefreshTokenFlow(
      {
        grant_type: "refresh_token",
        refresh_token,
        client_id: "client-x",
      },
      { secret: SECRET }
    );
    expect("access_token" in result).toBe(true);
  });

  it("succeeds without client_id (optional)", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const result = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token },
      { secret: SECRET }
    );
    expect("access_token" in result).toBe(true);
  });

  it("passes through rotateRefreshToken and usedTokenStore", () => {
    const store = createMemoryUsedRefreshTokenStore();
    const { refresh_token: first } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const result1 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: first },
      {
        secret: SECRET,
        usedTokenStore: store,
        rotateRefreshToken: true,
      }
    );
    expect("access_token" in result1).toBe(true);
    expect("refresh_token" in result1).toBe(true);
    const newRefresh =
      "refresh_token" in result1 ? (result1.refresh_token ?? "") : "";
    expect(newRefresh).not.toBe(first);

    const result2 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: newRefresh },
      { secret: SECRET, usedTokenStore: store }
    );
    expect("access_token" in result2).toBe(true);

    const result3 = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token: first },
      { secret: SECRET, usedTokenStore: store }
    );
    expect("error" in result3).toBe(true);
    if ("error" in result3) expect(result3.error).toBe("invalid_grant");
  });
});

describe("key set and verifyRefreshTokenWithKeySet", () => {
  it("createRefreshToken with keyId includes kid in header", () => {
    const result = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET,
      { keyId: "key-1" }
    );
    const parts = result.refresh_token.split(".");
    const header = JSON.parse(
      Buffer.from(
        parts[0]!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    ) as Record<string, string>;
    expect(header.kid).toBe("key-1");
  });

  it("verifyRefreshTokenWithKeySet verifies token signed with current key", () => {
    const keyStore = createMemorySigningKeyStore();
    const view = asKeySetView(keyStore);
    const current = keyStore.getCurrent()!;
    const { refresh_token } = createRefreshToken(
      { sub: "user-1", clientId: "c" },
      current.secret,
      { keyId: current.id }
    );
    const payload = verifyRefreshTokenWithKeySet(refresh_token, view);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");
  });

  it("verifyRefreshTokenWithKeySet verifies token signed with previous key after rotation", () => {
    const keyStore = createMemorySigningKeyStore();
    const view = asKeySetView(keyStore);
    const old = keyStore.getCurrent()!;
    const { refresh_token } = createRefreshToken(
      { sub: "user-1", clientId: "c" },
      old.secret,
      { keyId: old.id }
    );
    keyStore.addKey(generateSigningKey());
    expect(keyStore.getCurrent()!.id).not.toBe(old.id);
    const payload = verifyRefreshTokenWithKeySet(refresh_token, view);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");
  });

  it("exchangeRefreshToken with keySet uses current key for new refresh token", () => {
    const keyStore = createMemorySigningKeyStore();
    const view = asKeySetView(keyStore);
    const usedStore = createMemoryUsedRefreshTokenStore();
    const current = keyStore.getCurrent()!;
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      current.secret,
      { keyId: current.id }
    );
    const result = exchangeRefreshToken(refresh_token, {
      secret: current.secret,
      keySet: view,
      usedTokenStore: usedStore,
      rotateRefreshToken: true,
    });
    expect("access_token" in result).toBe(true);
    if ("refresh_token" in result && result.refresh_token) {
      const payload = verifyRefreshTokenWithKeySet(result.refresh_token, view);
      expect(payload?.sub).toBe("u");
    }
  });

  it("handleRefreshTokenFlow with keySet verifies and returns access_token", () => {
    const keyStore = createMemorySigningKeyStore();
    const view = asKeySetView(keyStore);
    const current = keyStore.getCurrent()!;
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      current.secret,
      { keyId: current.id }
    );
    const result = handleRefreshTokenFlow(
      { grant_type: "refresh_token", refresh_token },
      { secret: current.secret, keySet: view }
    );
    expect("access_token" in result).toBe(true);
  });
});
