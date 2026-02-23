const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attemptsByIp = new Map<string, number[]>();

function prune(ip: string, now: number): number[] {
  const list = attemptsByIp.get(ip) ?? [];
  const cutoff = now - WINDOW_MS;
  const kept = list.filter((t) => t > cutoff);
  if (kept.length > 0) {
    attemptsByIp.set(ip, kept);
  } else {
    attemptsByIp.delete(ip);
  }
  return kept;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const recent = prune(ip, now);
  if (recent.length < MAX_ATTEMPTS) {
    return { allowed: true };
  }
  const oldestInWindow = recent[0] ?? now;
  const retryAfterSeconds = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
  return { allowed: false, retryAfterSeconds };
}

export function recordAttempt(ip: string): void {
  const now = Date.now();
  const list = attemptsByIp.get(ip) ?? [];
  list.push(now);
  attemptsByIp.set(ip, list);
  prune(ip, now);
}

export function createRateLimiter(
  windowMs: number = WINDOW_MS,
  maxAttempts: number = MAX_ATTEMPTS
) {
  const store = new Map<string, number[]>();

  function pruneStore(key: string, now: number): number[] {
    const list = store.get(key) ?? [];
    const cutoff = now - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length > 0) {
      store.set(key, kept);
    } else {
      store.delete(key);
    }
    return kept;
  }

  return {
    check(ip: string): RateLimitResult {
      const now = Date.now();
      const recent = pruneStore(ip, now);
      if (recent.length < maxAttempts) {
        return { allowed: true };
      }
      const oldestInWindow = recent[0] ?? now;
      const retryAfterSeconds = Math.ceil(
        (oldestInWindow + windowMs - now) / 1000
      );
      return { allowed: false, retryAfterSeconds };
    },
    record(ip: string): void {
      const now = Date.now();
      const list = store.get(ip) ?? [];
      list.push(now);
      store.set(ip, list);
      pruneStore(ip, now);
    },
  };
}
