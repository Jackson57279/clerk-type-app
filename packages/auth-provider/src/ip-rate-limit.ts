const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

const store = new Map<string, number[]>();

function prune(ip: string, now: number): number[] {
  const list = store.get(ip) ?? [];
  const cutoff = now - WINDOW_MS;
  const kept = list.filter((t) => t > cutoff);
  if (kept.length > 0) {
    store.set(ip, kept);
  } else {
    store.delete(ip);
  }
  return kept;
}

export interface IpRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkIpRateLimit(ip: string): IpRateLimitResult {
  const now = Date.now();
  const recent = prune(ip, now);
  if (recent.length < MAX_ATTEMPTS_PER_WINDOW) return { allowed: true };
  const oldest = Math.min(...recent);
  const retryAfterSeconds = Math.ceil(
    (oldest + WINDOW_MS - now) / 1000
  );
  return {
    allowed: false,
    retryAfterSeconds: Math.max(0, retryAfterSeconds),
  };
}

export function recordIpAttempt(ip: string): void {
  const now = Date.now();
  const list = store.get(ip) ?? [];
  list.push(now);
  store.set(ip, list);
  prune(ip, now);
}

export function clearIpRateLimit(ip: string): void {
  store.delete(ip);
}

export interface IpRateLimitOptions {
  windowMs?: number;
  maxAttemptsPerWindow?: number;
}

export function createIpRateLimit(options: IpRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const maxAttempts = options.maxAttemptsPerWindow ?? MAX_ATTEMPTS_PER_WINDOW;
  const localStore = new Map<string, number[]>();

  function pruneLocal(key: string, now: number): number[] {
    const list = localStore.get(key) ?? [];
    const cutoff = now - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length > 0) {
      localStore.set(key, kept);
    } else {
      localStore.delete(key);
    }
    return kept;
  }

  return {
    check(ip: string): IpRateLimitResult {
      const now = Date.now();
      const recent = pruneLocal(ip, now);
      if (recent.length < maxAttempts) return { allowed: true };
      const oldest = Math.min(...recent);
      const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(0, retryAfterSeconds),
      };
    },
    recordAttempt(ip: string): void {
      const now = Date.now();
      const list = localStore.get(ip) ?? [];
      list.push(now);
      localStore.set(ip, list);
      pruneLocal(ip, now);
    },
    clear(ip: string): void {
      localStore.delete(ip);
    },
  };
}
