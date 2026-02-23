import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware, requireAuth } from "../src/express.js";
import { createHmac } from "crypto";

function nextFn(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header), "utf8"));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

describe("authMiddleware", () => {
  const secret = "express-secret";

  it("sets req.auth when Authorization Bearer is valid", () => {
    const payload = {
      sub: "user_1",
      session_id: "sess_1",
      org_id: null,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    const req = { get: vi.fn((name: string) => (name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined)) } as unknown as Request;
    const res = {} as Response;
    const next = nextFn();
    authMiddleware({ secret })(req, res, next);
    expect(req.auth).toEqual({ userId: "user_1", sessionId: "sess_1", orgId: null });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves req.auth undefined when no Authorization header", () => {
    const req = { get: vi.fn(() => undefined) } as unknown as Request;
    const res = {} as Response;
    const next = nextFn();
    authMiddleware({ secret })(req, res, next);
    expect(req.auth).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves req.auth undefined when token is invalid", () => {
    const req = { get: vi.fn((name: string) => (name.toLowerCase() === "authorization" ? "Bearer bad-token" : undefined)) } as unknown as Request;
    const res = {} as Response;
    const next = nextFn();
    authMiddleware({ secret })(req, res, next);
    expect(req.auth).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("requireAuth", () => {
  it("calls next when req.auth is set", () => {
    const next = nextFn();
    const req = { auth: { userId: "u1", sessionId: "s1", orgId: null } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    requireAuth()(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalled();
  });

  it("responds 401 when req.auth is undefined", () => {
    const next = nextFn();
    const req = {} as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    requireAuth()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect((res as unknown as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith({
      error: "Unauthorized",
    });
  });
});
