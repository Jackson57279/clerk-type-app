import { describe, it, expect } from "vitest";
import {
  generateCsrfToken,
  buildCsrfCookie,
  verifyCsrfDoubleSubmit,
} from "../src/csrf-double-submit.js";

describe("generateCsrfToken", () => {
  it("returns a 64-char hex string", () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns unique tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const token = generateCsrfToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});

describe("buildCsrfCookie", () => {
  it("omits HttpOnly so JS can read the token", () => {
    const header = buildCsrfCookie("csrf", "abc123");
    expect(header).not.toContain("HttpOnly");
  });

  it("includes Secure and SameSite=Strict", () => {
    const header = buildCsrfCookie("csrf", "token");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
  });

  it("starts with name=value", () => {
    const header = buildCsrfCookie("csrf-token", "xyz");
    expect(header).toMatch(/^csrf-token=xyz/);
  });

  it("includes Max-Age when provided", () => {
    const header = buildCsrfCookie("csrf", "t", { maxAgeSeconds: 3600 });
    expect(header).toContain("Max-Age=3600");
  });

  it("includes Path when provided", () => {
    const header = buildCsrfCookie("csrf", "t", { path: "/" });
    expect(header).toContain("Path=/");
  });
});

describe("verifyCsrfDoubleSubmit", () => {
  it("returns true when cookie and submitted token match", () => {
    const token = generateCsrfToken();
    expect(verifyCsrfDoubleSubmit(token, token)).toBe(true);
  });

  it("returns false when cookie token is undefined", () => {
    expect(verifyCsrfDoubleSubmit(undefined, "abc")).toBe(false);
  });

  it("returns false when submitted token is undefined", () => {
    expect(verifyCsrfDoubleSubmit("abc", undefined)).toBe(false);
  });

  it("returns false when tokens differ", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(verifyCsrfDoubleSubmit(a, b)).toBe(false);
  });

  it("returns false when cookie token is empty", () => {
    expect(verifyCsrfDoubleSubmit("", "abc")).toBe(false);
  });

  it("returns false when submitted token is empty", () => {
    expect(verifyCsrfDoubleSubmit("abc", "")).toBe(false);
  });

  it("returns false when lengths differ (same prefix)", () => {
    expect(verifyCsrfDoubleSubmit("a", "ab")).toBe(false);
  });
});
