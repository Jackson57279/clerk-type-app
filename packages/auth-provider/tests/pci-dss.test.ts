import { describe, it, expect } from "vitest";
import {
  getPciDssCardDataPolicy,
  containsCardData,
  validateNoCardData,
} from "../src/pci-dss.js";

describe("getPciDssCardDataPolicy", () => {
  it("returns noCardDataStorage true", () => {
    const policy = getPciDssCardDataPolicy();
    expect(policy.noCardDataStorage).toBe(true);
  });
});

describe("containsCardData", () => {
  it("returns true for Luhn-valid 16-digit PAN", () => {
    expect(containsCardData("4111111111111111")).toBe(true);
    expect(containsCardData("4532015112830366")).toBe(true);
  });

  it("returns true for PAN with spaces or dashes", () => {
    expect(containsCardData("4111 1111 1111 1111")).toBe(true);
    expect(containsCardData("4532-0151-1283-0366")).toBe(true);
  });

  it("returns false for short digit strings", () => {
    expect(containsCardData("123456789012")).toBe(false);
  });

  it("returns false for 16 digits that fail Luhn", () => {
    expect(containsCardData("1234567890123450")).toBe(false);
  });

  it("returns false for non-card text", () => {
    expect(containsCardData("user@example.com")).toBe(false);
    expect(containsCardData("John Doe")).toBe(false);
  });

  it("returns false for empty or short input", () => {
    expect(containsCardData("")).toBe(false);
    expect(containsCardData("1234")).toBe(false);
  });
});

describe("validateNoCardData", () => {
  it("returns ok true when value has no card data", () => {
    expect(validateNoCardData("safe value")).toEqual({ ok: true });
    expect(validateNoCardData("1234567890123450")).toEqual({ ok: true });
  });

  it("returns ok false with reason when value contains PAN", () => {
    const result = validateNoCardData("4111111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("card data");
    }
  });
});
