import { describe, it, expect } from "vitest";
import {
  generateCsrfToken,
  buildCsrfCookie,
  getCsrfTokenFromCookieHeader,
  verifyCsrfDoubleSubmit,
  getSubmittedCsrfToken,
  verifyCsrfRequest,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
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

describe("getCsrfTokenFromCookieHeader", () => {
  it("returns token when cookie is present", () => {
    const header = "session=xyz; csrf=abc123; other=val";
    expect(getCsrfTokenFromCookieHeader(header, "csrf")).toBe("abc123");
  });

  it("returns undefined when cookie header is undefined", () => {
    expect(getCsrfTokenFromCookieHeader(undefined, "csrf")).toBeUndefined();
  });

  it("returns undefined when cookie name is missing", () => {
    expect(getCsrfTokenFromCookieHeader("session=xyz", "csrf")).toBeUndefined();
  });

  it("returns first matching value when multiple cookies", () => {
    const header = "csrf=first; csrf=second";
    expect(getCsrfTokenFromCookieHeader(header, "csrf")).toBe("first");
  });

  it("trims spaces around name and value", () => {
    expect(getCsrfTokenFromCookieHeader("  csrf  =  tok  ", "csrf")).toBe("tok");
  });

  it("handles value containing equals", () => {
    expect(getCsrfTokenFromCookieHeader("csrf=a=b=c", "csrf")).toBe("a=b=c");
  });
});

describe("double-submit cookie round-trip", () => {
  it("generated token in cookie and header passes verification", () => {
    const token = generateCsrfToken();
    const cookieHeader = buildCsrfCookie("csrf", token);
    const cookieValue = getCsrfTokenFromCookieHeader(
      cookieHeader.split("; ")[0],
      "csrf"
    );
    expect(verifyCsrfDoubleSubmit(cookieValue, token)).toBe(true);
  });
});

describe("defaults", () => {
  it("DEFAULT_CSRF_COOKIE_NAME is csrf", () => {
    expect(DEFAULT_CSRF_COOKIE_NAME).toBe("csrf");
  });
  it("DEFAULT_CSRF_HEADER_NAME is X-CSRF-Token", () => {
    expect(DEFAULT_CSRF_HEADER_NAME).toBe("X-CSRF-Token");
  });
});

describe("getSubmittedCsrfToken", () => {
  it("returns header value when present", () => {
    const getHeader = (name: string) =>
      name === "X-CSRF-Token" ? " abc123 " : undefined;
    expect(getSubmittedCsrfToken(getHeader)).toBe("abc123");
  });
  it("returns undefined when header missing", () => {
    const getHeader = () => undefined;
    expect(getSubmittedCsrfToken(getHeader)).toBeUndefined();
  });
  it("returns undefined when header empty", () => {
    const getHeader = (name: string) =>
      name === "X-CSRF-Token" ? "   " : undefined;
    expect(getSubmittedCsrfToken(getHeader)).toBeUndefined();
  });
  it("uses custom header name when provided", () => {
    const getHeader = (name: string) =>
      name === "X-XSRF-TOKEN" ? "tok" : undefined;
    expect(getSubmittedCsrfToken(getHeader, "X-XSRF-TOKEN")).toBe("tok");
  });
});

describe("verifyCsrfRequest", () => {
  it("returns true when cookie and header match", () => {
    const token = generateCsrfToken();
    const cookieHeader = `session=xyz; ${DEFAULT_CSRF_COOKIE_NAME}=${token}`;
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? token : undefined;
    expect(verifyCsrfRequest(cookieHeader, getHeader)).toBe(true);
  });
  it("returns false when cookie missing", () => {
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "token" : undefined;
    expect(verifyCsrfRequest(undefined, getHeader)).toBe(false);
  });
  it("returns false when header missing", () => {
    const token = generateCsrfToken();
    const cookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=${token}`;
    const getHeader = () => undefined;
    expect(verifyCsrfRequest(cookieHeader, getHeader)).toBe(false);
  });
  it("returns false when tokens differ", () => {
    const token = generateCsrfToken();
    const cookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=${token}`;
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "wrong-token" : undefined;
    expect(verifyCsrfRequest(cookieHeader, getHeader)).toBe(false);
  });
  it("accepts custom cookie and header names", () => {
    const token = generateCsrfToken();
    const cookieHeader = `xsrf=${token}`;
    const getHeader = (name: string) => (name === "X-XSRF-TOKEN" ? token : undefined);
    expect(
      verifyCsrfRequest(cookieHeader, getHeader, {
        cookieName: "xsrf",
        headerName: "X-XSRF-TOKEN",
      })
    ).toBe(true);
  });

  it("returns false when cookie or header token is empty", () => {
    const emptyCookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=`;
    const nonEmptyHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "token" : undefined;
    expect(verifyCsrfRequest(emptyCookieHeader, nonEmptyHeader)).toBe(false);

    const nonEmptyCookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=token`;
    const emptyHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "   " : undefined;
    expect(verifyCsrfRequest(nonEmptyCookieHeader, emptyHeader)).toBe(false);
  });
});
