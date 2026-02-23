import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { securityHeadersMiddleware } from "../src/security-headers.js";

function nextFn(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

type MockRes = Response & { setHeader: ReturnType<typeof vi.fn> };

function resWithSetHeader(): MockRes {
  return { setHeader: vi.fn() } as unknown as MockRes;
}

describe("securityHeadersMiddleware", () => {
  it("sets default security headers on response", () => {
    const req = {} as Request;
    const res = resWithSetHeader();
    const next = nextFn();
    securityHeadersMiddleware()(req, res, next);
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff"
    );
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "X-Frame-Options",
      "DENY"
    );
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "Referrer-Policy",
      "strict-origin-when-cross-origin"
    );
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "Permissions-Policy",
      expect.stringContaining("camera=()")
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not set HSTS or CSP when not provided", () => {
    const res = resWithSetHeader();
    securityHeadersMiddleware()({} as Request, res, nextFn());
    const calls = (res as MockRes).setHeader.mock.calls as [string, string][];
    const names = calls.map((c) => c[0]);
    expect(names).not.toContain("Strict-Transport-Security");
    expect(names).not.toContain("Content-Security-Policy");
  });

  it("sets Strict-Transport-Security when option provided", () => {
    const res = resWithSetHeader();
    securityHeadersMiddleware({
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
    })({} as Request, res, nextFn());
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  });

  it("sets Content-Security-Policy when option provided", () => {
    const res = resWithSetHeader();
    const csp = "default-src 'self'";
    securityHeadersMiddleware({ contentSecurityPolicy: csp })({} as Request, res, nextFn());
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      csp
    );
  });

  it("allows overriding X-Frame-Options", () => {
    const res = resWithSetHeader();
    securityHeadersMiddleware({ xFrameOptions: "SAMEORIGIN" })({} as Request, res, nextFn());
    expect((res as MockRes).setHeader).toHaveBeenCalledWith(
      "X-Frame-Options",
      "SAMEORIGIN"
    );
  });

  it("does not set HSTS when option is false", () => {
    const res = resWithSetHeader();
    securityHeadersMiddleware({ strictTransportSecurity: false })({} as Request, res, nextFn());
    const calls = (res as MockRes).setHeader.mock.calls as [string, string][];
    const names = calls.map((c) => c[0]);
    expect(names).not.toContain("Strict-Transport-Security");
  });

  it("does not set CSP when option is false", () => {
    const res = resWithSetHeader();
    securityHeadersMiddleware({ contentSecurityPolicy: false })({} as Request, res, nextFn());
    const calls = (res as MockRes).setHeader.mock.calls as [string, string][];
    const names = calls.map((c) => c[0]);
    expect(names).not.toContain("Content-Security-Policy");
  });
});
