import { randomBytes } from "crypto";

export const AUDIT_EVENT_TYPES = {
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  USER_PASSWORD_CHANGE: "user.password_change",
  USER_MFA_SETUP: "user.mfa_setup",
  ADMIN_USER_CREATED: "admin.user_created",
  ADMIN_USER_DELETED: "admin.user_deleted",
  ADMIN_ROLE_CHANGED: "admin.role_changed",
  ORG_MEMBER_ADDED: "org.member_added",
  ORG_MEMBER_REMOVED: "org.member_removed",
  ORG_SSO_CONFIG_CHANGED: "org.sso_config_changed",
  SECURITY_SUSPICIOUS_LOGIN: "security.suspicious_login",
  SECURITY_MFA_CHALLENGE_FAILED: "security.mfa_challenge_failed",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

export interface AuditEventInput {
  eventType: AuditEventType;
  actorType?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditEventRecord extends AuditEventInput {
  eventId: string;
}

export interface AuditLogStore {
  append(event: AuditEventRecord): Promise<void>;
}

const EVENT_ID_PREFIX = "evt_";
const EVENT_ID_BYTES = 16;

export function generateEventId(): string {
  return EVENT_ID_PREFIX + randomBytes(EVENT_ID_BYTES).toString("hex");
}

export async function createAuditEvent(
  store: AuditLogStore,
  input: AuditEventInput
): Promise<void> {
  const eventId = generateEventId();
  const record: AuditEventRecord = {
    ...input,
    eventId,
  };
  await store.append(record);
}
