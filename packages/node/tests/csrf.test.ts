import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { csrfProtectionMiddleware } from "../src/express.js";
import {
  verifyCsrfRequest as verifyCsrfFromCsrf,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
} from "../src/csrf.js";

function nextFn(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe("verifyCsrfRequest (csrf module)", () => {
  it("returns true when cookie and header match", () => {
    const token = "abc123";
    const cookieHeader = `session=xyz; ${DEFAULT_CSRF_COOKIE_NAME}=${token}`;
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? token : undefined;
    expect(verifyCsrfFromCsrf(cookieHeader, getHeader)).toBe(true);
  });

  it("returns false when cookie missing", () => {
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "token" : undefined;
    expect(verifyCsrfFromCsrf(undefined, getHeader)).toBe(false);
  });

  it("returns false when header missing", () => {
    const cookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=token`;
    const getHeader = () => undefined;
    expect(verifyCsrfFromCsrf(cookieHeader, getHeader)).toBe(false);
  });

  it("returns false when tokens differ", () => {
    const cookieHeader = `${DEFAULT_CSRF_COOKIE_NAME}=token-a`;
    const getHeader = (name: string) =>
      name === DEFAULT_CSRF_HEADER_NAME ? "token-b" : undefined;
    expect(verifyCsrfFromCsrf(cookieHeader, getHeader)).toBe(false);
  });

  it("accepts custom cookie and header names", () => {
    const token = "xyz";
    const cookieHeader = "xsrf=xyz";
    const getHeader = (name: string) => (name === "X-XSRF-TOKEN" ? token : undefined);
    expect(
      verifyCsrfFromCsrf(cookieHeader, getHeader, {
        cookieName: "xsrf",
        headerName: "X-XSRF-TOKEN",
      })
    ).toBe(true);
  });
});

describe("csrfProtectionMiddleware", () => {
  it("calls next for GET when cookie and header match", () => {
    const token = "tok";
    const req = {
      method: "GET",
      get: vi.fn((name: string) =>
        name === "Cookie" ? `csrf=${token}` : name === "X-CSRF-Token" ? token : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
  });

  it("calls next for POST when cookie and header match", () => {
    const token = "match";
    const req = {
      method: "POST",
      get: vi.fn((name: string) =>
        name === "Cookie" ? `session=id; csrf=${token}` : name === "X-CSRF-Token" ? token : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
  });

  it("responds 403 for POST when header missing", () => {
    const token = "tok";
    const req = {
      method: "POST",
      get: vi.fn((name: string) =>
        name === "Cookie" ? `csrf=${token}` : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect((res as unknown as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith({
      error: "Invalid CSRF token",
    });
  });

  it("responds 403 for POST when cookie missing", () => {
    const req = {
      method: "POST",
      get: vi.fn((name: string) =>
        name === "X-CSRF-Token" ? "token" : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
  });

  it("responds 403 for POST when cookie and header differ", () => {
    const req = {
      method: "POST",
      get: vi.fn((name: string) =>
        name === "Cookie" ? "csrf=one" : name === "X-CSRF-Token" ? "two" : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
  });

  it("protects PUT, PATCH, DELETE by default", () => {
    const methods = ["PUT", "PATCH", "DELETE"] as const;
    for (const method of methods) {
      const req = {
        method,
        get: vi.fn(() => undefined),
      } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = nextFn();
      csrfProtectionMiddleware()(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    }
  });

  it("uses custom cookie and header names when provided", () => {
    const token = "custom";
    const req = {
      method: "POST",
      get: vi.fn((name: string) =>
        name === "Cookie" ? "xsrf=custom" : name === "X-XSRF-TOKEN" ? token : undefined
      ),
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = nextFn();
    csrfProtectionMiddleware({
      cookieName: "xsrf",
      headerName: "X-XSRF-TOKEN",
    })(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
