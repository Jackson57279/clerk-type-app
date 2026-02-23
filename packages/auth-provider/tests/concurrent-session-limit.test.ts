import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkCanCreateSession,
  registerSession,
  removeSession,
  getActiveCountByUser,
  getActiveCountByOrg,
  createConcurrentSessionLimit,
  createLimitsResolver,
  getConcurrentSessionLimitDefaults,
  clearAllSessions,
  invalidateAllSessionsForUser,
  enforceConcurrentLimitAndRegister,
  regenerateSessionIdAndEnforceLimit,
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

describe("enforceConcurrentLimitAndRegister", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers new session when under limit", () => {
    const r = enforceConcurrentLimitAndRegister("s1", "u1", null, { user: 5 });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual([]);
    expect(getActiveCountByUser("u1")).toBe(1);
  });

  it("evicts oldest and registers new session when over limit", () => {
    registerSession("s0", "u1", null);
    vi.advanceTimersByTime(100);
    registerSession("s1", "u1", null);
    const evicted: string[] = [];
    const r = enforceConcurrentLimitAndRegister("s2", "u1", null, { user: 2 }, {
      onEvict: (ids) => evicted.push(...ids),
    });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual(["s0"]);
    expect(evicted).toEqual(["s0"]);
    expect(getActiveCountByUser("u1")).toBe(2);
  });

  it("returns allowed false when user limit is 0", () => {
    const r = enforceConcurrentLimitAndRegister("s1", "u1", null, { user: 0 });
    expect(r.allowed).toBe(false);
    expect(getActiveCountByUser("u1")).toBe(0);
  });
});

describe("regenerateSessionIdAndEnforceLimit (session fixation prevention)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns new session ID different from old (prevents fixation)", () => {
    const oldId = "fixated-session-123";
    const newId = regenerateSessionIdAndEnforceLimit(
      oldId,
      "u1",
      null,
      { user: 5 }
    );
    expect(newId).not.toBe(oldId);
    expect(newId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("removes old session and registers new one", () => {
    registerSession("pre-existing", "u2", null);
    const oldId = "old-sess";
    registerSession(oldId, "u1", null);
    const newId = regenerateSessionIdAndEnforceLimit(
      oldId,
      "u1",
      null,
      { user: 5 }
    );
    expect(newId).not.toBe(oldId);
    expect(getActiveCountByUser("u1")).toBe(1);
    expect(getActiveCountByUser("u2")).toBe(1);
  });

  it("enforces concurrent limit after regeneration", () => {
    registerSession("s0", "u1", null);
    vi.advanceTimersByTime(100);
    registerSession("s1", "u1", null);
    const evicted: string[] = [];
    const newId = regenerateSessionIdAndEnforceLimit(
      "fixated",
      "u1",
      null,
      { user: 2 },
      { onEvict: (ids) => evicted.push(...ids) }
    );
    expect(newId).toMatch(/^[a-f0-9]{64}$/);
    expect(getActiveCountByUser("u1")).toBe(1);
    expect(evicted).toContain("s0");
    expect(evicted).toContain("s1");
  });
});

describe("invalidateAllSessionsForUser (remote logout)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns and removes all session ids for the given user", () => {
    registerSession("s0", "u1", null);
    registerSession("s1", "u1", null);
    registerSession("s2", "u2", null);
    const revoked = invalidateAllSessionsForUser("u1");
    expect(revoked).toHaveLength(2);
    expect(revoked).toContain("s0");
    expect(revoked).toContain("s1");
    expect(getActiveCountByUser("u1")).toBe(0);
    expect(getActiveCountByUser("u2")).toBe(1);
  });

  it("returns empty array when user has no sessions", () => {
    const revoked = invalidateAllSessionsForUser("u1");
    expect(revoked).toEqual([]);
  });

  it("leaves other users sessions intact", () => {
    registerSession("s0", "u1", null);
    registerSession("s1", "u2", null);
    registerSession("s2", "u2", null);
    invalidateAllSessionsForUser("u1");
    expect(getActiveCountByUser("u2")).toBe(2);
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

  it("invalidateAllSessionsForUser revokes all sessions for user in isolated store", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 5 });
    limiter.register("s0", "u1", null);
    limiter.register("s1", "u1", null);
    limiter.register("s2", "u2", null);
    const revoked = limiter.invalidateAllSessionsForUser("u1");
    expect(revoked).toHaveLength(2);
    expect(revoked).toContain("s0");
    expect(revoked).toContain("s1");
    expect(limiter.getActiveCountByUser("u1")).toBe(0);
    expect(limiter.getActiveCountByUser("u2")).toBe(1);
  });

  it("regenerateAndEnforce returns new session ID and enforces limit", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    vi.advanceTimersByTime(100);
    limiter.register("s1", "u1", null);
    const newId = limiter.regenerateAndEnforce("fixated-id", "u1", null);
    expect(newId).not.toBe("fixated-id");
    expect(newId).toMatch(/^[a-f0-9]{64}$/);
    expect(limiter.getActiveCountByUser("u1")).toBe(2);
  });

  it("enforceAndRegister uses resolved limits and evicts then registers", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    vi.advanceTimersByTime(100);
    limiter.register("s1", "u1", null);
    const evicted: string[] = [];
    const r = limiter.enforceAndRegister("s2", "u1", null, undefined, {
      onEvict: (ids) => evicted.push(...ids),
    });
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toContain("s0");
    expect(evicted).toEqual(["s0"]);
    expect(limiter.getActiveCountByUser("u1")).toBe(2);
  });

  it("enforceAndRegister returns allowed false when limit is 0", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 5 });
    const r = limiter.enforceAndRegister("s1", "u1", null, { user: 0 });
    expect(r.allowed).toBe(false);
    expect(limiter.getActiveCountByUser("u1")).toBe(0);
  });
});

