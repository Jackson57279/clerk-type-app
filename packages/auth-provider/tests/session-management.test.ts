import { describe, it, expect, vi } from "vitest";
import {
  createSession,
  verifyAccessToken,
  refreshSession,
  revokeSession,
  revokeAllSessionsForUser,
  createMemorySessionStore,
} from "../src/session-management.js";

const SECRET = "session-jwt-secret";

describe("createSession", () => {
  it("returns accessToken (JWT), refreshToken (opaque), sessionId, and expires", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "user-1", orgId: "org-1" },
      { secret: SECRET }
    );
    expect(result.accessToken).toBeDefined();
    expect(result.accessToken.split(".")).toHaveLength(3);
    expect(result.refreshToken).toBeDefined();
    expect(result.refreshToken.split(".").length).toBeGreaterThan(0);
    expect(result.sessionId).toBeDefined();
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.refreshExpiresIn).toBeGreaterThan(0);
  });

  it("access token payload contains sub, session_id, org_id", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "user-42", orgId: "org-a" },
      { secret: SECRET }
    );
    const payload = verifyAccessToken(result.accessToken, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-42");
    expect(payload?.session_id).toBe(result.sessionId);
    expect(payload?.org_id).toBe("org-a");
  });

  it("accepts null orgId", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    const payload = verifyAccessToken(result.accessToken, SECRET);
    expect(payload?.org_id).toBeNull();
  });

  it("uses custom access token TTL", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET, accessTokenTtlMs: 15 * 60 * 1000 }
    );
    expect(result.expiresIn).toBe(15 * 60);
  });
});

describe("verifyAccessToken", () => {
  it("returns payload for valid token", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "user-1", orgId: "org-1" },
      { secret: SECRET }
    );
    const payload = verifyAccessToken(result.accessToken, SECRET);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.session_id).toBe(result.sessionId);
    expect(typeof payload?.iat).toBe("number");
    expect(typeof payload?.exp).toBe("number");
    expect(typeof payload?.jti).toBe("string");
  });

  it("returns null for wrong secret", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    expect(verifyAccessToken(result.accessToken, "wrong")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyAccessToken("a.b", SECRET)).toBeNull();
    expect(verifyAccessToken("a.b.c.d", SECRET)).toBeNull();
    expect(verifyAccessToken("", SECRET)).toBeNull();
  });

  it("returns null for expired token", async () => {
    vi.useFakeTimers();
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET, accessTokenTtlMs: 1000 }
    );
    vi.advanceTimersByTime(2000);
    expect(verifyAccessToken(result.accessToken, SECRET)).toBeNull();
    vi.useRealTimers();
  });
});

describe("refreshSession", () => {
  it("returns new access and refresh token for valid refresh token", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "user-1", orgId: "org-1" },
      { secret: SECRET }
    );
    const refreshed = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("accessToken" in refreshed).toBe(true);
    if ("accessToken" in refreshed) {
      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.refreshToken).not.toBe(created.refreshToken);
      expect(refreshed.sessionId).toBe(created.sessionId);
      const payload = verifyAccessToken(refreshed.accessToken, SECRET);
      expect(payload?.sub).toBe("user-1");
    }
  });

  it("returns invalid_grant for invalid refresh token", async () => {
    const store = createMemorySessionStore();
    const result = await refreshSession(store, "invalid-token", {
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
    }
  });

  it("after revoke, refresh returns invalid_grant", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    await revokeSession(store, created.sessionId);
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("replay detection: reusing old refresh token revokes family and returns replay error", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "user-1" },
      { secret: SECRET }
    );
    const first = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("accessToken" in first).toBe(true);
    const oldRefresh = created.refreshToken;
    const reused = await refreshSession(store, oldRefresh, { secret: SECRET });
    expect("error" in reused).toBe(true);
    if ("error" in reused && "replayDetected" in reused) {
      expect(reused.replayDetected).toBe(true);
    }
    const newRefresh =
      "refreshToken" in first ? (first as { refreshToken: string }).refreshToken : "";
    const afterReplay = await refreshSession(store, newRefresh, {
      secret: SECRET,
    });
    expect("error" in afterReplay).toBe(true);
  });
});

describe("refreshSession device binding", () => {
  it("refresh succeeds when session has no device fingerprint (optional)", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("accessToken" in result).toBe(true);
    const created2 = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    const result2 = await refreshSession(store, created2.refreshToken, {
      secret: SECRET,
      deviceFingerprint: "any",
    });
    expect("accessToken" in result2).toBe(true);
  });

  it("refresh succeeds when session has fingerprint and current matches", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u", deviceFingerprint: "device-A" },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
      deviceFingerprint: "device-A",
    });
    expect("accessToken" in result).toBe(true);
  });

  it("refresh succeeds when fingerprint matches after trim", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u", deviceFingerprint: "  device-A  " },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
      deviceFingerprint: "device-A",
    });
    expect("accessToken" in result).toBe(true);
  });

  it("refresh returns invalid_grant when session has fingerprint but current is missing", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u", deviceFingerprint: "device-A" },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
      expect((result as { error_description?: string }).error_description).toBe(
        "Device binding validation failed"
      );
    }
  });

  it("refresh returns invalid_grant when session has fingerprint but current does not match", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u", deviceFingerprint: "device-A" },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
      deviceFingerprint: "device-B",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("refresh succeeds with skipDeviceBinding when fingerprint does not match", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u", deviceFingerprint: "device-A" },
      { secret: SECRET }
    );
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
      deviceFingerprint: "device-B",
      skipDeviceBinding: true,
    });
    expect("accessToken" in result).toBe(true);
  });
});

describe("revokeSession", () => {
  it("revokes session so refresh no longer works", async () => {
    const store = createMemorySessionStore();
    const created = await createSession(
      store,
      { userId: "u" },
      { secret: SECRET }
    );
    await revokeSession(store, created.sessionId);
    const result = await refreshSession(store, created.refreshToken, {
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
  });
});

describe("revokeAllSessionsForUser", () => {
  it("returns list of revoked session ids and invalidates all sessions for user", async () => {
    const store = createMemorySessionStore();
    const a = await createSession(
      store,
      { userId: "user-1" },
      { secret: SECRET }
    );
    const b = await createSession(
      store,
      { userId: "user-1" },
      { secret: SECRET }
    );
    const ids = await revokeAllSessionsForUser(store, "user-1");
    expect(ids).toContain(a.sessionId);
    expect(ids).toContain(b.sessionId);
    expect(ids.length).toBe(2);
    const refA = await refreshSession(store, a.refreshToken, { secret: SECRET });
    const refB = await refreshSession(store, b.refreshToken, { secret: SECRET });
    expect("error" in refA).toBe(true);
    expect("error" in refB).toBe(true);
  });
});

describe("createMemorySessionStore", () => {
  it("implements SessionStore and supports createSession returning sessionId", async () => {
    const store = createMemorySessionStore();
    const result = await createSession(
      store,
      { userId: "u", orgId: null },
      { secret: SECRET }
    );
    expect(result.sessionId).toBeDefined();
    const payload = verifyAccessToken(result.accessToken, SECRET);
    expect(payload?.session_id).toBe(result.sessionId);
  });
});
