import type { MfaBackupProvider } from "./passkeys.js";
import type { BackupCodeStore } from "./backup-codes.js";
import { getRemainingBackupCodeCount } from "./backup-codes.js";

export interface MfaBackupEnforcementOptions {
  hasTotp(userId: string): Promise<boolean>;
  backupCodeStore: BackupCodeStore;
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
  const { hasTotp, backupCodeStore } = options;
  return {
    async hasMfaOrBackupCodes(userId: string): Promise<boolean> {
      const [totpEnabled, backupCount] = await Promise.all([
        hasTotp(userId),
        getRemainingBackupCodeCount(userId, backupCodeStore),
      ]);
      return totpEnabled || backupCount > 0;
    },
  };
}
