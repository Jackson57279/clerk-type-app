import { describe, it, expect } from "vitest";
import { generateSecureToken, SECURE_TOKEN_BYTES } from "../src/secure-token.js";

describe("SECURE_TOKEN_BYTES", () => {
  it("is 32 for cryptographically secure token length", () => {
    expect(SECURE_TOKEN_BYTES).toBe(32);
  });
});

describe("generateSecureToken", () => {
  it("returns a string", () => {
    expect(typeof generateSecureToken()).toBe("string");
  });

  it("returns a hex string with the correct byte length", () => {
    const token = generateSecureToken();
    expect(token).toHaveLength(SECURE_TOKEN_BYTES * 2);
    expect(token).toMatch(/^[a-f0-9]+$/);
    expect(Buffer.from(token, "hex").length).toBe(SECURE_TOKEN_BYTES);
  });

  it("tokens are cryptographically random and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = generateSecureToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it("does not reuse tokens across immediate invocations", () => {
    const first = generateSecureToken();
    const second = generateSecureToken();
    expect(first).not.toBe(second);
  });
});
