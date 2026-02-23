import * as argon2 from "argon2";
import { randomInt } from "crypto";

const DEFAULT_COUNT = 8;
const CODE_LENGTH = 8;
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export interface BackupCodeStore {
  getHashes(userId: string): Promise<string[]>;
  setHashes(userId: string, hashes: string[]): Promise<void>;
}

export function generateBackupCodes(count: number = DEFAULT_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < CODE_LENGTH; j++) {
      code += ALPHABET[randomInt(ALPHABET.length)]!;
    }
    codes.push(code);
  }
  return codes;
}

export async function hashBackupCode(plain: string): Promise<string> {
  const normalized = plain.trim().toLowerCase().replace(/-/g, "");
  return argon2.hash(normalized, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 2,
  });
}

function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, "");
}

export async function verifyAndConsumeBackupCode(
  userId: string,
  code: string,
  store: BackupCodeStore
): Promise<boolean> {
  const normalized = normalizeCode(code);
  if (!normalized) return false;
  const hashes = await store.getHashes(userId);
  for (let i = 0; i < hashes.length; i++) {
    try {
      if (await argon2.verify(hashes[i]!, normalized)) {
        const remaining = hashes.slice(0, i).concat(hashes.slice(i + 1));
        await store.setHashes(userId, remaining);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function getRemainingBackupCodeCount(
  userId: string,
  store: BackupCodeStore
): Promise<number> {
  const hashes = await store.getHashes(userId);
  return hashes.length;
}

export async function addBackupCodesForUser(
  userId: string,
  codes: string[],
  store: BackupCodeStore
): Promise<void> {
  const existing = await store.getHashes(userId);
  const newHashes = await Promise.all(codes.map((c) => hashBackupCode(c)));
  await store.setHashes(userId, existing.concat(newHashes));
}

export function createMemoryBackupCodeStore(): BackupCodeStore {
  const byUser = new Map<string, string[]>();
  return {
    async getHashes(userId: string) {
      return byUser.get(userId) ?? [];
    },
    async setHashes(userId: string, hashes: string[]) {
      if (hashes.length === 0) byUser.delete(userId);
      else byUser.set(userId, hashes);
    },
  };
}