describe("createConcurrentSessionLimit (getLimits per user/org)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses per-user limit from getLimits", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 5,
      getLimits: (userId) =>
        userId === "premium" ? { user: 10 } : { user: 2 },
    });
    limiter.register("s0", "free", null);
    limiter.register("s1", "free", null);
    const rFree = limiter.check("free", null);
    expect(rFree.allowed).toBe(true);
    expect(rFree.evictSessionIds).toHaveLength(1);

    for (let i = 0; i < 10; i++) limiter.register(`p${i}`, "premium", null);
    const rPremium = limiter.check("premium", null);
    expect(rPremium.allowed).toBe(true);
    expect(rPremium.evictSessionIds).toHaveLength(1);
  });

  it("uses per-org limit from getLimits", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 10,
      defaultOrgLimit: 5,
      getLimits: (_userId, orgId) =>
        orgId === "enterprise" ? { user: 10, org: 20 } : { user: 10, org: 2 },
    });
    limiter.register("s0", "u1", "small");
    limiter.register("s1", "u2", "small");
    const rSmall = limiter.check("u3", "small");
    expect(rSmall.allowed).toBe(true);
    expect(rSmall.evictSessionIds).toHaveLength(1);

    limiter.register("e0", "u1", "enterprise");
    limiter.register("e1", "u2", "enterprise");
    const rEnt = limiter.check("u3", "enterprise");
    expect(rEnt.allowed).toBe(true);
    expect(rEnt.evictSessionIds).toEqual([]);
  });

  it("call-site limits override getLimits", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 5,
      getLimits: () => ({ user: 2 }),
    });
    limiter.register("s0", "u1", null);
    const r = limiter.check("u1", null, { user: 10 });
    expect(r.evictSessionIds).toEqual([]);
  });

  it("works without getLimits (limits optional)", () => {
    const limiter = createConcurrentSessionLimit({ defaultUserLimit: 2 });
    limiter.register("s0", "u1", null);
    limiter.register("s1", "u1", null);
    const r = limiter.check("u1", null);
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
  });

  it("returns allowed false when getLimits resolves user limit to 0", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 5,
      getLimits: (userId) => (userId === "blocked" ? { user: 0 } : {}),
    });
    const r = limiter.check("blocked", null);
    expect(r.allowed).toBe(false);
    expect(r.evictSessionIds).toEqual([]);
  });

  it("enforceAndRegister uses getLimits for per-user limit", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 5,
      getLimits: (userId) => (userId === "premium" ? { user: 3 } : { user: 1 }),
    });
    limiter.register("s0", "free", null);
    const r = limiter.enforceAndRegister("s1", "free", null);
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toEqual(["s0"]);
    expect(limiter.getActiveCountByUser("free")).toBe(1);

    limiter.register("p0", "premium", null);
    limiter.register("p1", "premium", null);
    const r2 = limiter.enforceAndRegister("p2", "premium", null);
    expect(r2.allowed).toBe(true);
    expect(r2.evictSessionIds).toEqual([]);
    expect(limiter.getActiveCountByUser("premium")).toBe(3);
  });

  it("enforceAndRegister uses getLimits for per-org limit", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 10,
      defaultOrgLimit: 2,
      getLimits: (_u, orgId) =>
        orgId === "enterprise" ? { user: 10, org: 5 } : { user: 10, org: 2 },
    });
    limiter.register("s0", "u1", "small");
    limiter.register("s1", "u2", "small");
    const r = limiter.enforceAndRegister("s2", "u3", "small");
    expect(r.allowed).toBe(true);
    expect(r.evictSessionIds).toHaveLength(1);
    expect(limiter.getActiveCountByOrg("small")).toBe(2);

    limiter.register("e0", "u1", "enterprise");
    limiter.register("e1", "u2", "enterprise");
    limiter.register("e2", "u3", "enterprise");
    const r2 = limiter.enforceAndRegister("e3", "u4", "enterprise");
    expect(r2.allowed).toBe(true);
    expect(r2.evictSessionIds).toEqual([]);
    expect(limiter.getActiveCountByOrg("enterprise")).toBe(4);
  });
});

