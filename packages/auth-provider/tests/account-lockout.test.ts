import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAccountLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  createAccountLockout,
} from "../src/account-lockout.js";

describe("account lockout (30 min after 10 failed attempts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses default 10 attempts and 30 min lockout", () => {
    const key = "u@test.com";
    for (let i = 0; i < 9; i++) recordFailedAttempt(key);
    expect(checkAccountLockout(key).locked).toBe(false);
    recordFailedAttempt(key);
    const r = checkAccountLockout(key);
    expect(r.locked).toBe(true);
    expect(r.retryAfterSeconds).toBe(30 * 60);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(checkAccountLockout(key).locked).toBe(false);
  });

  it("allows first attempt with no lock", () => {
    expect(checkAccountLockout("user@example.com").locked).toBe(false);
  });

  it("does not lock before 10 failed attempts", () => {
    const key = "user@example.com";
    for (let i = 0; i < 9; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(false);
  });

  it("locks after 10 failed attempts", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    const result = checkAccountLockout(key);
    expect(result.locked).toBe(true);
    expect(result.retryAfterSeconds).toBe(30 * 60);
  });

  it("unlocks after 30 minutes", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(true);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(checkAccountLockout(key).locked).toBe(false);
  });

  it("retryAfterSeconds decreases as time passes", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    let r = checkAccountLockout(key);
    expect(r.locked).toBe(true);
    const initialRetry = r.retryAfterSeconds ?? 0;
    vi.advanceTimersByTime(10 * 60 * 1000);
    r = checkAccountLockout(key);
    expect(r.locked).toBe(true);
    expect((r.retryAfterSeconds ?? 0)).toBeLessThan(initialRetry);
  });

  it("clears lock and count on clearFailedAttempts", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(true);
    clearFailedAttempts(key);
    expect(checkAccountLockout(key).locked).toBe(false);
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(false);
  });

  it("tracks accounts independently", () => {
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt("a@x.com");
    }
    recordFailedAttempt("b@x.com");
    expect(checkAccountLockout("a@x.com").locked).toBe(true);
    expect(checkAccountLockout("b@x.com").locked).toBe(false);
  });

  it("after lock expires, next failure counts from one", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(true);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(checkAccountLockout(key).locked).toBe(false);
    for (let i = 0; i < 9; i++) {
      recordFailedAttempt(key);
    }
    expect(checkAccountLockout(key).locked).toBe(false);
    recordFailedAttempt(key);
    expect(checkAccountLockout(key).locked).toBe(true);
  });
});

describe("createAccountLockout (custom options)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom max attempts and lockout duration", () => {
    const lockout = createAccountLockout({
      maxAttempts: 3,
      lockoutDurationMs: 60 * 1000,
    });
    lockout.recordFailedAttempt("u@x.com");
    lockout.recordFailedAttempt("u@x.com");
    expect(lockout.check("u@x.com").locked).toBe(false);
    lockout.recordFailedAttempt("u@x.com");
    const r = lockout.check("u@x.com");
    expect(r.locked).toBe(true);
    expect(r.retryAfterSeconds).toBe(60);
    vi.advanceTimersByTime(61 * 1000);
    expect(lockout.check("u@x.com").locked).toBe(false);
  });

  it("clearFailedAttempts resets state for that key only", () => {
    const lockout = createAccountLockout({ maxAttempts: 2 });
    lockout.recordFailedAttempt("a");
    lockout.recordFailedAttempt("a");
    lockout.recordFailedAttempt("b");
    lockout.recordFailedAttempt("b");
    lockout.clearFailedAttempts("a");
    expect(lockout.check("a").locked).toBe(false);
    expect(lockout.check("b").locked).toBe(true);
  });
});
