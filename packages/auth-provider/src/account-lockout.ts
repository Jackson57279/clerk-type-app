const LOCKOUT_AFTER_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

interface Entry {
  count: number;
  lockedUntil?: number;
}

const store = new Map<string, Entry>();

export interface AccountLockoutResult {
  locked: boolean;
  retryAfterSeconds?: number;
}

export function checkAccountLockout(key: string): AccountLockoutResult {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return { locked: false };
  if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
    store.delete(key);
    return { locked: false };
  }
  if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    return { locked: true, retryAfterSeconds };
  }
  return { locked: false };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const entry = store.get(key);
  if (entry?.lockedUntil !== undefined && now < entry.lockedUntil) return;
  const count = (entry && entry.lockedUntil === undefined ? entry.count : 0) + 1;
  const lockedUntil =
    count >= LOCKOUT_AFTER_ATTEMPTS ? now + LOCKOUT_DURATION_MS : undefined;
  store.set(key, { count, lockedUntil });
}

export function clearFailedAttempts(key: string): void {
  store.delete(key);
}

export interface AccountLockoutOptions {
  maxAttempts?: number;
  lockoutDurationMs?: number;
}

export function createAccountLockout(options: AccountLockoutOptions = {}) {
  const maxAttempts = options.maxAttempts ?? LOCKOUT_AFTER_ATTEMPTS;
  const lockoutDurationMs = options.lockoutDurationMs ?? LOCKOUT_DURATION_MS;
  const localStore = new Map<string, Entry>();

  return {
    check(key: string): AccountLockoutResult {
      const now = Date.now();
      const entry = localStore.get(key);
      if (!entry) return { locked: false };
      if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
        localStore.delete(key);
        return { locked: false };
      }
      if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
        const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
        return { locked: true, retryAfterSeconds };
      }
      return { locked: false };
    },
    recordFailedAttempt(key: string): void {
      const now = Date.now();
      const entry = localStore.get(key);
      if (entry?.lockedUntil !== undefined && now < entry.lockedUntil) return;
      const count =
        (entry && entry.lockedUntil === undefined ? entry.count : 0) + 1;
      const lockedUntil =
        count >= maxAttempts ? now + lockoutDurationMs : undefined;
      localStore.set(key, { count, lockedUntil });
    },
    clearFailedAttempts(key: string): void {
      localStore.delete(key);
    },
  };
}
