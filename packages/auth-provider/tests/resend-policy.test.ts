import { describe, it, expect, vi } from "vitest";
import {
  checkResend,
  recordResend,
  createMemoryResendStore,
} from "../src/resend-policy.js";

describe("checkResend", () => {
  it("allows first resend when key has no state", () => {
    const store = createMemoryResendStore();
    expect(checkResend("user@example.com", store)).toEqual({ allowed: true });
  });

  it("allows resend after base delay has passed", () => {
    const store = createMemoryResendStore();
    recordResend("user@example.com", store);
    expect(checkResend("user@example.com", store)).toEqual({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
    expect((checkResend("user@example.com", store).retryAfterSeconds ?? 0)).toBeGreaterThan(0);
  });

  it("returns retryAfterSeconds that decreases as time passes", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    recordResend("key", store);
    const r1 = checkResend("key", store);
    expect(r1.allowed).toBe(false);
    const wait1 = r1.retryAfterSeconds ?? 0;
    vi.advanceTimersByTime(30 * 1000);
    const r2 = checkResend("key", store);
    expect(r2.allowed).toBe(false);
    expect((r2.retryAfterSeconds ?? 0)).toBeLessThanOrEqual(wait1);
    vi.useRealTimers();
  });

  it("allows resend after waiting base delay", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    recordResend("key", store);
    expect(checkResend("key", store).allowed).toBe(false);
    vi.advanceTimersByTime(61 * 1000);
    expect(checkResend("key", store)).toEqual({ allowed: true });
    vi.useRealTimers();
  });

  it("enforces exponential backoff on successive resends", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    const baseMs = 1000;
    recordResend("key", store);
    vi.advanceTimersByTime(500);
    expect(checkResend("key", store, { baseDelayMs: baseMs }).allowed).toBe(false);
    vi.advanceTimersByTime(600);
    expect(checkResend("key", store, { baseDelayMs: baseMs }).allowed).toBe(true);
    recordResend("key", store);
    expect(checkResend("key", store, { baseDelayMs: baseMs }).allowed).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(checkResend("key", store, { baseDelayMs: baseMs }).allowed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(checkResend("key", store, { baseDelayMs: baseMs }).allowed).toBe(true);
    vi.useRealTimers();
  });

  it("respects custom baseDelayMs and maxDelayMs", () => {
    const store = createMemoryResendStore();
    recordResend("key", store);
    const result = checkResend("key", store, {
      baseDelayMs: 120 * 1000,
      maxDelayMs: 600 * 1000,
    });
    expect(result.allowed).toBe(false);
    expect((result.retryAfterSeconds ?? 0)).toBeGreaterThan(100);
    expect((result.retryAfterSeconds ?? 0)).toBeLessThanOrEqual(120);
  });

  it("caps delay at maxDelayMs", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    for (let i = 0; i < 5; i++) {
      recordResend("key", store);
      vi.advanceTimersByTime(1);
    }
    const result = checkResend("key", store, {
      baseDelayMs: 60 * 1000,
      maxDelayMs: 10 * 1000,
    });
    expect(result.allowed).toBe(false);
    expect((result.retryAfterSeconds ?? 0)).toBeLessThanOrEqual(10);
    vi.useRealTimers();
  });

  it("different keys are independent", () => {
    const store = createMemoryResendStore();
    recordResend("a@x.com", store);
    expect(checkResend("a@x.com", store).allowed).toBe(false);
    expect(checkResend("b@x.com", store)).toEqual({ allowed: true });
  });

  it("uses exponential backoff: delay = base * 2^(count-1) capped at max", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    const baseMs = 1000;
    const maxMs = 20_000;
    for (let n = 1; n <= 4; n++) {
      recordResend("key", store);
      const result = checkResend("key", store, { baseDelayMs: baseMs, maxDelayMs: maxMs });
      expect(result.allowed).toBe(false);
      const expectedMs = Math.min(baseMs * Math.pow(2, n - 1), maxMs);
      expect((result.retryAfterSeconds ?? 0) * 1000).toBeGreaterThanOrEqual(expectedMs - 1);
      expect((result.retryAfterSeconds ?? 0) * 1000).toBeLessThanOrEqual(expectedMs + 1000);
      vi.advanceTimersByTime(expectedMs + 100);
    }
    vi.useRealTimers();
  });
});

describe("recordResend", () => {
  it("updates store so next checkResend reflects new state", () => {
    const store = createMemoryResendStore();
    expect(checkResend("k", store).allowed).toBe(true);
    recordResend("k", store);
    expect(checkResend("k", store).allowed).toBe(false);
  });

  it("increments count on each call", () => {
    vi.useFakeTimers();
    const store = createMemoryResendStore();
    recordResend("k", store);
    vi.advanceTimersByTime(61 * 1000);
    recordResend("k", store);
    expect(checkResend("k", store).allowed).toBe(false);
    const waitAfterFirst = checkResend("k", store).retryAfterSeconds ?? 0;
    vi.advanceTimersByTime(waitAfterFirst * 1000 + 1000);
    expect(checkResend("k", store).allowed).toBe(true);
    recordResend("k", store);
    const waitAfterSecond = checkResend("k", store).retryAfterSeconds ?? 0;
    expect(waitAfterSecond).toBeGreaterThan(waitAfterFirst);
    vi.useRealTimers();
  });
});

describe("createMemoryResendStore", () => {
  it("returns store that persists state per key", () => {
    const store = createMemoryResendStore();
    recordResend("x", store);
    expect(store.get("x")).toEqual({
      lastSentAt: expect.any(Number),
      count: 1,
    });
    expect(store.get("y")).toBeNull();
  });
});
