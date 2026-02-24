import type { ProvisionedUser } from "./user-provisioning.js";
import type { StoredPasskey } from "./passkeys.js";
import type { TotpStoreData } from "./totp-authenticator.js";
import { createAuditEvent, AUDIT_EVENT_TYPES, type AuditLogStore } from "./audit-log.js";

export interface GdprAuditContext {
  actorId?: string | null;
  actorType?: string | null;
  actorEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface GdprExportUserStore {
  findById(id: string): Promise<ProvisionedUser | null>;
}

export interface GdprExportPasskeyStore {
  listByUserId(userId: string): Promise<StoredPasskey[]>;
}

export interface GdprExportTotpStore {
  get(userId: string): Promise<TotpStoreData>;
}

export interface GdprExportBackupCodeStore {
  getHashes(userId: string): Promise<string[]>;
}

export interface GdprExportOptions {
  userStore: GdprExportUserStore;
  passkeyStore?: GdprExportPasskeyStore;
  totpStore?: GdprExportTotpStore;
  backupCodeStore?: GdprExportBackupCodeStore;
  auditLogStore?: AuditLogStore;
  auditContext?: GdprAuditContext;
}

export interface GdprPasskeyMetadata {
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  friendlyName?: string;
  deviceInfo?: string;
  lastUsedAt?: string;
}

export interface GdprExportResult {
  version: 1;
  exportedAt: string;
  user: {
    id: string;
    email: string;
    externalId: string | undefined;
    name: string | undefined;
    firstName: string | undefined;
    lastName: string | undefined;
    active: boolean;
  };
  passkeys: GdprPasskeyMetadata[];
  totpEnabled: boolean;
  backupCodesRemainingCount: number;
}

function passkeyToMetadata(p: StoredPasskey): GdprPasskeyMetadata {
  const credentialId =
    typeof p.credentialId === "string"
      ? p.credentialId
      : Buffer.from(p.credentialId).toString("base64url");
  return {
    credentialId,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
    friendlyName: p.friendlyName,
    deviceInfo: p.deviceInfo,
    lastUsedAt: p.lastUsedAt,
  };
}

export async function exportUserData(
  userId: string,
  options: GdprExportOptions
): Promise<GdprExportResult | null> {
  const { userStore, passkeyStore, totpStore, backupCodeStore, auditLogStore, auditContext } = options;
  const user = await userStore.findById(userId);
  if (!user) return null;

  const [passkeys, totpData, backupHashes] = await Promise.all([
    passkeyStore ? passkeyStore.listByUserId(userId) : Promise.resolve([]),
    totpStore ? totpStore.get(userId) : Promise.resolve({ secret: null, enabled: false, pendingSecret: null }),
    backupCodeStore ? backupCodeStore.getHashes(userId) : Promise.resolve([]),
  ]);

  const result: GdprExportResult = {
    version: 1,
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      externalId: user.externalId,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      active: user.active,
    },
    passkeys: passkeys.map(passkeyToMetadata),
    totpEnabled: Boolean(totpData.secret && totpData.enabled),
    backupCodesRemainingCount: backupHashes.length,
  };

  if (auditLogStore) {
    await createAuditEvent(auditLogStore, {
      eventType: AUDIT_EVENT_TYPES.GDPR_DATA_EXPORT,
      targetType: "user",
      targetId: userId,
      ...(auditContext && {
        actorId: auditContext.actorId ?? undefined,
        actorType: auditContext.actorType ?? undefined,
        actorEmail: auditContext.actorEmail ?? undefined,
        ipAddress: auditContext.ipAddress ?? undefined,
        userAgent: auditContext.userAgent ?? undefined,
      }),
    });
  }
  return result;
}

export async function exportUserDataAsJson(
  userId: string,
  options: GdprExportOptions
): Promise<string | null> {
  const result = await exportUserData(userId, options);
  return result ? JSON.stringify(result, null, 2) : null;
}

function escapeCsvField(value: string | undefined | null): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function formatExportAsCsv(result: GdprExportResult): string {
  const header = "id,email,externalId,name,firstName,lastName,active,exportedAt,totpEnabled,backupCodesRemainingCount";
  const row = [
    result.user.id,
    result.user.email,
    result.user.externalId ?? "",
    result.user.name ?? "",
    result.user.firstName ?? "",
    result.user.lastName ?? "",
    result.user.active ? "true" : "false",
    result.exportedAt,
    result.totpEnabled ? "true" : "false",
    String(result.backupCodesRemainingCount),
  ].map(escapeCsvField).join(",");
  const passkeyHeader = "credentialId,deviceType,backedUp,friendlyName,deviceInfo,lastUsedAt";
  const passkeyRows = result.passkeys.map(
    (p) =>
      [
        p.credentialId,
        p.deviceType,
        p.backedUp ? "true" : "false",
        p.friendlyName ?? "",
        p.deviceInfo ?? "",
        p.lastUsedAt ?? "",
      ].map(escapeCsvField).join(",")
  );
  const lines = [header, row, "", passkeyHeader, ...passkeyRows];
  return lines.join("\n");
}