describe("getConcurrentSessionLimitDefaults (configurable via env)", () => {
  it("returns default user limit 5 when env not set", () => {
    const out = getConcurrentSessionLimitDefaults({});
    expect(out.defaultUserLimit).toBe(5);
    expect(out.defaultOrgLimit).toBeUndefined();
  });

  it("uses CONCURRENT_SESSION_LIMIT_USER when valid integer", () => {
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "3" }).defaultUserLimit).toBe(3);
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "1" }).defaultUserLimit).toBe(1);
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "1000" }).defaultUserLimit).toBe(1000);
  });

  it("uses CONCURRENT_SESSION_LIMIT_ORG when valid integer", () => {
    const out = getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_ORG: "10" });
    expect(out.defaultOrgLimit).toBe(10);
  });

  it("allows 0 for user and org (no new sessions)", () => {
    const userZero = getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "0" });
    expect(userZero.defaultUserLimit).toBe(0);
    const orgZero = getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_ORG: "0" });
    expect(orgZero.defaultOrgLimit).toBe(0);
  });

  it("falls back to default when env invalid or out of range", () => {
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "" }).defaultUserLimit).toBe(5);
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "abc" }).defaultUserLimit).toBe(5);
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "1001" }).defaultUserLimit).toBe(5);
    expect(getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_ORG: "-1" }).defaultOrgLimit).toBeUndefined();
  });

  it("createConcurrentSessionLimit with env user 0 blocks new sessions", () => {
    const defaults = getConcurrentSessionLimitDefaults({ CONCURRENT_SESSION_LIMIT_USER: "0" });
    const limiter = createConcurrentSessionLimit(defaults);
    const r = limiter.check("u1", null);
    expect(r.allowed).toBe(false);
    expect(r.evictSessionIds).toEqual([]);
  });

  it("createConcurrentSessionLimit with env defaults and getLimits gives per user/org configurable limits", () => {
    const defaults = getConcurrentSessionLimitDefaults({
      CONCURRENT_SESSION_LIMIT_USER: "2",
      CONCURRENT_SESSION_LIMIT_ORG: "2",
    });
    const limiter = createConcurrentSessionLimit({
      ...defaults,
      getLimits: (userId, orgId) => {
        if (userId === "vip") return { user: 5, org: 10 };
        if (orgId === "large-org") return { user: 2, org: 20 };
        return {};
      },
    });
    limiter.register("s0", "normal", "small");
    limiter.register("s1", "normal", "small");
    const rNormal = limiter.check("normal", "small");
    expect(rNormal.allowed).toBe(true);
    expect(rNormal.evictSessionIds).toHaveLength(1);

    for (let i = 0; i < 5; i++) limiter.register(`v${i}`, "vip", null);
    const rVip = limiter.check("vip", null);
    expect(rVip.allowed).toBe(true);
    expect(rVip.evictSessionIds).toHaveLength(1);

    limiter.register("e0", "u1", "large-org");
    limiter.register("e1", "u2", "large-org");
    const rLarge = limiter.check("u3", "large-org");
    expect(rLarge.allowed).toBe(true);
    expect(rLarge.evictSessionIds).toEqual([]);
  });
});

