import { describe, it, expect } from "vitest";
import { generateSecureToken } from "../src/secure-token.js";

describe("generateSecureToken", () => {
  it("returns a string", () => {
    expect(typeof generateSecureToken()).toBe("string");
  });

  it("returns 64 hex characters (32 bytes)", () => {
    const token = generateSecureToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(token, "hex").length).toBe(32);
  });

  it("tokens are cryptographically random and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generateSecureToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});
