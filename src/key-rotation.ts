import { randomBytes } from "crypto";

export const ROTATION_INTERVAL_DAYS = 90;

export interface SigningKey {
  id: string;
  secret: string;
  createdAt: number;
}

export interface SigningKeyStore {
  getCurrent(): SigningKey | null;
  getAll(): SigningKey[];
  setKeys(keys: SigningKey[]): void;
  addKey(key: SigningKey): void;
}

export interface SigningKeySetView {
  getCurrent(): SigningKey | null;
  getKeyById(id: string): SigningKey | null;
}

export function generateSigningKey(): SigningKey {
  return {
    id: randomBytes(8).toString("hex"),
    secret: randomBytes(32).toString("hex"),
    createdAt: Date.now(),
  };
}

export function getKeyById(store: SigningKeyStore, id: string): SigningKey | null {
  return store.getAll().find((k) => k.id === id) ?? null;
}

export function rotateIfNeeded(
  store: SigningKeyStore,
  rotationIntervalDays: number = ROTATION_INTERVAL_DAYS
): boolean {
  const current = store.getCurrent();
  if (!current) {
    const key = generateSigningKey();
    store.addKey(key);
    return true;
  }
  const ageMs = Date.now() - current.createdAt;
  const intervalMs = rotationIntervalDays * 24 * 60 * 60 * 1000;
  if (ageMs < intervalMs) return false;
  store.addKey(generateSigningKey());
  return true;
}

export function createMemorySigningKeyStore(): SigningKeyStore {
  let keys: SigningKey[] = [generateSigningKey()];
  return {
    getCurrent() {
      return keys[0] ?? null;
    },
    getAll() {
      return [...keys];
    },
    setKeys(k: SigningKey[]) {
      keys = k.length ? k : [generateSigningKey()];
    },
    addKey(key: SigningKey) {
      keys = [key, ...keys.filter((k) => k.id !== key.id)].slice(0, 2);
    },
  };
}

export function asKeySetView(store: SigningKeyStore): SigningKeySetView {
  return {
    getCurrent: () => store.getCurrent(),
    getKeyById: (id: string) => getKeyById(store, id),
  };
}
