const WINDOW_MS = 15 * 60 * 1000;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

const attemptsByKey = new Map<string, number[]>();

export function delayMsForFailureCount(
  count: number,
  baseMs: number,
  maxMs: number
): number {
  if (count <= 0) return 0;
  const delay = baseMs * Math.pow(2, count - 1);
  return Math.min(delay, maxMs);
}

function prune(key: string, now: number): number[] {
  const list = attemptsByKey.get(key) ?? [];
  const cutoff = now - WINDOW_MS;
  const kept = list.filter((t) => t > cutoff);
  if (kept.length > 0) {
    attemptsByKey.set(key, kept);
  } else {
    attemptsByKey.delete(key);
  }
  return kept;
}

export interface BruteForceResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkBruteForce(key: string): BruteForceResult {
  const now = Date.now();
  const recent = prune(key, now);
  if (recent.length === 0) return { allowed: true };

  const lastFailure = recent[recent.length - 1] ?? now;
  const requiredDelayMs = delayMsForFailureCount(
    recent.length,
    BASE_DELAY_MS,
    MAX_DELAY_MS
  );
  const elapsed = now - lastFailure;
  if (elapsed >= requiredDelayMs) return { allowed: true };

  const retryAfterSeconds = Math.ceil((requiredDelayMs - elapsed) / 1000);
  return { allowed: false, retryAfterSeconds };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const list = attemptsByKey.get(key) ?? [];
  list.push(now);
  attemptsByKey.set(key, list);
  prune(key, now);
}

export function clearFailedAttempts(key: string): void {
  attemptsByKey.delete(key);
}

export interface BruteForceOptions {
  windowMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function createBruteForceProtection(options: BruteForceOptions = {}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
  const store = new Map<string, number[]>();

  function pruneStore(k: string, now: number): number[] {
    const list = store.get(k) ?? [];
    const cutoff = now - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length > 0) {
      store.set(k, kept);
    } else {
      store.delete(k);
    }
    return kept;
  }

  return {
    check(key: string): BruteForceResult {
      const now = Date.now();
      const recent = pruneStore(key, now);
      if (recent.length === 0) return { allowed: true };

      const lastFailure = recent[recent.length - 1] ?? now;
      const requiredDelayMs = delayMsForFailureCount(
        recent.length,
        baseDelayMs,
        maxDelayMs
      );
      const elapsed = now - lastFailure;
      if (elapsed >= requiredDelayMs) return { allowed: true };

      const retryAfterSeconds = Math.ceil((requiredDelayMs - elapsed) / 1000);
      return { allowed: false, retryAfterSeconds };
    },
    recordFailedAttempt(key: string): void {
      const now = Date.now();
      const list = store.get(key) ?? [];
      list.push(now);
      store.set(key, list);
      pruneStore(key, now);
    },
    clearFailedAttempts(key: string): void {
      store.delete(key);
    },
  };
}
