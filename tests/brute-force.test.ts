import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkBruteForce,
  recordFailedAttempt,
  clearFailedAttempts,
  createBruteForceProtection,
} from "../src/brute-force.js";

describe("brute force protection (progressive delays)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first attempt with no delay", () => {
    expect(checkBruteForce("192.168.1.1").allowed).toBe(true);
  });

  it("requires delay after one failed attempt", () => {
    recordFailedAttempt("192.168.1.2");
    const result = checkBruteForce("192.168.1.2");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1);
  });

  it("allows next attempt after base delay has passed", () => {
    recordFailedAttempt("192.168.1.3");
    expect(checkBruteForce("192.168.1.3").allowed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(checkBruteForce("192.168.1.3").allowed).toBe(true);
  });

  it("increases delay after each failed attempt (progressive)", () => {
    const key = "192.168.1.4";
    recordFailedAttempt(key);
    let r = checkBruteForce(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(1);

    vi.advanceTimersByTime(1000);
    recordFailedAttempt(key);
    r = checkBruteForce(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(2);

    vi.advanceTimersByTime(2000);
    recordFailedAttempt(key);
    r = checkBruteForce(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(4);
  });

  it("tracks keys independently", () => {
    recordFailedAttempt("10.0.0.1");
    recordFailedAttempt("10.0.0.1");
    recordFailedAttempt("10.0.0.2");
    expect(checkBruteForce("10.0.0.1").allowed).toBe(false);
    expect(checkBruteForce("10.0.0.2").allowed).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(checkBruteForce("10.0.0.1").allowed).toBe(false);
    expect(checkBruteForce("10.0.0.2").allowed).toBe(true);
  });

  it("clears delays after clearFailedAttempts", () => {
    recordFailedAttempt("10.0.0.3");
    expect(checkBruteForce("10.0.0.3").allowed).toBe(false);
    clearFailedAttempts("10.0.0.3");
    expect(checkBruteForce("10.0.0.3").allowed).toBe(true);
  });

  it("forgets old failures outside window", () => {
    const key = "192.168.1.5";
    recordFailedAttempt(key);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(checkBruteForce(key).allowed).toBe(true);
  });

  it("returns retryAfterSeconds >= 1 when not allowed", () => {
    recordFailedAttempt("192.168.1.7");
    const r = checkBruteForce("192.168.1.7");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeDefined();
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("caps delay at maxDelayMs", () => {
    const key = "192.168.1.6";
    for (let i = 0; i < 15; i++) {
      const r = checkBruteForce(key);
      if (!r.allowed) vi.advanceTimersByTime((r.retryAfterSeconds ?? 0) * 1000);
      recordFailedAttempt(key);
    }
    const r = checkBruteForce(key);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(301);
  });
});

describe("createBruteForceProtection (custom options)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom base and max delay", () => {
    const bf = createBruteForceProtection({
      baseDelayMs: 500,
      maxDelayMs: 2000,
    });
    bf.recordFailedAttempt("127.0.0.1");
    const r = bf.check("127.0.0.1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(1);
    vi.advanceTimersByTime(500);
    expect(bf.check("127.0.0.1").allowed).toBe(true);
  });

  it("uses custom window", () => {
    const bf = createBruteForceProtection({ windowMs: 1000 });
    bf.recordFailedAttempt("127.0.0.2");
    expect(bf.check("127.0.0.2").allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(bf.check("127.0.0.2").allowed).toBe(true);
  });

  it("clearFailedAttempts resets state for that key only", () => {
    const bf = createBruteForceProtection({ baseDelayMs: 100 });
    bf.recordFailedAttempt("a");
    bf.recordFailedAttempt("b");
    bf.clearFailedAttempts("a");
    expect(bf.check("a").allowed).toBe(true);
    expect(bf.check("b").allowed).toBe(false);
  });
});
