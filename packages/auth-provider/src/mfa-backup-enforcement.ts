import type { MfaBackupProvider } from "./passkeys.js";
import type { BackupCodeStore } from "./backup-codes.js";
import { getRemainingBackupCodeCount } from "./backup-codes.js";

export interface MfaBackupEnforcementOptions {
  hasTotp(userId: string): Promise<boolean>;
  backupCodeStore: BackupCodeStore;
  hasSmsMfa?(userId: string): Promise<boolean>;
}

export type MfaBackupEnforcementResult =
  | { allowed: true }
  | { allowed: false; requiresMfaOrBackup: true };

export async function enforceMfaOrBackupCodes(
  provider: MfaBackupProvider,
  userId: string
): Promise<MfaBackupEnforcementResult> {
  const hasMfaOrBackup = await provider.hasMfaOrBackupCodes(userId);
  if (hasMfaOrBackup) return { allowed: true };
  return { allowed: false, requiresMfaOrBackup: true };
}

export function createMfaBackupProvider(
  options: MfaBackupEnforcementOptions
): MfaBackupProvider {
  const { hasTotp, backupCodeStore, hasSmsMfa } = options;
  return {
    async hasMfaOrBackupCodes(userId: string): Promise<boolean> {
      const [totpEnabled, backupCount, smsEnabled] = await Promise.all([
        hasTotp(userId),
        getRemainingBackupCodeCount(userId, backupCodeStore),
        hasSmsMfa ? hasSmsMfa(userId) : Promise.resolve(false),
      ]);
      return totpEnabled || backupCount > 0 || smsEnabled;
    },
  };
}
