import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkIpRateLimit,
  recordIpAttempt,
  clearIpRateLimit,
  createIpRateLimit,
} from "../src/ip-rate-limit.js";

describe("ip rate limit (5 attempts per 15 minutes per IP)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first attempt", () => {
    expect(checkIpRateLimit("192.168.1.1").allowed).toBe(true);
  });

  it("allows up to 5 attempts within 15 minutes", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 4; i++) {
      recordIpAttempt(ip);
    }
    expect(checkIpRateLimit(ip).allowed).toBe(true);
    recordIpAttempt(ip);
    expect(checkIpRateLimit(ip).allowed).toBe(false);
  });

  it("blocks when 5 attempts in window", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      recordIpAttempt(ip);
    }
    const result = checkIpRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("returns retryAfterSeconds until window slides", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      recordIpAttempt(ip);
    }
    let r = checkIpRateLimit(ip);
    expect(r.allowed).toBe(false);
    const initialRetry = r.retryAfterSeconds ?? 0;
    vi.advanceTimersByTime(5 * 60 * 1000);
    r = checkIpRateLimit(ip);
    expect(r.allowed).toBe(false);
    expect((r.retryAfterSeconds ?? 0)).toBeLessThan(initialRetry);
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(checkIpRateLimit(ip).allowed).toBe(true);
  });

  it("allows again after 15 minutes from first attempt", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      recordIpAttempt(ip);
    }
    expect(checkIpRateLimit(ip).allowed).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(checkIpRateLimit(ip).allowed).toBe(true);
  });

  it("clears rate limit on clearIpRateLimit", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      recordIpAttempt(ip);
    }
    expect(checkIpRateLimit(ip).allowed).toBe(false);
    clearIpRateLimit(ip);
    expect(checkIpRateLimit(ip).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 5; i++) {
      recordIpAttempt("10.0.0.1");
    }
    recordIpAttempt("10.0.0.2");
    expect(checkIpRateLimit("10.0.0.1").allowed).toBe(false);
    expect(checkIpRateLimit("10.0.0.2").allowed).toBe(true);
  });
});

describe("createIpRateLimit (custom options)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom max attempts and window", () => {
    const limiter = createIpRateLimit({
      maxAttemptsPerWindow: 3,
      windowMs: 60 * 1000,
    });
    limiter.recordAttempt("127.0.0.1");
    limiter.recordAttempt("127.0.0.1");
    expect(limiter.check("127.0.0.1").allowed).toBe(true);
    limiter.recordAttempt("127.0.0.1");
    const r = limiter.check("127.0.0.1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
    vi.advanceTimersByTime(61 * 1000);
    expect(limiter.check("127.0.0.1").allowed).toBe(true);
  });

  it("clear resets state for that IP only", () => {
    const limiter = createIpRateLimit({ maxAttemptsPerWindow: 2 });
    limiter.recordAttempt("a");
    limiter.recordAttempt("a");
    limiter.recordAttempt("a");
    limiter.recordAttempt("b");
    limiter.recordAttempt("b");
    limiter.recordAttempt("b");
    limiter.clear("a");
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(false);
  });
});
