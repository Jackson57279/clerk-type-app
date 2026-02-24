import { describe, it, expect } from "vitest";
import {
  createAuditEvent,
  generateEventId,
  AUDIT_EVENT_TYPES,
  type AuditLogStore,
  type AuditEventRecord,
  type AuditEventInput,
} from "../src/audit-log.js";

function memoryAuditStore(): { store: AuditLogStore; events: AuditEventRecord[] } {
  const events: AuditEventRecord[] = [];
  const store: AuditLogStore = {
    async append(event) {
      events.push({ ...event });
    },
  };
  return { store, events };
}

describe("generateEventId", () => {
  it("returns id with evt_ prefix and hex suffix", () => {
    const id = generateEventId();
    expect(id).toMatch(/^evt_[a-f0-9]{32}$/);
  });

  it("returns unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateEventId());
    expect(ids.size).toBe(50);
  });
});

describe("createAuditEvent", () => {
  it("appends event with generated event_id and all fields", async () => {
    const { store, events } = memoryAuditStore();
    const input: AuditEventInput = {
      eventType: AUDIT_EVENT_TYPES.USER_LOGIN,
      actorType: "user",
      actorId: "user_123",
      actorEmail: "u@example.com",
      targetType: "session",
      targetId: "sess_456",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      organizationId: "org_789",
      metadata: { method: "password", mfa_used: true },
    };
    await createAuditEvent(store, input);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.eventId).toMatch(/^evt_[a-f0-9]{32}$/);
    expect(ev.eventType).toBe(AUDIT_EVENT_TYPES.USER_LOGIN);
    expect(ev.actorType).toBe("user");
    expect(ev.actorId).toBe("user_123");
    expect(ev.actorEmail).toBe("u@example.com");
    expect(ev.targetType).toBe("session");
    expect(ev.targetId).toBe("sess_456");
    expect(ev.ipAddress).toBe("192.168.1.1");
    expect(ev.userAgent).toBe("Mozilla/5.0");
    expect(ev.organizationId).toBe("org_789");
    expect(ev.metadata).toEqual({ method: "password", mfa_used: true });
  });

  it("supports minimal input (eventType only)", async () => {
    const { store, events } = memoryAuditStore();
    await createAuditEvent(store, {
      eventType: AUDIT_EVENT_TYPES.SECURITY_MFA_CHALLENGE_FAILED,
    });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.eventType).toBe(AUDIT_EVENT_TYPES.SECURITY_MFA_CHALLENGE_FAILED);
    expect(ev.eventId).toMatch(/^evt_/);
    expect(ev.actorType).toBeUndefined();
    expect(ev.metadata).toBeUndefined();
  });

  it("logs multiple event types correctly", async () => {
    const { store, events } = memoryAuditStore();
    const types = [
      AUDIT_EVENT_TYPES.USER_LOGIN,
      AUDIT_EVENT_TYPES.USER_LOGOUT,
      AUDIT_EVENT_TYPES.USER_PASSWORD_CHANGE,
      AUDIT_EVENT_TYPES.ORG_MEMBER_ADDED,
      AUDIT_EVENT_TYPES.SECURITY_SUSPICIOUS_LOGIN,
    ];
    for (const eventType of types) {
      await createAuditEvent(store, { eventType });
    }
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.eventType)).toEqual(types);
    const ids = new Set(events.map((e) => e.eventId));
    expect(ids.size).toBe(5);
  });

  it("serializes metadata as passed", async () => {
    const { store, events } = memoryAuditStore();
    await createAuditEvent(store, {
      eventType: AUDIT_EVENT_TYPES.ADMIN_ROLE_CHANGED,
      metadata: { from_role: "member", to_role: "admin" },
    });
    expect(events[0]!.metadata).toEqual({ from_role: "member", to_role: "admin" });
  });
});

describe("AUDIT_EVENT_TYPES", () => {
  it("includes all PRD event categories", () => {
    expect(AUDIT_EVENT_TYPES.USER_LOGIN).toBe("user.login");
    expect(AUDIT_EVENT_TYPES.USER_LOGIN_FAILED).toBe("user.login_failed");
    expect(AUDIT_EVENT_TYPES.USER_LOGOUT).toBe("user.logout");
    expect(AUDIT_EVENT_TYPES.USER_PASSWORD_RESET_REQUESTED).toBe("user.password_reset_requested");
    expect(AUDIT_EVENT_TYPES.USER_PASSWORD_CHANGE).toBe("user.password_change");
    expect(AUDIT_EVENT_TYPES.USER_MFA_SETUP).toBe("user.mfa_setup");
    expect(AUDIT_EVENT_TYPES.ADMIN_USER_CREATED).toBe("admin.user_created");
    expect(AUDIT_EVENT_TYPES.ADMIN_USER_DELETED).toBe("admin.user_deleted");
    expect(AUDIT_EVENT_TYPES.ADMIN_ROLE_CHANGED).toBe("admin.role_changed");
    expect(AUDIT_EVENT_TYPES.ORG_MEMBER_ADDED).toBe("org.member_added");
    expect(AUDIT_EVENT_TYPES.ORG_MEMBER_REMOVED).toBe("org.member_removed");
    expect(AUDIT_EVENT_TYPES.ORG_SSO_CONFIG_CHANGED).toBe("org.sso_config_changed");
    expect(AUDIT_EVENT_TYPES.SECURITY_SUSPICIOUS_LOGIN).toBe("security.suspicious_login");
    expect(AUDIT_EVENT_TYPES.SECURITY_MFA_CHALLENGE_FAILED).toBe(
      "security.mfa_challenge_failed"
    );
    expect(AUDIT_EVENT_TYPES.GDPR_DATA_EXPORT).toBe("gdpr.data_export");
    expect(AUDIT_EVENT_TYPES.GDPR_DATA_ERASURE).toBe("gdpr.data_erasure");
  });
});
