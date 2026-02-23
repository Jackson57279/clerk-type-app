import type { ProvisionedUser } from "./user-provisioning.js";
import type { StoredPasskey } from "./passkeys.js";
import type { TotpStoreData } from "./totp-authenticator.js";

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
}

export interface GdprPasskeyMetadata {
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  friendlyName?: string;
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
    lastUsedAt: p.lastUsedAt,
  };
}

export async function exportUserData(
  userId: string,
  options: GdprExportOptions
): Promise<GdprExportResult | null> {
  const { userStore, passkeyStore, totpStore, backupCodeStore } = options;
  const user = await userStore.findById(userId);
  if (!user) return null;

  const [passkeys, totpData, backupHashes] = await Promise.all([
    passkeyStore ? passkeyStore.listByUserId(userId) : Promise.resolve([]),
    totpStore ? totpStore.get(userId) : Promise.resolve({ secret: null, enabled: false, pendingSecret: null }),
    backupCodeStore ? backupCodeStore.getHashes(userId) : Promise.resolve([]),
  ]);

  return {
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
  return { erased: true, invalidatedSessionIds };
}
