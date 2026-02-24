import { describe, it, expect, vi } from "vitest";
import {
  exportUserData,
  exportUserDataAsJson,
  formatExportAsCsv,
  eraseUserData,
  type GdprExportOptions,
  type GdprErasureOptions,
} from "../src/gdpr.js";
import type { ProvisionedUser } from "../src/user-provisioning.js";
import type { StoredPasskey } from "../src/passkeys.js";
import { createMemoryBackupCodeStore } from "../src/backup-codes.js";
import { createMemoryTotpStore } from "../src/totp-authenticator.js";
import { createMemoryPasskeyStore } from "../src/passkeys.js";
import { AUDIT_EVENT_TYPES, type AuditLogStore, type AuditEventRecord } from "../src/audit-log.js";

const testUser: ProvisionedUser = {
  id: "user-1",
  email: "alice@example.com",
  externalId: "ext-1",
  name: "Alice",
  firstName: "Alice",
  lastName: "Smith",
  active: true,
};

function createMockUserStore(users: Map<string, ProvisionedUser>) {
  return {
    findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    hardDelete: vi.fn((id: string) => {
      users.delete(id);
      return Promise.resolve();
    }),
  };
}

describe("exportUserData", () => {
  it("returns null when user is not found", async () => {
    const userStore = { findById: vi.fn().mockResolvedValue(null) };
    const result = await exportUserData("missing", { userStore });
    expect(result).toBeNull();
    expect(userStore.findById).toHaveBeenCalledWith("missing");
  });

  it("returns export with user profile only when no optional stores provided", async () => {
    const users = new Map([["user-1", testUser]]);
    const userStore = {
      findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    };
    const result = await exportUserData("user-1", { userStore });
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.exportedAt).toBeDefined();
    expect(result!.user).toEqual({
      id: testUser.id,
      email: testUser.email,
      externalId: testUser.externalId,
      name: testUser.name,
      firstName: testUser.firstName,
      lastName: testUser.lastName,
      active: testUser.active,
    });
    expect(result!.passkeys).toEqual([]);
    expect(result!.totpEnabled).toBe(false);
    expect(result!.backupCodesRemainingCount).toBe(0);
  });

  it("includes passkeys metadata, totp and backup code count when stores provided", async () => {
    const users = new Map([["user-1", testUser]]);
    const userStore = {
      findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    };
    const passkeyStore = createMemoryPasskeyStore();
    const pk: StoredPasskey = {
      userId: "user-1",
      credentialId: "cred-abc",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "webauthn-1",
      friendlyName: "My key",
      deviceInfo: "Chrome on macOS · internal",
      lastUsedAt: "2025-01-01T00:00:00.000Z",
    };
    await passkeyStore.save(pk);

    const totpStore = createMemoryTotpStore();
    await totpStore.set("user-1", { secret: "SECRET", enabled: true, pendingSecret: null });

    const backupCodeStore = createMemoryBackupCodeStore();
    await backupCodeStore.setHashes("user-1", ["hash1", "hash2"]);

    const options: GdprExportOptions = {
      userStore,
      passkeyStore,
      totpStore,
      backupCodeStore,
    };
    const result = await exportUserData("user-1", options);
    expect(result).not.toBeNull();
    expect(result!.passkeys).toHaveLength(1);
    expect(result!.passkeys[0]).toMatchObject({
      credentialId: "cred-abc",
      deviceType: "singleDevice",
      backedUp: false,
      friendlyName: "My key",
      deviceInfo: "Chrome on macOS · internal",
      lastUsedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(result!.totpEnabled).toBe(true);
    expect(result!.backupCodesRemainingCount).toBe(2);
  });

  it("does not export TOTP secret or backup code hashes", async () => {
    const users = new Map([["user-1", testUser]]);
    const userStore = {
      findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    };
    const totpStore = createMemoryTotpStore();
    await totpStore.set("user-1", { secret: "SECRET", enabled: true, pendingSecret: null });
    const backupCodeStore = createMemoryBackupCodeStore();
    await backupCodeStore.setHashes("user-1", ["hash1"]);
    const result = await exportUserData("user-1", {
      userStore,
      totpStore,
      backupCodeStore,
    });
    expect(result!.totpEnabled).toBe(true);
    expect(result!.backupCodesRemainingCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("hash1");
  });

  it("logs gdpr.data_export audit event when auditLogStore provided", async () => {
    const users = new Map([["user-1", testUser]]);
    const userStore = {
      findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    };
    const events: AuditEventRecord[] = [];
    const auditLogStore: AuditLogStore = {
      append: vi.fn(async (e) => {
        events.push({ ...e });
      }),
    };
    const result = await exportUserData("user-1", {
      userStore,
      auditLogStore,
      auditContext: { actorId: "user-1", actorType: "user", ipAddress: "1.2.3.4" },
    });
    expect(result).not.toBeNull();
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.eventType).toBe(AUDIT_EVENT_TYPES.GDPR_DATA_EXPORT);
    expect(ev.targetType).toBe("user");
    expect(ev.targetId).toBe("user-1");
    expect(ev.actorId).toBe("user-1");
    expect(ev.ipAddress).toBe("1.2.3.4");
  });

  it("does not log audit event when user not found for export", async () => {
    const userStore = { findById: vi.fn().mockResolvedValue(null) };
    const events: AuditEventRecord[] = [];
    const auditLogStore: AuditLogStore = {
      append: vi.fn(async (e) => {
        events.push({ ...e });
      }),
    };
    const result = await exportUserData("missing", { userStore, auditLogStore });
    expect(result).toBeNull();
    expect(events).toHaveLength(0);
  });
});

describe("exportUserDataAsJson", () => {
  it("returns null when user is not found", async () => {
    const userStore = { findById: vi.fn().mockResolvedValue(null) };
    const result = await exportUserDataAsJson("missing", { userStore });
    expect(result).toBeNull();
  });

  it("returns pretty-printed JSON string of export", async () => {
    const users = new Map([["user-1", testUser]]);
    const userStore = {
      findById: vi.fn((id: string) => Promise.resolve(users.get(id) ?? null)),
    };
    const result = await exportUserDataAsJson("user-1", { userStore });
    expect(result).not.toBeNull();
    const r = result!;
    const parsed = JSON.parse(r);
    expect(parsed.version).toBe(1);
    expect(parsed.user.id).toBe("user-1");
    expect(parsed.user.email).toBe("alice@example.com");
    expect(r).toContain("\n");
  });
});

describe("formatExportAsCsv", () => {
  it("formats export result as CSV with user row and passkey rows", () => {
    const result = {
      version: 1 as const,
      exportedAt: "2025-01-15T12:00:00.000Z",
      user: {
        id: "user-1",
        email: "alice@example.com",
        externalId: "ext-1",
        name: "Alice",
        firstName: "Alice",
        lastName: "Smith",
        active: true,
      },
      passkeys: [
        {
          credentialId: "c1",
          deviceType: "singleDevice",
          backedUp: false,
          friendlyName: "Key 1",
          deviceInfo: "Chrome",
          lastUsedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      totpEnabled: true,
      backupCodesRemainingCount: 2,
    };
    const csv = formatExportAsCsv(result);
    expect(csv).toContain("id,email,externalId,name,firstName,lastName,active,exportedAt,totpEnabled,backupCodesRemainingCount");
    expect(csv).toContain("user-1,alice@example.com,ext-1,Alice,Alice,Smith,true,2025-01-15T12:00:00.000Z,true,2");
    expect(csv).toContain("credentialId,deviceType,backedUp,friendlyName,deviceInfo,lastUsedAt");
    expect(csv).toContain("c1,singleDevice,false,Key 1,Chrome,2025-01-01T00:00:00.000Z");
  });

  it("escapes CSV fields containing commas and quotes", () => {
    const result = {
      version: 1 as const,
      exportedAt: "2025-01-15T12:00:00.000Z",
      user: {
        id: "user-1",
        email: "alice\"@example.com",
        externalId: undefined,
        name: "Smith, Alice",
        firstName: "Alice",
        lastName: "Smith",
        active: false,
      },
      passkeys: [],
      totpEnabled: false,
      backupCodesRemainingCount: 0,
    };
    const csv = formatExportAsCsv(result);
    expect(csv).toContain('"alice""@example.com"');
    expect(csv).toContain('"Smith, Alice"');
  });
});

describe("eraseUserData", () => {
  it("returns erased: false when user is not found", async () => {
    const userStore = {
      findById: vi.fn().mockResolvedValue(null),
      hardDelete: vi.fn(),
    };
    const result = await eraseUserData("missing", { userStore });
    expect(result).toEqual({ erased: false, invalidatedSessionIds: [] });
    expect(userStore.hardDelete).not.toHaveBeenCalled();
  });

  it("hard-deletes user and returns erased: true when only userStore provided", async () => {
    const users = new Map([["user-1", { ...testUser }]]);
    const userStore = createMockUserStore(users);
    const result = await eraseUserData("user-1", {
      userStore: { findById: userStore.findById, hardDelete: userStore.hardDelete },
    });
    expect(result).toEqual({ erased: true, invalidatedSessionIds: [] });
    expect(userStore.hardDelete).toHaveBeenCalledWith("user-1");
    expect(users.has("user-1")).toBe(false);
  });

  it("invalidates sessions, clears passkeys/backup/totp and deletes user when all stores provided", async () => {
    const users = new Map([["user-1", { ...testUser }]]);
    const userStore = createMockUserStore(users);
    const sessionStore = {
      invalidateAllSessionsForUser: vi.fn((userId: string) => (userId === "user-1" ? ["s1", "s2"] : [])),
    };
    const passkeyStore = createMemoryPasskeyStore();
    await passkeyStore.save({
      userId: "user-1",
      credentialId: "c1",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w1",
    });
    const backupCodeStore = createMemoryBackupCodeStore();
    await backupCodeStore.setHashes("user-1", ["h1"]);
    const totpStore = createMemoryTotpStore();
    await totpStore.set("user-1", { secret: "s", enabled: true, pendingSecret: null });

    const deleteUserPassword = vi.fn().mockResolvedValue(undefined);
    const deleteAllPhoneVerificationForUser = vi.fn().mockResolvedValue(undefined);
    const suspiciousActivityStore = { delete: vi.fn() };
    const clearSuspiciousActivityState = vi.fn();

    const options: GdprErasureOptions = {
      userStore: { findById: userStore.findById, hardDelete: userStore.hardDelete },
      passkeyStore,
      backupCodeStore,
      totpStore,
      sessionStore,
      deleteUserPassword,
      deleteAllPhoneVerificationForUser,
      suspiciousActivityStore,
      clearSuspiciousActivityState,
    };
    const result = await eraseUserData("user-1", options);

    expect(result).toEqual({ erased: true, invalidatedSessionIds: ["s1", "s2"] });
    expect(sessionStore.invalidateAllSessionsForUser).toHaveBeenCalledWith("user-1");
    expect(await passkeyStore.listByUserId("user-1")).toHaveLength(0);
    expect(await backupCodeStore.getHashes("user-1")).toHaveLength(0);
    const totpData = await totpStore.get("user-1");
    expect(totpData.secret).toBeNull();
    expect(totpData.enabled).toBe(false);
    expect(deleteUserPassword).toHaveBeenCalledWith("user-1");
    expect(deleteAllPhoneVerificationForUser).toHaveBeenCalledWith("user-1");
    expect(suspiciousActivityStore.delete).toHaveBeenCalledWith("user-1");
    expect(clearSuspiciousActivityState).toHaveBeenCalledWith("user-1");
    expect(users.has("user-1")).toBe(false);
  });

  it("logs gdpr.data_erasure audit event when auditLogStore provided", async () => {
    const users = new Map([["user-1", { ...testUser }]]);
    const userStore = createMockUserStore(users);
    const events: AuditEventRecord[] = [];
    const auditLogStore: AuditLogStore = {
      append: vi.fn(async (e) => {
        events.push({ ...e });
      }),
    };
    const result = await eraseUserData("user-1", {
      userStore: { findById: userStore.findById, hardDelete: userStore.hardDelete },
      auditLogStore,
      auditContext: { actorId: "admin-1", actorType: "admin" },
    });
    expect(result).toEqual({ erased: true, invalidatedSessionIds: [] });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.eventType).toBe(AUDIT_EVENT_TYPES.GDPR_DATA_ERASURE);
    expect(ev.targetType).toBe("user");
    expect(ev.targetId).toBe("user-1");
    expect(ev.actorId).toBe("admin-1");
    expect(ev.actorType).toBe("admin");
  });

  it("includes invalidatedSessionIds in erasure audit metadata", async () => {
    const users = new Map([["user-1", { ...testUser }]]);
    const userStore = createMockUserStore(users);
    const sessionStore = {
      invalidateAllSessionsForUser: vi.fn(() => ["s1", "s2"]),
    };
    const events: AuditEventRecord[] = [];
    const auditLogStore: AuditLogStore = {
      append: vi.fn(async (e) => {
        events.push({ ...e });
      }),
    };
    await eraseUserData("user-1", {
      userStore: { findById: userStore.findById, hardDelete: userStore.hardDelete },
      sessionStore,
      auditLogStore,
    });
    expect(events[0]!.metadata).toEqual({ invalidatedSessionIds: ["s1", "s2"] });
  });

  it("does not log audit event when user not found for erasure", async () => {
    const userStore = {
      findById: vi.fn().mockResolvedValue(null),
      hardDelete: vi.fn(),
    };
    const events: AuditEventRecord[] = [];
    const auditLogStore: AuditLogStore = {
      append: vi.fn(async (e) => {
        events.push({ ...e });
      }),
    };
    const result = await eraseUserData("missing", { userStore, auditLogStore });
    expect(result).toEqual({ erased: false, invalidatedSessionIds: [] });
    expect(events).toHaveLength(0);
  });
});
