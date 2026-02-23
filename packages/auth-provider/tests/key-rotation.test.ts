import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMemorySigningKeyStore,
  generateSigningKey,
  getKeyById,
  rotateIfNeeded,
  asKeySetView,
  startAutomaticKeyRotation,
  ROTATION_INTERVAL_DAYS,
  type SigningKey,
} from "../src/key-rotation.js";

describe("generateSigningKey", () => {
  it("returns key with id, secret, createdAt", () => {
    const key = generateSigningKey();
    expect(key.id).toBeDefined();
    expect(key.secret).toBeDefined();
    expect(key.createdAt).toBeGreaterThan(0);
    expect(key.id).toMatch(/^[a-f0-9]{16}$/);
    expect(key.secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different keys each call", () => {
    const a = generateSigningKey();
    const b = generateSigningKey();
    expect(a.id).not.toBe(b.id);
    expect(a.secret).not.toBe(b.secret);
  });
});

describe("createMemorySigningKeyStore", () => {
  it("starts with one key", () => {
    const store = createMemorySigningKeyStore();
    const current = store.getCurrent();
    expect(current).not.toBeNull();
    expect(store.getAll()).toHaveLength(1);
  });

  it("getCurrent returns first key", () => {
    const store = createMemorySigningKeyStore();
    const all = store.getAll();
    expect(store.getCurrent()).toEqual(all[0]);
  });

  it("setKeys replaces keys", () => {
    const store = createMemorySigningKeyStore();
    const k1 = generateSigningKey();
    const k2 = generateSigningKey();
    store.setKeys([k1, k2]);
    expect(store.getCurrent()).toEqual(k1);
    expect(store.getAll()).toHaveLength(2);
  });

  it("addKey prepends and keeps at most 2 keys", () => {
    const store = createMemorySigningKeyStore();
    const old = store.getCurrent()!;
    const next = generateSigningKey();
    store.addKey(next);
    expect(store.getCurrent()!.id).toBe(next.id);
    expect(store.getAll()).toHaveLength(2);
    expect(getKeyById(store, old.id)).toEqual(old);
    const another = generateSigningKey();
    store.addKey(another);
    expect(store.getAll()).toHaveLength(2);
    expect(store.getCurrent()!.id).toBe(another.id);
    expect(getKeyById(store, next.id)).not.toBeNull();
    expect(getKeyById(store, old.id)).toBeNull();
  });
});

describe("rotateIfNeeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not rotate when current key is younger than 90 days", () => {
    const store = createMemorySigningKeyStore();
    const before = store.getCurrent()!;
    vi.advanceTimersByTime((ROTATION_INTERVAL_DAYS - 1) * 24 * 60 * 60 * 1000);
    const rotated = rotateIfNeeded(store);
    expect(rotated).toBe(false);
    expect(store.getCurrent()!.id).toBe(before.id);
  });

  it("rotates when current key is at least 90 days old", () => {
    const store = createMemorySigningKeyStore();
    const old = store.getCurrent()!;
    vi.advanceTimersByTime(ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    const rotated = rotateIfNeeded(store);
    expect(rotated).toBe(true);
    expect(store.getCurrent()!.id).not.toBe(old.id);
    expect(store.getAll()).toHaveLength(2);
    expect(getKeyById(store, old.id)).not.toBeNull();
  });

  it("uses custom rotation interval when provided", () => {
    const store = createMemorySigningKeyStore();
    vi.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);
    const rotated = rotateIfNeeded(store, 7);
    expect(rotated).toBe(true);
  });

  it("adds first key when store has no current key", () => {
    const keys: SigningKey[] = [];
    const emptyStore: import("../src/key-rotation.js").SigningKeyStore = {
      getCurrent: () => keys[0] ?? null,
      getAll: () => [...keys],
      setKeys: (k) => keys.splice(0, keys.length, ...k),
      addKey: (k) => keys.unshift(k),
    };
    const rotated = rotateIfNeeded(emptyStore);
    expect(rotated).toBe(true);
    expect(emptyStore.getCurrent()).not.toBeNull();
    expect(emptyStore.getAll()).toHaveLength(1);
  });
});

describe("asKeySetView", () => {
  it("getCurrent and getKeyById match store", () => {
    const store = createMemorySigningKeyStore();
    const view = asKeySetView(store);
    const current = store.getCurrent()!;
    expect(view.getCurrent()).toEqual(current);
    expect(view.getKeyById(current.id)).toEqual(current);
    expect(view.getKeyById("nonexistent")).toBeNull();
  });
});

describe("startAutomaticKeyRotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls rotateIfNeeded on start", () => {
    const store = createMemorySigningKeyStore();
    const initial = store.getCurrent()!;
    startAutomaticKeyRotation(store);
    expect(store.getCurrent()!.id).toBe(initial.id);
  });

  it("rotates when key is 90+ days old and check runs", () => {
    const store = createMemorySigningKeyStore();
    const old = store.getCurrent()!;
    vi.advanceTimersByTime(ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    startAutomaticKeyRotation(store);
    expect(store.getCurrent()!.id).not.toBe(old.id);
    expect(store.getAll()).toHaveLength(2);
  });

  it("runs rotation on interval and rotates when due", () => {
    const store = createMemorySigningKeyStore();
    const old = store.getCurrent()!;
    const checkIntervalMs = 60 * 60 * 1000;
    startAutomaticKeyRotation(store, { checkIntervalMs });
    vi.advanceTimersByTime(ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    vi.advanceTimersByTime(checkIntervalMs);
    expect(store.getCurrent()!.id).not.toBe(old.id);
  });

  it("stop clears the interval", () => {
    const store = createMemorySigningKeyStore();
    const checkIntervalMs = 60 * 60 * 1000;
    const handle = startAutomaticKeyRotation(store, { checkIntervalMs });
    const idBeforeStop = store.getCurrent()!;
    handle.stop();
    vi.advanceTimersByTime(checkIntervalMs * 5);
    expect(store.getCurrent()!.id).toBe(idBeforeStop.id);
  });

  it("uses custom rotation interval when provided", () => {
    const store = createMemorySigningKeyStore();
    vi.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);
    startAutomaticKeyRotation(store, { rotationIntervalDays: 7 });
    expect(store.getAll()).toHaveLength(2);
  });
});
