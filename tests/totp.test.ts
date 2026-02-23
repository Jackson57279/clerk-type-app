import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTOTP, verifyTOTP } from "../src/totp.js";

const RFC_SECRET = "12345678901234567890";

describe("generateTOTP", () => {
  it("returns a string of default 6 digits", () => {
    const code = generateTOTP(RFC_SECRET);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("matches RFC 6238 test vectors (SHA1)", () => {
    expect(
      generateTOTP(RFC_SECRET, { time: 59, period: 30, digits: 8 })
    ).toBe("94287082");
    expect(
      generateTOTP(RFC_SECRET, { time: 1111111109, period: 30, digits: 8 })
    ).toBe("07081804");
    expect(
      generateTOTP(RFC_SECRET, { time: 1111111111, period: 30, digits: 8 })
    ).toBe("14050471");
    expect(
      generateTOTP(RFC_SECRET, { time: 1234567890, period: 30, digits: 8 })
    ).toBe("89005924");
    expect(
      generateTOTP(RFC_SECRET, { time: 2000000000, period: 30, digits: 8 })
    ).toBe("69279037");
    expect(
      generateTOTP(RFC_SECRET, { time: 20000000000, period: 30, digits: 8 })
    ).toBe("65353130");
  });

  it("accepts Buffer secret", () => {
    const code = generateTOTP(Buffer.from(RFC_SECRET, "utf8"), {
      time: 59,
      period: 30,
      digits: 8,
    });
    expect(code).toBe("94287082");
  });

  it("uses custom digits", () => {
    const code = generateTOTP(RFC_SECRET, {
      time: 59,
      period: 30,
      digits: 6,
    });
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("uses custom period", () => {
    const code = generateTOTP(RFC_SECRET, { time: 60, period: 60, digits: 6 });
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe("verifyTOTP", () => {
  const fixedTime = 1111111111;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for valid token at current step", () => {
    const token = generateTOTP(RFC_SECRET, {
      time: fixedTime,
      period: 30,
      digits: 8,
    });
    expect(verifyTOTP(RFC_SECRET, token, { period: 30, digits: 8 })).toBe(
      true
    );
  });

  it("returns true for valid token within window", () => {
    const token = generateTOTP(RFC_SECRET, {
      time: fixedTime - 30,
      period: 30,
      digits: 8,
    });
    expect(
      verifyTOTP(RFC_SECRET, token, { period: 30, digits: 8, window: 1 })
    ).toBe(true);
  });

  it("returns false for wrong token", () => {
    expect(verifyTOTP(RFC_SECRET, "00000000", { period: 30, digits: 8 })).toBe(
      false
    );
  });

  it("returns false for wrong secret", () => {
    const token = generateTOTP(RFC_SECRET, {
      time: fixedTime,
      period: 30,
      digits: 8,
    });
    expect(
      verifyTOTP("wrong-secret", token, { period: 30, digits: 8 })
    ).toBe(false);
  });

  it("returns false for non-numeric or wrong-length token", () => {
    expect(verifyTOTP(RFC_SECRET, "12345", { period: 30, digits: 8 })).toBe(
      false
    );
    expect(verifyTOTP(RFC_SECRET, "123456789", { period: 30, digits: 8 })).toBe(
      false
    );
    expect(verifyTOTP(RFC_SECRET, "abcdef12", { period: 30, digits: 8 })).toBe(
      false
    );
  });
});
