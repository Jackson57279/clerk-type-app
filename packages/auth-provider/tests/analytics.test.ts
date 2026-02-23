import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import {
  getAnalyticsMetrics,
  analyticsToCsv,
  analyticsToJson,
  type AnalyticsMetrics,
  type AnalyticsDateRange,
} from "../src/analytics.js";

function createMockPool(overrides: Partial<{
  dau: number;
  mau: number;
  signUps: number;
  loginSuccess: number;
  loginFailure: number;
  passwordResets: number;
  mfaCount: number;
  totalUsers: number;
  avgSessionMs: number | null;
  userAgents: (string | null)[];
}> = {}): Pool {
  const {
    dau = 2,
    mau = 10,
    signUps = 3,
    loginSuccess = 50,
    loginFailure = 1,
    passwordResets = 0,
    mfaCount = 4,
    totalUsers = 20,
    avgSessionMs = 3600000,
    userAgents = ["Mozilla/5.0 Chrome/120.0", "Mozilla/5.0 Firefox/121.0"],
  } = overrides;

  let distinctActorCallCount = 0;
  let auditCountCallIndex = 0;
  const query = async (text: string): Promise<{ rows: unknown[] }> => {
    if (text.includes("COUNT(DISTINCT actor_id)")) {
      distinctActorCallCount++;
      return { rows: [{ count: distinctActorCallCount === 1 ? String(dau) : String(mau) }] };
    }
    if (text.includes("FROM users") && text.includes("created_at >=")) return { rows: [{ count: String(signUps) }] };
    if (text.includes("audit_logs") && text.includes("COUNT(*)")) {
      auditCountCallIndex++;
      if (auditCountCallIndex === 1) return { rows: [{ count: String(loginSuccess) }] };
      if (auditCountCallIndex === 2) return { rows: [{ count: String(loginFailure) }] };
      if (auditCountCallIndex === 3) return { rows: [{ count: String(passwordResets) }] };
    }
    if (text.includes("mfa_enabled = true")) return { rows: [{ mfa_count: String(mfaCount), total: String(totalUsers) }] };
    if (text.includes("sessions") && text.includes("AVG")) return { rows: [{ avg_ms: avgSessionMs != null ? String(avgSessionMs) : null }] };
    if (text.includes("user_agent FROM audit_logs")) {
      return { rows: userAgents.map((ua) => ({ user_agent: ua })) };
    }
    return { rows: [] };
  };

  const mockPool = {
    query: query as Pool["query"],
    connect: () => Promise.resolve(null),
    on: () => mockPool,
    end: () => Promise.resolve(),
  } as unknown as Pool;
  return mockPool;
}

describe("getAnalyticsMetrics", () => {
  const dateRange: AnalyticsDateRange = {
    from: new Date("2025-01-01T00:00:00Z"),
    to: new Date("2025-01-31T23:59:59Z"),
  };

  it("returns metrics from pool queries", async () => {
    const pool = createMockPool({
      dau: 5,
      mau: 100,
      signUps: 10,
      loginSuccess: 200,
      loginFailure: 3,
      passwordResets: 2,
      mfaCount: 30,
      totalUsers: 50,
      avgSessionMs: 7200000,
      userAgents: ["Chrome/120.0", "Firefox/121.0", "Chrome/119.0"],
    });
    const metrics = await getAnalyticsMetrics({ pool, dateRange });
    expect(metrics.dau).toBe(5);
    expect(metrics.mau).toBe(100);
    expect(metrics.signUps).toBe(10);
    expect(metrics.loginSuccessCount).toBe(200);
    expect(metrics.loginFailureCount).toBe(3);
    expect(metrics.mfaAdoptionRate).toBe(30 / 50);
    expect(metrics.passwordResetRequests).toBe(2);
    expect(metrics.avgSessionDurationMs).toBe(7200000);
    expect(metrics.deviceBrowserBreakdown).toEqual([
      { label: "Chrome", count: 2 },
      { label: "Firefox", count: 1 },
    ]);
  });

  it("returns zero mfaAdoptionRate when no users", async () => {
    const pool = createMockPool({ totalUsers: 0, mfaCount: 0 });
    const metrics = await getAnalyticsMetrics({ pool, dateRange });
    expect(metrics.mfaAdoptionRate).toBe(0);
  });

  it("returns null avgSessionDurationMs when no sessions", async () => {
    const pool = createMockPool({ avgSessionMs: null });
    const metrics = await getAnalyticsMetrics({ pool, dateRange });
    expect(metrics.avgSessionDurationMs).toBeNull();
  });

  it("accepts organizationId filter", async () => {
    const pool = createMockPool({ mau: 7 });
    const metrics = await getAnalyticsMetrics({
      pool,
      dateRange,
      organizationId: "org-123",
    });
    expect(metrics.mau).toBe(7);
  });
});

describe("analyticsToCsv", () => {
  it("serializes metrics to CSV with header", () => {
    const metrics: AnalyticsMetrics = {
      dau: 1,
      mau: 5,
      signUps: 2,
      loginSuccessCount: 10,
      loginFailureCount: 0,
      mfaAdoptionRate: 0.5,
      passwordResetRequests: 1,
      avgSessionDurationMs: 300000,
      deviceBrowserBreakdown: [{ label: "Chrome", count: 3 }],
    };
    const csv = analyticsToCsv(metrics);
    expect(csv).toContain("metric,value");
    expect(csv).toContain("dau,1");
    expect(csv).toContain("mau,5");
    expect(csv).toContain("device_browser_Chrome,3");
    expect(csv).toContain("avg_session_duration_ms,300000");
  });

  it("omits avg_session_duration_ms value when null", () => {
    const metrics: AnalyticsMetrics = {
      dau: 0,
      mau: 0,
      signUps: 0,
      loginSuccessCount: 0,
      loginFailureCount: 0,
      mfaAdoptionRate: 0,
      passwordResetRequests: 0,
      avgSessionDurationMs: null,
      deviceBrowserBreakdown: [],
    };
    const csv = analyticsToCsv(metrics);
    expect(csv).toContain("avg_session_duration_ms,");
  });
});

describe("analyticsToJson", () => {
  it("serializes metrics to formatted JSON", () => {
    const metrics: AnalyticsMetrics = {
      dau: 2,
      mau: 20,
      signUps: 1,
      loginSuccessCount: 5,
      loginFailureCount: 0,
      mfaAdoptionRate: 0.25,
      passwordResetRequests: 0,
      avgSessionDurationMs: null,
      deviceBrowserBreakdown: [{ label: "Safari", count: 1 }],
    };
    const json = analyticsToJson(metrics);
    const parsed = JSON.parse(json) as AnalyticsMetrics;
    expect(parsed.dau).toBe(2);
    expect(parsed.mau).toBe(20);
    expect(parsed.deviceBrowserBreakdown).toEqual([{ label: "Safari", count: 1 }]);
  });
});
