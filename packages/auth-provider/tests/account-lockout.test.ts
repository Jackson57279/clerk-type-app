import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkLockout,
  recordFailedAttempt,
  clearLockout,
  createAccountLockout,
} from "../src/account-lockout.js";

describe("account lockout (30 min after 10 failed attempts)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first attempt", () => {
    expect(checkLockout("user@example.com").allowed).toBe(true);
  });

  it("allows up to 9 failed attempts without locking", () => {
    const key = "user@example.com";
    for (let i = 0; i < 9; i++) {
      recordFailedAttempt(key);
    }
    expect(checkLockout(key).allowed).toBe(true);
  });

  it("locks after 10 failed attempts", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    const result = checkLockout(key);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(30 * 60);
  });

  it("unlocks after 30 minutes", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    expect(checkLockout(key).allowed).toBe(false);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(checkLockout(key).allowed).toBe(true);
  });

  it("returns retryAfterSeconds that decreases over time", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    let r = checkLockout(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(30 * 60);
    vi.advanceTimersByTime(10 * 60 * 1000);
    r = checkLockout(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(20 * 60);
  });

  it("clears lockout on clearLockout", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    expect(checkLockout(key).allowed).toBe(false);
    clearLockout(key);
    expect(checkLockout(key).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt("user1@example.com");
    }
    recordFailedAttempt("user2@example.com");
    expect(checkLockout("user1@example.com").allowed).toBe(false);
    expect(checkLockout("user2@example.com").allowed).toBe(true);
  });

  it("does not count failed attempts while locked", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    recordFailedAttempt(key);
    recordFailedAttempt(key);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(checkLockout(key).allowed).toBe(true);
  });

  it("resets attempt count after lockout expires", () => {
    const key = "user@example.com";
    for (let i = 0; i < 10; i++) {
      recordFailedAttempt(key);
    }
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(checkLockout(key).allowed).toBe(true);
    for (let i = 0; i < 9; i++) {
      recordFailedAttempt(key);
    }
    expect(checkLockout(key).allowed).toBe(true);
    recordFailedAttempt(key);
    expect(checkLockout(key).allowed).toBe(false);
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
    lockout.recordFailedAttempt("u");
    lockout.recordFailedAttempt("u");
    expect(lockout.check("u").allowed).toBe(true);
    lockout.recordFailedAttempt("u");
    const r = lockout.check("u");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(60);
    vi.advanceTimersByTime(60 * 1000);
    expect(lockout.check("u").allowed).toBe(true);
  });

  it("clearLockout resets state for that key only", () => {
    const lockout = createAccountLockout({ maxAttempts: 2 });
    lockout.recordFailedAttempt("a");
    lockout.recordFailedAttempt("a");
    lockout.recordFailedAttempt("b");
    lockout.recordFailedAttempt("b");
    lockout.clearLockout("a");
    expect(lockout.check("a").allowed).toBe(true);
    expect(lockout.check("b").allowed).toBe(false);
  });
});
