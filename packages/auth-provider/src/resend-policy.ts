const DEFAULT_BASE_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_DELAY_MS = 60 * 60 * 1000;

export interface ResendPolicyState {
  lastSentAt: number;
  count: number;
}

export interface ResendPolicyStore {
  get(key: string): ResendPolicyState | null;
  set(key: string, state: ResendPolicyState): void;
}

export interface ResendPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface ResendPolicyResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

function delayMsForCount(count: number, baseMs: number, maxMs: number): number {
  if (count <= 0) return 0;
  const delay = baseMs * Math.pow(2, count - 1);
  return Math.min(delay, maxMs);
}

export function checkResend(
  key: string,
  store: ResendPolicyStore,
  options: ResendPolicyOptions = {}
): ResendPolicyResult {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const now = Date.now();

  const state = store.get(key);
  if (!state) return { allowed: true };

  const delayMs = delayMsForCount(state.count, baseDelayMs, maxDelayMs);
  const nextAllowedAt = state.lastSentAt + delayMs;
  if (now >= nextAllowedAt) return { allowed: true };

  const retryAfterSeconds = Math.ceil((nextAllowedAt - now) / 1000);
  return { allowed: false, retryAfterSeconds };
}

export function recordResend(key: string, store: ResendPolicyStore): void {
  const now = Date.now();
  const state = store.get(key);
  const count = state ? state.count + 1 : 1;
  store.set(key, { lastSentAt: now, count });
}

export function createMemoryResendStore(): ResendPolicyStore {
  const map = new Map<string, ResendPolicyState>();
  return {
    get(key: string) {
      return map.get(key) ?? null;
    },
    set(key: string, state: ResendPolicyState) {
      map.set(key, state);
    },
  };
}
