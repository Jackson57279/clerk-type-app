const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_BEFORE_LOCK = 10;

interface Entry {
  failedCount: number;
  lockedUntil?: number;
}
const store = new Map<string, Entry>();

export interface LockoutResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function checkLockout(key: string): LockoutResult {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }
  if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
    store.delete(key);
    return { allowed: true };
  }
  return { allowed: true };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { failedCount: 0 };
    store.set(key, entry);
  }
  if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
    entry = { failedCount: 0 };
    store.set(key, entry);
  }
  if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
    return;
  }
  entry.failedCount++;
  if (entry.failedCount >= MAX_ATTEMPTS_BEFORE_LOCK) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
}

export function clearLockout(key: string): void {
  store.delete(key);
}

export interface AccountLockoutOptions {
  maxAttempts?: number;
  lockoutDurationMs?: number;
}

export function createAccountLockout(options: AccountLockoutOptions = {}) {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS_BEFORE_LOCK;
  const lockoutDurationMs =
    options.lockoutDurationMs ?? LOCKOUT_DURATION_MS;
  const store = new Map<string, Entry>();

  return {
    check(key: string): LockoutResult {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) return { allowed: true };
      if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
        };
      }
      if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
        store.delete(key);
        return { allowed: true };
      }
      return { allowed: true };
    },
    recordFailedAttempt(key: string): void {
      const now = Date.now();
      let entry = store.get(key);
      if (!entry) {
        entry = { failedCount: 0 };
        store.set(key, entry);
      }
      if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
        entry = { failedCount: 0 };
        store.set(key, entry);
      }
      if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
        return;
      }
      entry.failedCount++;
      if (entry.failedCount >= maxAttempts) {
        entry.lockedUntil = now + lockoutDurationMs;
      }
    },
    clearLockout(key: string): void {
      store.delete(key);
    },
  };
}
