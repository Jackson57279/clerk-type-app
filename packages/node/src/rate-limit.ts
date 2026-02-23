import type { Request, Response, NextFunction } from "express";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyHeader?: string;
  getKey?: (req: Request) => string;
}

function defaultGetKey(req: Request, keyHeader?: string): string {
  if (keyHeader) {
    const value = req.get(keyHeader);
    if (value != null && value.trim() !== "") return value.trim();
  }
  const ip =
    (req as Request & { ip?: string }).ip ??
    req.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown";
  return ip;
}

function createStore() {
  const store = new Map<string, number[]>();
  return {
    pruneAndGet(key: string, windowMs: number, now: number): { count: number; oldest: number } {
      const list = store.get(key) ?? [];
      const cutoff = now - windowMs;
      const kept = list.filter((t) => t > cutoff);
      if (kept.length > 0) {
        store.set(key, kept);
      } else {
        store.delete(key);
      }
      const oldest = kept[0] ?? now;
      return { count: kept.length, oldest };
    },
    add(key: string, now: number): void {
      const list = store.get(key) ?? [];
      list.push(now);
      store.set(key, list);
    },
  };
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

export function loginRateLimitMiddleware(): ReturnType<typeof rateLimitMiddleware> {
  return rateLimitMiddleware({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS });
}

export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const keyHeader = options.keyHeader;
  const getKey = options.getKey ?? ((req: Request) => defaultGetKey(req, keyHeader));
  const store = createStore();

  return function middleware(req: Request, res: Response, next: NextFunction): void {
    const key = getKey(req);
    const now = Date.now();
    const { count, oldest } = store.pruneAndGet(key, windowMs, now);
    if (count >= max) {
      const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfterSeconds)));
      res.status(429).json({
        error: "Too Many Requests",
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      });
      return;
    }
    store.add(key, now);
    next();
  };
}
