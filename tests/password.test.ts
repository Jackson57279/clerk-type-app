import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

describe("Argon2id password hashing", () => {
  it("hashes a password and returns a string", async () => {
    const hash = await hashPassword("my-secret-password");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).toMatch(/^\$argon2id/);
  });

  it("produces different hashes for the same password (salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifies correct password", async () => {
    const hash = await hashPassword("correct");
    const ok = await verifyPassword(hash, "correct");
    expect(ok).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct");
    const ok = await verifyPassword(hash, "wrong");
    expect(ok).toBe(false);
  });

  it("rejects empty password when hash was from non-empty", async () => {
    const hash = await hashPassword("secret");
    const ok = await verifyPassword(hash, "");
    expect(ok).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const pwd = "pässwörd_🔐";
    const hash = await hashPassword(pwd);
    expect(await verifyPassword(hash, pwd)).toBe(true);
    expect(await verifyPassword(hash, "other")).toBe(false);
  });
});
