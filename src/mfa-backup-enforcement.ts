import type { MfaBackupProvider } from "./passkeys.js";
import type { BackupCodeStore } from "./backup-codes.js";
import { getRemainingBackupCodeCount } from "./backup-codes.js";

export interface MfaBackupEnforcementOptions {
  hasTotp(userId: string): Promise<boolean>;
  backupCodeStore: BackupCodeStore;
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
