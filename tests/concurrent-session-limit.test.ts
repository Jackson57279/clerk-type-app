import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkCanCreateSession,
  registerSession,
  removeSession,
  getActiveCountByUser,
  getActiveCountByOrg,
  createConcurrentSessionLimit,
  clearAllSessions,
} from "../src/concurrent-session-limit.js";

describe("concurrent session limit (default 5 per user)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first session under user limit", () => {
    const r = checkCanCreateSession("u1", null, { user: 5 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual([]);
  });

  it("allows up to 5 sessions per user when limit is 5", () => {
    const userId = "u1";
    for (let i = 0; i < 5; i++) {
      registerSession(`s${i}`, userId, null);
    }
    expect(getActiveCountByUser(userId)).toBe(5);
    const r = checkCanCreateSession(userId, null, { user: 5 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
    expect(r.evictSessionIds[0]).toBe("s0");
  });

  it("returns oldest session to evict when over user limit", () => {
    const userId = "u1";
    registerSession("s0", userId, null);
    vi.advanceTimersByTime(100);
    registerSession("s1", userId, null);
    vi.advanceTimersByTime(100);
    registerSession("s2", userId, null);
    const r = checkCanCreateSession(userId, null, { user: 3 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual(["s0"]);
  });

  it("after evicting and removing, new session is under limit", () => {
    const userId = "u1";
    registerSession("s0", userId, null);
    registerSession("s1", userId, null);
    registerSession("s2", userId, null);
    let r = checkCanCreateSession(userId, null, { user: 3 });
    expect(r.evictSessionIds).toContain("s0");
    removeSession("s0");
    r = checkCanCreateSession(userId, null, { user: 3 });
    expect(r.evictSessionIds).toEqual([]);
  });

  it("tracks users independently", () => {
    registerSession("s0", "u1", null);
    registerSession("s1", "u1", null);
    registerSession("s2", "u2", null);
    expect(getActiveCountByUser("u1")).toBe(2);
    expect(getActiveCountByUser("u2")).toBe(1);
    const r1 = checkCanCreateSession("u1", null, { user: 2 });
    const r2 = checkCanCreateSession("u2", null, { user: 2 });
    expect(r1.allowed).toBe(true);
    expect(r1.evictSessionIds).toHaveLength(1);
    expect(r2.allowed).toBe(true);
    expect(r2.evictSessionIds).toEqual([]);
  });

  it("returns allowed false when user limit is 0", () => {
    const r = checkCanCreateSession("u1", null, { user: 0 });
    expect(r.allowed).toBe(false);
    expect(r.evictSessionIds).toEqual([]);
  });

  it("enforces org limit when orgId provided", () => {
    const orgId = "org1";
    registerSession("s0", "u1", orgId);
    registerSession("s1", "u2", orgId);
    registerSession("s2", "u3", orgId);
    expect(getActiveCountByOrg(orgId)).toBe(3);
    const r = checkCanCreateSession("u4", orgId, { user: 10, org: 3 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
  });

  it("returns allowed false when org limit is 0", () => {
    const r = checkCanCreateSession("u1", "org1", { user: 5, org: 0 });
    expect(r.allowed).toBe(false);
    expect(r.evictSessionIds).toEqual([]);
  });

  it("evicts oldest across user and org when both over limit", () => {
    const orgId = "org1";
    registerSession("s0", "u1", orgId);
    vi.advanceTimersByTime(10);
    registerSession("s1", "u1", orgId);
    vi.advanceTimersByTime(10);
    registerSession("s2", "u1", orgId);
    const r = checkCanCreateSession("u1", orgId, { user: 3, org: 3 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toContain("s0");
  });

  it("removeSession decreases count", () => {
    registerSession("s0", "u1", null);
    registerSession("s1", "u1", null);
    expect(getActiveCountByUser("u1")).toBe(2);
    removeSession("s0");
    expect(getActiveCountByUser("u1")).toBe(1);
  });

  it("limit 1 allows only one active session per user (evict oldest)", () => {
    const userId = "u1";
    registerSession("s0", userId, null);
    const r = checkCanCreateSession(userId, null, { user: 1 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual(["s0"]);
  });
});

describe("createConcurrentSessionLimit (custom defaults)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom default user limit", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    limiter.register("s1", "u1", null);
    const r = limiter.check("u1", null, {});
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
  });

  it("per-call limits override defaults", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    const r = limiter.check("u1", null, { user: 5 });
    expect(r.evictSessionIds).toEqual([]);
  });

  it("isolated store per factory instance", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    expect(limiter.getActiveCountByUser("u1")).toBe(1);
    expect(getActiveCountByUser("u1")).toBe(0);
  });

  it("custom default org limit", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 10,
      defaultOrgLimit: 2,
    });
    limiter.register("s0", "u1", "org1");
    limiter.register("s1", "u2", "org1");
    const r = limiter.check("u3", "org1", {});
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
  });
});