describe("createLimitsResolver (configurable per user/org)", () => {
  it("returns default user and org limits when no getters", () => {
    const resolve = createLimitsResolver({
      defaultUserLimit: 3,
      defaultOrgLimit: 2,
    });
    expect(resolve("u1", null)).toEqual({ user: 3 });
    expect(resolve("u1", "org1")).toEqual({ user: 3, org: 2 });
  });

  it("uses getUserLimit for per-user override", () => {
    const resolve = createLimitsResolver({
      defaultUserLimit: 2,
      getUserLimit: (userId) => (userId === "vip" ? 10 : undefined),
    });
    expect(resolve("normal", null)).toEqual({ user: 2 });
    expect(resolve("vip", null)).toEqual({ user: 10 });
  });

  it("uses getOrgLimit for per-org override", () => {
    const resolve = createLimitsResolver({
      defaultUserLimit: 5,
      defaultOrgLimit: 2,
      getOrgLimit: (orgId) => (orgId === "enterprise" ? 50 : undefined),
    });
    expect(resolve("u1", "small")).toEqual({ user: 5, org: 2 });
    expect(resolve("u1", "enterprise")).toEqual({ user: 5, org: 50 });
  });

  it("combines per-user and per-org in single resolver", () => {
    const resolve = createLimitsResolver({
      defaultUserLimit: 2,
      defaultOrgLimit: 3,
      getUserLimit: (userId) => (userId === "premium" ? 5 : undefined),
      getOrgLimit: (orgId) => (orgId === "large" ? 20 : undefined),
    });
    expect(resolve("free", "small")).toEqual({ user: 2, org: 3 });
    expect(resolve("premium", "small")).toEqual({ user: 5, org: 3 });
    expect(resolve("free", "large")).toEqual({ user: 2, org: 20 });
    expect(resolve("premium", "large")).toEqual({ user: 5, org: 20 });
  });

  it("works with createConcurrentSessionLimit for configurable per user/org", () => {
    const limiter = createConcurrentSessionLimit({
      defaultUserLimit: 2,
      defaultOrgLimit: 2,
      getLimits: createLimitsResolver({
        defaultUserLimit: 2,
        defaultOrgLimit: 2,
        getUserLimit: (id) => (id === "vip" ? 5 : undefined),
        getOrgLimit: (id) => (id === "enterprise" ? 10 : undefined),
      }),
    });
    limiter.register("s0", "normal", "small");
    limiter.register("s1", "normal", "small");
    const rNormal = limiter.check("normal", "small");
    expect(rNormal.allowed).toBe(true);
    expect(rNormal.evictSessionIds).toHaveLength(1);

    for (let i = 0; i < 5; i++) limiter.register(`v${i}`, "vip", null);
    const rVip = limiter.check("vip", null);
    expect(rVip.allowed).toBe(true);
    expect(rVip.evictSessionIds).toHaveLength(1);

    for (let i = 0; i < 10; i++) limiter.register(`e${i}`, `u${i}`, "enterprise");
    const rEnt = limiter.check("u10", "enterprise");
    expect(rEnt.allowed).toBe(true);
    expect(rEnt.evictSessionIds).toHaveLength(1);
  });
});
