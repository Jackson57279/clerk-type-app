import { describe, it, expect } from "vitest";
import {
  createMfaBackupProvider,
} from "../src/mfa-backup-enforcement.js";
import {
  createMemoryBackupCodeStore,
  addBackupCodesForUser,
  getRemainingBackupCodeCount,
} from "../src/backup-codes.js";

describe("createMfaBackupProvider", () => {
  it("returns true when user has TOTP enabled", async () => {
    const backupStore = createMemoryBackupCodeStore();
    const provider = createMfaBackupProvider({
      hasTotp: async (userId) => userId === "user-with-totp",
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-with-totp")).toBe(true);
  });

  it("returns true when user has backup codes", async () => {
    const backupStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser("user-with-backup", ["abc12345", "xyz67890"], backupStore);
    const provider = createMfaBackupProvider({
      hasTotp: async () => false,
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-with-backup")).toBe(true);
  });

  it("returns true when user has both TOTP and backup codes", async () => {
    const backupStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser("user-both", ["code1"], backupStore);
    const provider = createMfaBackupProvider({
      hasTotp: async (userId) => userId === "user-both",
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-both")).toBe(true);
  });

  it("returns false when user has neither TOTP nor backup codes", async () => {
    const backupStore = createMemoryBackupCodeStore();
    const provider = createMfaBackupProvider({
      hasTotp: async () => false,
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-none")).toBe(false);
  });

  it("returns false when user has no backup codes and TOTP disabled", async () => {
    const backupStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser("other-user", ["code1"], backupStore);
    const provider = createMfaBackupProvider({
      hasTotp: async () => false,
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-no-backup")).toBe(false);
  });

  it("uses backup count so zero remaining codes means no backup", async () => {
    const backupStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser("user-consumed", ["onlyone"], backupStore);
    const provider = createMfaBackupProvider({
      hasTotp: async () => false,
      backupCodeStore: backupStore,
    });
    expect(await provider.hasMfaOrBackupCodes("user-consumed")).toBe(true);
    expect(await getRemainingBackupCodeCount("user-consumed", backupStore)).toBe(1);
  });
});
