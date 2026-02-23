import { describe, it, expect } from "vitest";
import {
  hashDeviceFingerprint,
  validateDeviceBinding,
} from "../src/device-binding.js";

describe("hashDeviceFingerprint", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashDeviceFingerprint("fp1");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for same input", () => {
    expect(hashDeviceFingerprint("same")).toBe(hashDeviceFingerprint("same"));
  });

  it("differs for different input", () => {
    expect(hashDeviceFingerprint("a")).not.toBe(hashDeviceFingerprint("b"));
  });

  it("normalizes by trimming whitespace", () => {
    expect(hashDeviceFingerprint("  fp  ")).toBe(hashDeviceFingerprint("fp"));
  });
});

describe("validateDeviceBinding", () => {
  it("returns true when no stored hash (binding optional)", () => {
    expect(
      validateDeviceBinding({
        storedFingerprintHash: null,
        currentFingerprint: "anything",
      })
    ).toBe(true);
    expect(
      validateDeviceBinding({
        storedFingerprintHash: null,
        currentFingerprint: null,
      })
    ).toBe(true);
  });

  it("returns true when stored hash is empty string (treated as optional)", () => {
    expect(
      validateDeviceBinding({
        storedFingerprintHash: "",
        currentFingerprint: null,
      })
    ).toBe(true);
  });

  it("returns false when stored hash present but current fingerprint missing", () => {
    const stored = hashDeviceFingerprint("device1");
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: null,
      })
    ).toBe(false);
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: undefined as unknown as string | null,
      })
    ).toBe(false);
  });

  it("returns true when current fingerprint hashes to stored hash", () => {
    const fp = "my-device-fingerprint";
    const stored = hashDeviceFingerprint(fp);
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: fp,
      })
    ).toBe(true);
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: "  my-device-fingerprint  ",
      })
    ).toBe(true);
  });

  it("returns false when current fingerprint does not match stored hash", () => {
    const stored = hashDeviceFingerprint("device1");
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: "device2",
      })
    ).toBe(false);
  });

  it("returns false when stored hash present but current fingerprint is empty string", () => {
    const stored = hashDeviceFingerprint("device1");
    expect(
      validateDeviceBinding({
        storedFingerprintHash: stored,
        currentFingerprint: "",
      })
    ).toBe(false);
  });

  it("returns true when stored hash is empty and current is empty (optional binding)", () => {
    expect(
      validateDeviceBinding({
        storedFingerprintHash: "",
        currentFingerprint: "",
      })
    ).toBe(true);
  });
});