export interface GdprErasureUserStore {
  findById(id: string): Promise<{ id: string } | null>;
  hardDelete(id: string): Promise<void>;
}

export interface GdprErasurePasskeyStore {
  listByUserId(userId: string): Promise<StoredPasskey[]>;
  delete(userId: string, credentialId: string): Promise<void>;
}

export interface GdprErasureBackupCodeStore {
  setHashes(userId: string, hashes: string[]): Promise<void>;
}

export interface GdprErasureTotpStore {
  set(userId: string, data: { secret: null; enabled: false; pendingSecret: null }): Promise<void>;
}

export interface GdprErasureSessionStore {
  invalidateAllSessionsForUser(userId: string): string[];
}

export interface GdprErasureSuspiciousActivityStore {
  delete(userId: string): void | Promise<void>;
}

export interface GdprErasureOptions {
  userStore: GdprErasureUserStore;
  passkeyStore?: GdprErasurePasskeyStore;
  backupCodeStore?: GdprErasureBackupCodeStore;
  totpStore?: GdprErasureTotpStore;
  sessionStore?: GdprErasureSessionStore;
  deleteUserPassword?: (userId: string) => void | Promise<void>;
  deleteAllPhoneVerificationForUser?: (userId: string) => void | Promise<void>;
  suspiciousActivityStore?: GdprErasureSuspiciousActivityStore;
  clearSuspiciousActivityState?: (userId: string) => void;
  auditLogStore?: AuditLogStore;
  auditContext?: GdprAuditContext;
}

export interface GdprErasureResult {
  erased: boolean;
  invalidatedSessionIds: string[];
}

export async function eraseUserData(
  userId: string,
  options: GdprErasureOptions
): Promise<GdprErasureResult> {
  const {
    userStore,
    passkeyStore,
    backupCodeStore,
    totpStore,
    sessionStore,
    deleteUserPassword,
    deleteAllPhoneVerificationForUser,
    suspiciousActivityStore,
    clearSuspiciousActivityState,
    auditLogStore,
    auditContext,
  } = options;

  const user = await userStore.findById(userId);
  if (!user) return { erased: false, invalidatedSessionIds: [] };

  let invalidatedSessionIds: string[] = [];
  if (sessionStore) {
    invalidatedSessionIds = sessionStore.invalidateAllSessionsForUser(userId);
  }

  if (passkeyStore) {
    const passkeys = await passkeyStore.listByUserId(userId);
    for (const p of passkeys) {
      const credId = typeof p.credentialId === "string" ? p.credentialId : Buffer.from(p.credentialId).toString("base64url");
      await passkeyStore.delete(userId, credId);
    }
  }

  if (backupCodeStore) {
    await backupCodeStore.setHashes(userId, []);
  }

  if (totpStore) {
    await totpStore.set(userId, { secret: null, enabled: false, pendingSecret: null });
  }

  if (deleteUserPassword) {
    await deleteUserPassword(userId);
  }

  if (deleteAllPhoneVerificationForUser) {
    await deleteAllPhoneVerificationForUser(userId);
  }

  if (suspiciousActivityStore) {
    await suspiciousActivityStore.delete(userId);
  }

  if (clearSuspiciousActivityState) {
    clearSuspiciousActivityState(userId);
  }

  await userStore.hardDelete(userId);

  if (auditLogStore) {
    await createAuditEvent(auditLogStore, {
      eventType: AUDIT_EVENT_TYPES.GDPR_DATA_ERASURE,
      targetType: "user",
      targetId: userId,
      metadata: { invalidatedSessionIds },
      ...(auditContext && {
        actorId: auditContext.actorId ?? undefined,
        actorType: auditContext.actorType ?? undefined,
        actorEmail: auditContext.actorEmail ?? undefined,
        ipAddress: auditContext.ipAddress ?? undefined,
        userAgent: auditContext.userAgent ?? undefined,
      }),
    });
  }
  return { erased: true, invalidatedSessionIds };
}
