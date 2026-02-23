import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRefreshToken,
  verifyRefreshToken,
  exchangeRefreshToken,
  createMemoryUsedRefreshTokenStore,
} from "../src/refresh-token.js";

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
    const newRefresh = "refresh_token" in result1 ? result1.refresh_token : "";
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

  it("without rotateRefreshToken, same refresh_token can be used multiple times", () => {
    const { refresh_token } = createRefreshToken(
      { sub: "u", clientId: "c" },
      SECRET
    );
    const r1 = exchangeRefreshToken(refresh_token, { secret: SECRET });
    const r2 = exchangeRefreshToken(refresh_token, { secret: SECRET });
    expect("access_token" in r1).toBe(true);
    expect("access_token" in r2).toBe(true);
    if ("access_token" in r1 && "access_token" in r2) {
      expect(r1.access_token).not.toBe(r2.access_token);
    }
  });
});
