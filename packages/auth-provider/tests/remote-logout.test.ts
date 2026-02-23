import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  invalidateAllSessions,
  createDefaultRemoteLogoutStore,
  remoteLogout,
  handleRemoteLogoutEndpoint,
  type RemoteLogoutStore,
} from "../src/remote-logout.js";
import {
  registerSession,
  clearAllSessions,
  getActiveCountByUser,
} from "../src/concurrent-session-limit.js";

describe("invalidateAllSessions", () => {
  it("calls store and returns invalidated session ids and count", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser(userId: string) {
        return userId === "u1" ? ["s1", "s2", "s3"] : [];
      },
    };
    const result = invalidateAllSessions("u1", store);
    expect(result.invalidatedSessionIds).toEqual(["s1", "s2", "s3"]);
    expect(result.invalidatedCount).toBe(3);
  });

  it("returns empty list when store returns no sessions", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser() {
        return [];
      },
    };
    const result = invalidateAllSessions("u1", store);
    expect(result.invalidatedSessionIds).toEqual([]);
    expect(result.invalidatedCount).toBe(0);
  });
});

describe("remoteLogout", () => {
  it("invalidates all sessions for the requested user", () => {
    const calls: string[] = [];
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser(userId: string) {
        calls.push(userId);
        return ["s1", "s2"];
      },
    };
    const result = remoteLogout({ userId: "u1" }, store);
    expect(calls).toEqual(["u1"]);
    expect(result.invalidatedSessionIds).toEqual(["s1", "s2"]);
    expect(result.invalidatedCount).toBe(2);
  });
});

describe("createDefaultRemoteLogoutStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates all in-memory sessions for the user", () => {
    registerSession("s0", "u1", null);
    registerSession("s1", "u1", null);
    registerSession("s2", "u2", null);
    const store = createDefaultRemoteLogoutStore();
    const result = invalidateAllSessions("u1", store);
    expect(result.invalidatedCount).toBe(2);
    expect(result.invalidatedSessionIds).toContain("s0");
    expect(result.invalidatedSessionIds).toContain("s1");
    expect(getActiveCountByUser("u1")).toBe(0);
    expect(getActiveCountByUser("u2")).toBe(1);
  });

  it("returns empty when user has no sessions", () => {
    const store = createDefaultRemoteLogoutStore();
    const result = invalidateAllSessions("u1", store);
    expect(result.invalidatedSessionIds).toEqual([]);
    expect(result.invalidatedCount).toBe(0);
  });

  it("returns JSON-serializable response suitable for HTTP endpoint", () => {
    registerSession("s1", "u1", null);
    const store = createDefaultRemoteLogoutStore();
    const result = remoteLogout({ userId: "u1" }, store);
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as typeof result;
    expect(parsed).toEqual({ invalidatedSessionIds: ["s1"], invalidatedCount: 1 });
    expect(Object.keys(parsed).sort()).toEqual(["invalidatedCount", "invalidatedSessionIds"]);
  });
});

describe("handleRemoteLogoutEndpoint", () => {
  it("returns 200 and invalidated sessions when userId is provided", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser(userId: string) {
        return userId === "u1" ? ["s1", "s2"] : [];
      },
    };
    const result = handleRemoteLogoutEndpoint(
      { userId: "u1" },
      { store }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.invalidatedSessionIds).toEqual(["s1", "s2"]);
      expect(result.body.invalidatedCount).toBe(2);
    }
  });

  it("returns 400 when userId is missing", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser() {
        return [];
      },
    };
    const result = handleRemoteLogoutEndpoint(
      { userId: "" },
      { store }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.body.error).toBe("invalid_request");
      expect(result.body.error_description).toBe("userId is required");
    }
  });

  it("returns 400 when userId is undefined", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser() {
        return [];
      },
    };
    const result = handleRemoteLogoutEndpoint(
      { userId: undefined } as unknown as { userId: string },
      { store }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.body.error).toBe("invalid_request");
    }
  });

  it("returns 400 when userId is whitespace only", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser() {
        return [];
      },
    };
    const result = handleRemoteLogoutEndpoint(
      { userId: "   " },
      { store }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.body.error).toBe("invalid_request");
    }
  });

  it("returns 200 with empty list when user has no sessions", () => {
    const store: RemoteLogoutStore = {
      invalidateAllSessionsForUser() {
        return [];
      },
    };
    const result = handleRemoteLogoutEndpoint(
      { userId: "u99" },
      { store }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.invalidatedSessionIds).toEqual([]);
      expect(result.body.invalidatedCount).toBe(0);
    }
  });
});
