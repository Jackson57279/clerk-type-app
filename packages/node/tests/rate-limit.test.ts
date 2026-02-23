import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { rateLimitMiddleware } from "../src/rate-limit.js";

function nextFn(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    get: vi.fn(() => undefined),
    socket: { remoteAddress: "192.168.1.1" },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { status: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls next and allows requests under limit", () => {
    const limiter = rateLimitMiddleware({ windowMs: 60_000, max: 2 });
    const req = mockReq();
    const res = mockRes();
    const next = nextFn();
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when over limit", () => {
    const limiter = rateLimitMiddleware({ windowMs: 60_000, max: 2 });
    const req = mockReq();
    const res1 = mockRes();
    limiter(req, res1, nextFn());
    limiter(req, res1, nextFn());
    const res2 = mockRes();
    limiter(req, res2, nextFn());
    expect(res2.status).toHaveBeenCalledWith(429);
    expect(res2.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Too Many Requests",
        retryAfterSeconds: expect.any(Number),
      })
    );
  });

  it("keys by IP when no key header", () => {
    const limiter = rateLimitMiddleware({ windowMs: 60_000, max: 2 });
    const req1 = mockReq({ socket: { remoteAddress: "1.1.1.1" } } as unknown as Request);
    const req2 = mockReq({ socket: { remoteAddress: "2.2.2.2" } } as unknown as Request);
    limiter(req1, mockRes(), nextFn());
    limiter(req1, mockRes(), nextFn());
    limiter(req2, mockRes(), nextFn());
    const res1 = mockRes();
    limiter(req1, res1, nextFn());
    expect(res1.status).toHaveBeenCalledWith(429);
    const res2 = mockRes();
    limiter(req2, res2, nextFn());
    expect(res2.status).not.toHaveBeenCalled();
  });

  it("keys by header when keyHeader set and header present", () => {
    const limiter = rateLimitMiddleware({
      windowMs: 60_000,
      max: 2,
      keyHeader: "x-api-key",
    });
    const reqA = mockReq({
      get: vi.fn((name: string) => (name === "x-api-key" ? "key-a" : undefined)),
    } as unknown as Request);
    const reqB = mockReq({
      get: vi.fn((name: string) => (name === "x-api-key" ? "key-b" : undefined)),
    } as unknown as Request);
    limiter(reqA, mockRes(), nextFn());
    limiter(reqA, mockRes(), nextFn());
    limiter(reqB, mockRes(), nextFn());
    const resA = mockRes();
    limiter(reqA, resA, nextFn());
    expect(resA.status).toHaveBeenCalledWith(429);
    const resB = mockRes();
    limiter(reqB, resB, nextFn());
    expect(resB.status).not.toHaveBeenCalled();
  });

  it("falls back to IP when keyHeader set but header missing", () => {
    const limiter = rateLimitMiddleware({
      windowMs: 60_000,
      max: 1,
      keyHeader: "x-api-key",
    });
    const req = mockReq();
    limiter(req, mockRes(), nextFn());
    const res = mockRes();
    limiter(req, res, nextFn());
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("uses custom getKey when provided", () => {
    const limiter = rateLimitMiddleware({
      windowMs: 60_000,
      max: 1,
      getKey: (r) => (r as Request & { orgId?: string }).orgId ?? "default",
    });
    const req1 = mockReq() as Request & { orgId?: string };
    req1.orgId = "org-1";
    const req2 = mockReq() as Request & { orgId?: string };
    req2.orgId = "org-2";
    limiter(req1, mockRes(), nextFn());
    limiter(req2, mockRes(), nextFn());
    const res1 = mockRes();
    limiter(req1, res1, nextFn());
    expect(res1.status).toHaveBeenCalledWith(429);
  });

  it("resets after window expires", () => {
    const limiter = rateLimitMiddleware({ windowMs: 1000, max: 1 });
    const req = mockReq();
    limiter(req, mockRes(), nextFn());
    const resBefore = mockRes();
    limiter(req, resBefore, nextFn());
    expect(resBefore.status).toHaveBeenCalledWith(429);
    vi.advanceTimersByTime(1500);
    const resAfter = mockRes();
    const next = nextFn();
    limiter(req, resAfter, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(resAfter.status).not.toHaveBeenCalled();
  });
});
