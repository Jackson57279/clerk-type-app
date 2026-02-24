import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "./verify.js";
import type { AuthPayload, AuthMiddlewareOptions } from "./types.js";
import { verifyCsrfRequest } from "./csrf.js";
import type { CsrfMiddlewareOptions } from "./csrf.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function authMiddleware(options: AuthMiddlewareOptions) {
  const { secret, headerName = "authorization" } = options;
  return function middleware(req: Request, _res: Response, next: NextFunction): void {
    const raw = req.get(headerName);
    const token =
      raw?.toLowerCase().startsWith("bearer ") === true ? raw.slice(7).trim() : null;
    if (!token) {
      next();
      return;
    }
    const payload = verifyAccessToken(token, secret);
    if (payload) {
      req.auth = {
        userId: payload.sub,
        sessionId: payload.session_id,
        orgId: payload.org_id ?? null,
      };
    }
    next();
  };
}

export function requireAuth() {
  return function middleware(req: Request, res: Response, next: NextFunction): void {
    if (!req.auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

const DEFAULT_CSRF_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

export function csrfProtectionMiddleware(options: CsrfMiddlewareOptions = {}) {
  const methods = options.methodsToProtect ?? DEFAULT_CSRF_METHODS;
  const methodSet = new Set(methods.map((m) => m.toUpperCase()));
  return function middleware(req: Request, res: Response, next: NextFunction): void {
    if (!methodSet.has(req.method.toUpperCase())) {
      next();
      return;
    }
    const cookieHeader = req.get("Cookie");
    const getHeader = (name: string) => req.get(name) ?? undefined;
    if (verifyCsrfRequest(cookieHeader ?? undefined, getHeader, options)) {
      next();
      return;
    }
    res.status(403).json({ error: "Invalid CSRF token" });
  };
}
