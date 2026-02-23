import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  hashBackupCode,
  verifyAndConsumeBackupCode,
  getRemainingBackupCodeCount,
  addBackupCodesForUser,
  generateAndStoreBackupCodes,
  createMemoryBackupCodeStore,
} from "../src/backup-codes.js";

describe("generateBackupCodes", () => {
  it("returns default count of 8 codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
  });

  it("returns requested count of codes", () => {
    const codes = generateBackupCodes(5);
    expect(codes).toHaveLength(5);
  });

  it("each code has expected length and charset", () => {
    const codes = generateBackupCodes(20);
    const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
    for (const code of codes) {
      expect(code).toHaveLength(8);
      expect([...code].every((c) => alphabet.includes(c))).toBe(true);
    }
  });

  it("codes are unique within a batch", () => {
    const codes = generateBackupCodes(100);
    const set = new Set(codes);
    expect(set.size).toBe(codes.length);
  });
});

describe("hashBackupCode", () => {
  it("produces different hashes for different codes", async () => {
    const h1 = await hashBackupCode("abc12345");
    const h2 = await hashBackupCode("xyz67890");
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^\$argon2/);
    expect(h2).toMatch(/^\$argon2/);
  });

  it("normalizes before hashing so verification accepts case variants", async () => {
    const store = createMemoryBackupCodeStore();
    await addBackupCodesForUser("u", ["AbC12345"], store);
    const ok = await verifyAndConsumeBackupCode("u", "abc12345", store);
    expect(ok).toBe(true);
  });
});

describe("BackupCodeStore and verifyAndConsumeBackupCode", () => {
  it("verifyAndConsumeBackupCode consumes one code and returns true", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "user-1";
    await addBackupCodesForUser(userId, ["code1abc", "code2def"], store);
    const before = await getRemainingBackupCodeCount(userId, store);
    expect(before).toBe(2);
    const ok = await verifyAndConsumeBackupCode(userId, "code1abc", store);
    expect(ok).toBe(true);
    const after = await getRemainingBackupCodeCount(userId, store);
    expect(after).toBe(1);
    const ok2 = await verifyAndConsumeBackupCode(userId, "code2def", store);
    expect(ok2).toBe(true);
    const after2 = await getRemainingBackupCodeCount(userId, store);
    expect(after2).toBe(0);
  });

  it("verifyAndConsumeBackupCode normalizes input (trim, lowercase, strip dashes)", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "u";
    await addBackupCodesForUser(userId, ["abcdefgh"], store);
    const ok = await verifyAndConsumeBackupCode(userId, "  ABCDEFGH  ", store);
    expect(ok).toBe(true);
    const ok2 = await verifyAndConsumeBackupCode(userId, "abc-def-gh", store);
    expect(ok2).toBe(false);
  });

  it("verifyAndConsumeBackupCode returns false for wrong code", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "user-1";
    await addBackupCodesForUser(userId, ["correct1"], store);
    const ok = await verifyAndConsumeBackupCode(userId, "wrongcode", store);
    expect(ok).toBe(false);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(1);
  });

  it("verifyAndConsumeBackupCode returns false for empty input", async () => {
    const store = createMemoryBackupCodeStore();
    const ok = await verifyAndConsumeBackupCode("u", "   ", store);
    expect(ok).toBe(false);
  });

  it("same code cannot be used twice", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "user-1";
    await addBackupCodesForUser(userId, ["onetime1"], store);
    const ok1 = await verifyAndConsumeBackupCode(userId, "onetime1", store);
    expect(ok1).toBe(true);
    const ok2 = await verifyAndConsumeBackupCode(userId, "onetime1", store);
    expect(ok2).toBe(false);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(0);
  });

  it("getRemainingBackupCodeCount returns 0 for user with no codes", async () => {
    const store = createMemoryBackupCodeStore();
    expect(await getRemainingBackupCodeCount("nobody", store)).toBe(0);
  });
});

describe("addBackupCodesForUser", () => {
  it("appends hashes to existing user codes", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "u";
    await addBackupCodesForUser(userId, ["first"], store);
    await addBackupCodesForUser(userId, ["second"], store);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(2);
    await verifyAndConsumeBackupCode(userId, "first", store);
    await verifyAndConsumeBackupCode(userId, "second", store);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(0);
  });
});

describe("generateAndStoreBackupCodes", () => {
  it("generates default 8 codes, stores hashes, returns plain codes for one-time display", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "user-setup";
    const codes = await generateAndStoreBackupCodes(userId, store);
    expect(codes).toHaveLength(8);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(8);
    const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
    for (const code of codes) {
      expect(code).toHaveLength(8);
      expect([...code].every((c) => alphabet.includes(c))).toBe(true);
    }
    const ok = await verifyAndConsumeBackupCode(userId, codes[0]!, store);
    expect(ok).toBe(true);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(7);
  });

  it("accepts custom count", async () => {
    const store = createMemoryBackupCodeStore();
    const codes = await generateAndStoreBackupCodes("u", store, 5);
    expect(codes).toHaveLength(5);
    expect(await getRemainingBackupCodeCount("u", store)).toBe(5);
  });

  it("appends to existing backup codes for user", async () => {
    const store = createMemoryBackupCodeStore();
    await addBackupCodesForUser("u", ["existing1"], store);
    const codes = await generateAndStoreBackupCodes("u", store, 2);
    expect(codes).toHaveLength(2);
    expect(await getRemainingBackupCodeCount("u", store)).toBe(3);
    const ok = await verifyAndConsumeBackupCode("u", "existing1", store);
    expect(ok).toBe(true);
    expect(await getRemainingBackupCodeCount("u", store)).toBe(2);
  });
});
