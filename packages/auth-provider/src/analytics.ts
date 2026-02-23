import type { Pool } from "pg";
import { AUDIT_EVENT_TYPES } from "./audit-log.js";

export interface AnalyticsDateRange {
  from: Date;
  to: Date;
}

export interface DeviceBrowserRow {
  label: string;
  count: number;
}

export interface AnalyticsMetrics {
  dau: number;
  mau: number;
  signUps: number;
  loginSuccessCount: number;
  loginFailureCount: number;
  mfaAdoptionRate: number;
  passwordResetRequests: number;
  avgSessionDurationMs: number | null;
  deviceBrowserBreakdown: DeviceBrowserRow[];
}

export interface GetAnalyticsOptions {
  pool: Pool;
  organizationId?: string | null;
  dateRange: AnalyticsDateRange;
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/Chrome\/[.0-9]+/.test(ua) && !/Edg/.test(ua)) return "Chrome";
  if (/Firefox\/[.0-9]+/.test(ua)) return "Firefox";
  if (/Safari\/[.0-9]+/.test(ua) && !/Chrome/.test(ua)) return "Safari";
  if (/Edg\/[.0-9]+/.test(ua)) return "Edge";
  if (/MSIE|Trident/.test(ua)) return "IE";
  return "Other";
}

export async function getAnalyticsMetrics(
  options: GetAnalyticsOptions
): Promise<AnalyticsMetrics> {
  const { pool, organizationId, dateRange } = options;
  const from = dateRange.from.toISOString();
  const to = dateRange.to.toISOString();

  const orgFilter = organizationId
    ? " AND (organization_id = $2 OR organization_id IS NULL)"
    : "";
  const params = organizationId ? [from, to, organizationId] : [from, to];

  const oneDayAgo = new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000);
  const dauFrom = oneDayAgo.toISOString();

  const [dauResult, mauResult, signUpsResult, loginResult, loginFailResult, pwdResetResult, mfaResult, sessionResult, uaResult] =
    await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT actor_id) AS count FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3
         AND actor_id IS NOT NULL${organizationId ? " AND (organization_id = $4 OR organization_id IS NULL)" : ""}`,
        organizationId ? [AUDIT_EVENT_TYPES.USER_LOGIN, dauFrom, to, organizationId] : [AUDIT_EVENT_TYPES.USER_LOGIN, dauFrom, to]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT actor_id) AS count FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3
         AND actor_id IS NOT NULL${orgFilter}`,
        [AUDIT_EVENT_TYPES.USER_LOGIN, from, to, ...params.slice(2)]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM users
         WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL`,
        [from, to]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3${orgFilter}`,
        [AUDIT_EVENT_TYPES.USER_LOGIN, from, to, ...params.slice(2)]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3${orgFilter}`,
        [AUDIT_EVENT_TYPES.USER_LOGIN_FAILED, from, to, ...params.slice(2)]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3${orgFilter}`,
        [AUDIT_EVENT_TYPES.USER_PASSWORD_RESET_REQUESTED, from, to, ...params.slice(2)]
      ),
      pool.query<{ mfa_count: string; total: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE mfa_enabled = true) AS mfa_count,
           COUNT(*) AS total
         FROM users WHERE deleted_at IS NULL`
      ),
      pool.query<{ avg_ms: string | null }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (last_active_at - created_at)) * 1000)::BIGINT AS avg_ms
         FROM sessions WHERE revoked_at IS NULL AND last_active_at > created_at`
      ),
      pool.query<{ user_agent: string | null }>(
        `SELECT user_agent FROM audit_logs
         WHERE event_type = $1 AND created_at >= $2 AND created_at < $3
         AND user_agent IS NOT NULL${orgFilter}`,
        [AUDIT_EVENT_TYPES.USER_LOGIN, from, to, ...params.slice(2)]
      ),
    ]);

  const dau = parseInt(dauResult.rows[0]?.count ?? "0", 10);
  const mau = parseInt(mauResult.rows[0]?.count ?? "0", 10);
  const signUps = parseInt(signUpsResult.rows[0]?.count ?? "0", 10);
  const loginSuccessCount = parseInt(loginResult.rows[0]?.count ?? "0", 10);
  const loginFailureCount = parseInt(loginFailResult.rows[0]?.count ?? "0", 10);
  const passwordResetRequests = parseInt(pwdResetResult.rows[0]?.count ?? "0", 10);
  const mfaRow = mfaResult.rows[0];
  const totalUsers = parseInt(mfaRow?.total ?? "0", 10);
  const mfaCount = parseInt(mfaRow?.mfa_count ?? "0", 10);
  const mfaAdoptionRate = totalUsers > 0 ? mfaCount / totalUsers : 0;
  const avgSessionDurationMs = sessionResult.rows[0]?.avg_ms != null
    ? parseInt(String(sessionResult.rows[0].avg_ms), 10)
    : null;
  const uaCounts: Record<string, number> = {};
  for (const row of uaResult.rows) {
    const label = parseUserAgent(row.user_agent);
    uaCounts[label] = (uaCounts[label] ?? 0) + 1;
  }
  const deviceBrowserBreakdown: DeviceBrowserRow[] = Object.entries(uaCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return {
    dau,
    mau,
    signUps,
    loginSuccessCount,
    loginFailureCount,
    mfaAdoptionRate,
    passwordResetRequests,
    avgSessionDurationMs,
    deviceBrowserBreakdown,
  };
}

export function analyticsToCsv(metrics: AnalyticsMetrics): string {
  const lines = [
    "metric,value",
    `dau,${metrics.dau}`,
    `mau,${metrics.mau}`,
    `sign_ups,${metrics.signUps}`,
    `login_success_count,${metrics.loginSuccessCount}`,
    `login_failure_count,${metrics.loginFailureCount}`,
    `mfa_adoption_rate,${metrics.mfaAdoptionRate}`,
    `password_reset_requests,${metrics.passwordResetRequests}`,
    `avg_session_duration_ms,${metrics.avgSessionDurationMs ?? ""}`,
  ];
  for (const row of metrics.deviceBrowserBreakdown) {
    lines.push(`device_browser_${row.label},${row.count}`);
  }
  return lines.join("\n");
}

export function analyticsToJson(metrics: AnalyticsMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
