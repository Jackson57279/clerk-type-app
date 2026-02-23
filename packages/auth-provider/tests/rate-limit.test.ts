import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  recordAttempt,
  clearAttempts,
  createRateLimiter,
} from "../src/rate-limit.js";

describe("rate limit (default 5 per 15 min)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first 5 attempts from same IP", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip).allowed).toBe(true);
      recordAttempt(ip);
    }
  });

  it("blocks 6th attempt within window", () => {
    const ip = "192.168.1.2";
    for (let i = 0; i < 5; i++) recordAttempt(ip);
    const result = checkRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeDefined();
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows again after window passes", () => {
    const ip = "192.168.1.3";
    for (let i = 0; i < 5; i++) recordAttempt(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(checkRateLimit(ip).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 5; i++) recordAttempt("10.0.0.1");
    recordAttempt("10.0.0.2");
    expect(checkRateLimit("10.0.0.1").allowed).toBe(false);
    expect(checkRateLimit("10.0.0.2").allowed).toBe(true);
  });

  it("allows again after clearAttempts", () => {
    const ip = "192.168.1.4";
    for (let i = 0; i < 5; i++) recordAttempt(ip);
    expect(checkRateLimit(ip).allowed).toBe(false);
    clearAttempts(ip);
    expect(checkRateLimit(ip).allowed).toBe(true);
  });
});

describe("createRateLimiter (custom window)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces max attempts in window", () => {
    const limiter = createRateLimiter(1000, 3);
    const ip = "127.0.0.1";
    expect(limiter.check(ip).allowed).toBe(true);
    limiter.record(ip);
    limiter.record(ip);
    limiter.record(ip);
    expect(limiter.check(ip).allowed).toBe(false);
  });

  it("allows after window slides", () => {
    const limiter = createRateLimiter(1000, 2);
    const ip = "127.0.0.2";
    limiter.record(ip);
    limiter.record(ip);
    expect(limiter.check(ip).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.check(ip).allowed).toBe(true);
  });

  it("retryAfterSeconds decreases as time passes", () => {
    const limiter = createRateLimiter(1000, 1);
    const ip = "127.0.0.3";
    limiter.record(ip);
    const r1 = limiter.check(ip);
    expect(r1.allowed).toBe(false);
    expect(r1.retryAfterSeconds).toBeGreaterThan(0);
    vi.advanceTimersByTime(500);
    const r2 = limiter.check(ip);
    expect(r2.allowed).toBe(false);
    expect((r2.retryAfterSeconds ?? 0)).toBeLessThanOrEqual(
      (r1.retryAfterSeconds ?? 0)
    );
  });
});
