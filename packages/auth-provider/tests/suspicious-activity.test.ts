import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateLogin,
  createSuspiciousActivityDetector,
  clearUserActivity,
} from "../src/suspicious-activity.js";

describe("suspicious activity detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearUserActivity("user1");
    clearUserActivity("user2");
  });

  describe("new device", () => {
    it("flags first login from a device as new_device", () => {
      const r = evaluateLogin({
        userId: "user1",
        deviceFingerprint: "device-A",
      });
      expect(r.suspicious).toBe(true);
      expect(r.reasons).toContain("new_device");
    });

    it("does not flag same device on second login", () => {
      evaluateLogin({ userId: "user1", deviceFingerprint: "device-A" });
      const r = evaluateLogin({ userId: "user1", deviceFingerprint: "device-A" });
      expect(r.reasons).not.toContain("new_device");
    });

    it("flags different device as new_device", () => {
      evaluateLogin({ userId: "user1", deviceFingerprint: "device-A" });
      const r = evaluateLogin({ userId: "user1", deviceFingerprint: "device-B" });
      expect(r.suspicious).toBe(true);
      expect(r.reasons).toContain("new_device");
    });

    it("ignores when deviceFingerprint is omitted", () => {
      const r = evaluateLogin({ userId: "user1" });
      expect(r.reasons).not.toContain("new_device");
    });

    it("ignores when deviceFingerprint is empty string", () => {
      const r = evaluateLogin({ userId: "user1", deviceFingerprint: "" });
      expect(r.reasons).not.toContain("new_device");
    });
  });

  describe("new location", () => {
    it("flags first login with location as new_location", () => {
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      expect(r.suspicious).toBe(true);
      expect(r.reasons).toContain("new_location");
    });

    it("does not flag same location on second login", () => {
      evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      expect(r.reasons).not.toContain("new_location");
    });

    it("flags sufficiently different location as new_location", () => {
      evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 40.71, lng: -74.01 },
      });
      expect(r.reasons).toContain("new_location");
    });
  });

  describe("impossible travel", () => {
    it("does not flag when only one login with location", () => {
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      expect(r.reasons).not.toContain("impossible_travel");
    });

    it("flags when two logins are far apart in short time", () => {
      evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      vi.advanceTimersByTime(5 * 60 * 1000);
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 35.68, lng: 139.69 },
      });
      expect(r.suspicious).toBe(true);
      expect(r.reasons).toContain("impossible_travel");
    });

    it("does not flag when enough time passed between distant logins", () => {
      evaluateLogin({
        userId: "user1",
        location: { lat: 37.77, lng: -122.42 },
      });
      vi.advanceTimersByTime(12 * 60 * 60 * 1000);
      const r = evaluateLogin({
        userId: "user1",
        location: { lat: 35.68, lng: 139.69 },
      });
      expect(r.reasons).not.toContain("impossible_travel");
    });
  });

  describe("velocity", () => {
    it("flags when too many logins in short window", () => {
      const userId = "user1";
      for (let i = 0; i < 5; i++) evaluateLogin({ userId });
      const r = evaluateLogin({ userId });
      expect(r.suspicious).toBe(true);
      expect(r.reasons).toContain("velocity");
    });

    it("does not flag when under threshold", () => {
      const userId = "user1";
      evaluateLogin({ userId });
      evaluateLogin({ userId });
      evaluateLogin({ userId });
      const r = evaluateLogin({ userId });
      expect(r.reasons).not.toContain("velocity");
    });

    it("resets after velocity window", () => {
      const userId = "user1";
      for (let i = 0; i < 5; i++) {
        evaluateLogin({ userId });
      }
      vi.advanceTimersByTime(6 * 60 * 1000);
      const r = evaluateLogin({ userId });
      expect(r.reasons).not.toContain("velocity");
    });
  });

  describe("clearUserActivity", () => {
    it("resets state so next login can trigger new_device again", () => {
      evaluateLogin({ userId: "user1", deviceFingerprint: "device-A" });
      clearUserActivity("user1");
      const r = evaluateLogin({ userId: "user1", deviceFingerprint: "device-A" });
      expect(r.reasons).toContain("new_device");
    });
  });
});

describe("createSuspiciousActivityDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom velocity threshold", () => {
    const det = createSuspiciousActivityDetector({
      maxLoginsInWindow: 3,
      velocityWindowMs: 60 * 1000,
    });
    const userId = "u1";
    det.evaluateLogin({ userId });
    det.evaluateLogin({ userId });
    det.evaluateLogin({ userId });
    const r = det.evaluateLogin({ userId });
    expect(r.reasons).toContain("velocity");
  });

  it("clearUser resets state for that user only", () => {
    const det = createSuspiciousActivityDetector();
    det.evaluateLogin({ userId: "u1", deviceFingerprint: "d1" });
    det.clearUser("u1");
    const r = det.evaluateLogin({ userId: "u1", deviceFingerprint: "d1" });
    expect(r.reasons).toContain("new_device");
  });

  it("uses custom maxSpeedKmh for impossible travel", () => {
    const det = createSuspiciousActivityDetector({ maxSpeedKmh: 500 });
    det.evaluateLogin({
      userId: "u1",
      location: { lat: 37.77, lng: -122.42 },
    });
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    const r = det.evaluateLogin({
      userId: "u1",
      location: { lat: 40.71, lng: -74.01 },
    });
    const distKm = 4149;
    const speedKmh = distKm / 2;
    expect(speedKmh).toBeGreaterThan(500);
    expect(r.reasons).toContain("impossible_travel");
  });
});
