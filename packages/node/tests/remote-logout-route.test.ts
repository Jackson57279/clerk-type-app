import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { remoteLogoutRoute } from "../src/remote-logout-route.js";

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

describe("remoteLogoutRoute", () => {
  it("returns 200 and invalidated sessions when auth is set", () => {
    const store = {
      invalidateAllSessionsForUser(userId: string) {
        return userId === "u1" ? ["s1", "s2"] : [];
      },
    };
    const req = { auth: { userId: "u1", sessionId: "s1", orgId: null } } as unknown as Request;
    const res = mockRes();
    remoteLogoutRoute({ store })(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      invalidatedSessionIds: ["s1", "s2"],
      invalidatedCount: 2,
    });
  });

  it("returns 401 when req.auth is missing", () => {
    const store = { invalidateAllSessionsForUser: vi.fn(() => []) };
    const req = {} as unknown as Request;
    const res = mockRes();
    remoteLogoutRoute({ store })(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(store.invalidateAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when userId is whitespace only", () => {
    const store = { invalidateAllSessionsForUser: vi.fn(() => []) };
    const req = { auth: { userId: "   ", sessionId: "s1", orgId: null } } as unknown as Request;
    const res = mockRes();
    remoteLogoutRoute({ store })(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "invalid_request",
      error_description: "userId is required",
    });
    expect(store.invalidateAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("returns 200 with empty list when user has no sessions", () => {
    const store = { invalidateAllSessionsForUser: () => [] };
    const req = { auth: { userId: "u99", sessionId: "s99", orgId: null } } as unknown as Request;
    const res = mockRes();
    remoteLogoutRoute({ store })(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      invalidatedSessionIds: [],
      invalidatedCount: 0,
    });
  });
});
