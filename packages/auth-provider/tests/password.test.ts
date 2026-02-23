import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  validatePasswordWithPolicy,
  validatePasswordWithEnv,
  isPasswordPwned,
  getPasswordPolicyFromEnv,
  getPasswordPolicyRequirements,
  getPasswordPolicyConfig,
  defaultPasswordPolicy,
  type PasswordPolicy,
} from "../src/password.js";

describe("Argon2id password hashing", () => {
  it("hashes a password and returns a string", async () => {
    const hash = await hashPassword("my-secret-password");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).toMatch(/^\$argon2id/);
  });

  it("uses strong Argon2id parameters", async () => {
    const hash = await hashPassword("param-check");
    const parts = hash.split("$");
    const params = parts[3] ?? "";

    const getParam = (key: string): number => {
      const match = new RegExp(`${key}=(\\d+)`).exec(params);
      return match ? Number.parseInt(match[1] ?? "", 10) : 0;
    };

    const memory = getParam("m");
    const time = getParam("t");
    const parallelism = getParam("p");

    expect(memory).toBeGreaterThanOrEqual(65536);
    expect(time).toBeGreaterThanOrEqual(3);
    expect(parallelism).toBeGreaterThanOrEqual(1);
  });

  it("produces different hashes for the same password (salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifies correct password", async () => {
    const hash = await hashPassword("correct");
    const ok = await verifyPassword(hash, "correct");
    expect(ok).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct");
    const ok = await verifyPassword(hash, "wrong");
    expect(ok).toBe(false);
  });

  it("rejects empty password when hash was from non-empty", async () => {
    const hash = await hashPassword("secret");
    const ok = await verifyPassword(hash, "");
    expect(ok).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const pwd = "pässwörd_🔐";
    const hash = await hashPassword(pwd);
    expect(await verifyPassword(hash, pwd)).toBe(true);
    expect(await verifyPassword(hash, "other")).toBe(false);
  });

  it("rejects malformed or non-Argon2 hash", async () => {
    expect(await verifyPassword("not-a-valid-hash", "any")).toBe(false);
    expect(await verifyPassword("$argon2i$v=19$m=64,t=1,p=1$c29tZXNhbHQ$invalid", "any")).toBe(false);
  });
});

describe("Password policy", () => {
  it("rejects empty password", () => {
    const r = validatePassword("");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at least"))).toBe(true);
  });

  it("accepts password meeting default policy (min 8, lowercase, digit)", () => {
    const r = validatePassword("secret12");
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects password shorter than min length", () => {
    const r = validatePassword("short1");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at least 8"))).toBe(true);
  });

  it("rejects password without digit when required", () => {
    const r = validatePassword("nouppercase");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("digit"))).toBe(true);
  });

  it("rejects password without lowercase when required", () => {
    const r = validatePassword("ALLUPPER12");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("lowercase"))).toBe(true);
  });

  it("enforces uppercase when required by custom policy", () => {
    const policy: PasswordPolicy = { ...defaultPasswordPolicy, requireUppercase: true };
    expect(validatePassword("lowercase1", policy).valid).toBe(false);
    expect(validatePassword("Lowercase1", policy).valid).toBe(true);
  });

  it("enforces special character when required by custom policy", () => {
    const policy: PasswordPolicy = { ...defaultPasswordPolicy, requireSpecial: true };
    expect(validatePassword("nouppercase1", policy).valid).toBe(false);
    expect(validatePassword("nouppercase1!", policy).valid).toBe(true);
  });

  it("enforces custom min length", () => {
    const policy: PasswordPolicy = { ...defaultPasswordPolicy, minLength: 12 };
    expect(validatePassword("short1a", policy).valid).toBe(false);
    expect(validatePassword("longenough1a", policy).valid).toBe(true);
  });

  it("rejects password longer than max length (default 128)", () => {
    const long = "a".repeat(127) + "1";
    expect(validatePassword(long).valid).toBe(true);
    const tooLong = "a".repeat(129) + "1";
    const r = validatePassword(tooLong);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at most 128"))).toBe(true);
  });

  it("enforces custom max length when set", () => {
    const policy: PasswordPolicy = { ...defaultPasswordPolicy, maxLength: 16 };
    expect(validatePassword("short1ab", policy).valid).toBe(true);
    const r = validatePassword("thispasswordistoolong1", policy);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at most 16"))).toBe(true);
  });
});

describe("getPasswordPolicyFromEnv", () => {
  it("returns default policy when env is empty", () => {
    const policy = getPasswordPolicyFromEnv({});
    expect(policy.minLength).toBe(8);
    expect(policy.maxLength).toBe(128);
    expect(policy.requireUppercase).toBe(false);
    expect(policy.requireLowercase).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.requireSpecial).toBe(false);
  });

  it("reads PASSWORD_MIN_LENGTH from env", () => {
    const policy = getPasswordPolicyFromEnv({ PASSWORD_MIN_LENGTH: "12" });
    expect(policy.minLength).toBe(12);
  });

  it("reads PASSWORD_MAX_LENGTH from env", () => {
    const policy = getPasswordPolicyFromEnv({ PASSWORD_MAX_LENGTH: "64" });
    expect(policy.maxLength).toBe(64);
  });

  it("reads PASSWORD_REQUIRE_UPPERCASE from env", () => {
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_UPPERCASE: "1" }).requireUppercase).toBe(true);
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_UPPERCASE: "true" }).requireUppercase).toBe(true);
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_UPPERCASE: "0" }).requireUppercase).toBe(false);
  });

  it("reads PASSWORD_REQUIRE_LOWERCASE from env (default true when unset)", () => {
    expect(getPasswordPolicyFromEnv({}).requireLowercase).toBe(true);
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_LOWERCASE: "false" }).requireLowercase).toBe(false);
  });

  it("reads PASSWORD_REQUIRE_DIGIT from env (default true when unset)", () => {
    expect(getPasswordPolicyFromEnv({}).requireDigit).toBe(true);
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_DIGIT: "0" }).requireDigit).toBe(false);
  });

  it("reads PASSWORD_REQUIRE_SPECIAL from env", () => {
    expect(getPasswordPolicyFromEnv({ PASSWORD_REQUIRE_SPECIAL: "yes" }).requireSpecial).toBe(true);
    expect(getPasswordPolicyFromEnv({}).requireSpecial).toBe(false);
  });

  it("falls back to default for invalid numeric env", () => {
    const policy = getPasswordPolicyFromEnv({ PASSWORD_MIN_LENGTH: "abc" });
    expect(policy.minLength).toBe(8);
  });

  it("ensures maxLength >= minLength when min is larger than max from env", () => {
    const policy = getPasswordPolicyFromEnv({
      PASSWORD_MIN_LENGTH: "64",
      PASSWORD_MAX_LENGTH: "32",
    });
    expect(policy.minLength).toBe(64);
    expect(policy.maxLength).toBe(64);
  });
});

describe("getPasswordPolicyRequirements", () => {
  it("returns default policy requirements (min, max, lowercase, digit)", () => {
    const reqs = getPasswordPolicyRequirements();
    expect(reqs).toContain("Password must be at least 8 characters");
    expect(reqs).toContain("Password must be at most 128 characters");
    expect(reqs).toContain("Password must contain at least one lowercase letter");
    expect(reqs).toContain("Password must contain at least one digit");
    expect(reqs).not.toContain("Password must contain at least one uppercase letter");
    expect(reqs).not.toContain("Password must contain at least one special character");
    expect(reqs).toHaveLength(4);
  });

  it("includes uppercase and special when required by policy", () => {
    const policy: PasswordPolicy = {
      ...defaultPasswordPolicy,
      requireUppercase: true,
      requireSpecial: true,
    };
    const reqs = getPasswordPolicyRequirements(policy);
    expect(reqs).toContain("Password must contain at least one uppercase letter");
    expect(reqs).toContain("Password must contain at least one special character");
    expect(reqs).toHaveLength(6);
  });

  it("uses custom min and max length in requirement text", () => {
    const policy: PasswordPolicy = { ...defaultPasswordPolicy, minLength: 12, maxLength: 64 };
    const reqs = getPasswordPolicyRequirements(policy);
    expect(reqs).toContain("Password must be at least 12 characters");
    expect(reqs).toContain("Password must be at most 64 characters");
  });
});

describe("getPasswordPolicyConfig", () => {
  it("returns policy, requirements and checkBreach from env", () => {
    const config = getPasswordPolicyConfig({});
    expect(config.policy).toEqual(defaultPasswordPolicy);
    expect(config.requirements).toContain("Password must be at least 8 characters");
    expect(config.requirements).toContain("Password must contain at least one digit");
    expect(config.checkBreach).toBe(false);
  });

  it("uses env for policy and sets checkBreach when PASSWORD_CHECK_BREACH is true", () => {
    const config = getPasswordPolicyConfig({
      PASSWORD_MIN_LENGTH: "12",
      PASSWORD_REQUIRE_SPECIAL: "true",
      PASSWORD_CHECK_BREACH: "1",
    });
    expect(config.policy.minLength).toBe(12);
    expect(config.policy.requireSpecial).toBe(true);
    expect(config.requirements).toContain("Password must be at least 12 characters");
    expect(config.requirements).toContain("Password must contain at least one special character");
    expect(config.checkBreach).toBe(true);
  });

  it("validates passwords against returned policy", () => {
    const config = getPasswordPolicyConfig({ PASSWORD_MIN_LENGTH: "10" });
    expect(validatePassword("short1a", config.policy).valid).toBe(false);
    expect(validatePassword("longenough1a", config.policy).valid).toBe(true);
  });
});

describe("validatePasswordWithEnv", () => {
  it("uses policy from env and rejects short password when PASSWORD_MIN_LENGTH is set", async () => {
    const r = await validatePasswordWithEnv("short1a", { PASSWORD_MIN_LENGTH: "12" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at least 12"))).toBe(true);
  });

  it("accepts valid password when policy from env is satisfied", async () => {
    const r = await validatePasswordWithEnv("validpass12", {});
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("does not check breach when PASSWORD_CHECK_BREACH is unset", async () => {
    const r = await validatePasswordWithEnv("validpass1", {});
    expect(r.valid).toBe(true);
  });

  it("checks breach when PASSWORD_CHECK_BREACH is true", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("5BAA6")) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\nOTHERSUFFIX:1"
              ),
          } as Response);
        }
        return Promise.resolve({ ok: false } as Response);
      })
    );
    try {
      const env = { PASSWORD_REQUIRE_DIGIT: "0", PASSWORD_CHECK_BREACH: "true" };
      const r = await validatePasswordWithEnv("password", env);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("breach"))).toBe(true);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});

describe("validatePasswordWithPolicy (policy + optional breach)", () => {
  it("returns sync validation result when checkBreach is false", async () => {
    const r = await validatePasswordWithPolicy("short1", defaultPasswordPolicy, { checkBreach: false });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("at least 8"))).toBe(true);
  });

  it("accepts valid password when checkBreach is false", async () => {
    const r = await validatePasswordWithPolicy("validpass1", defaultPasswordPolicy, { checkBreach: false });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("does not call breach API when checkBreach is omitted", async () => {
    const r = await validatePasswordWithPolicy("validpass1");
    expect(r.valid).toBe(true);
  });
});

describe("HaveIBeenPwned breach detection", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("5BAA6")) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\nOTHERSUFFIX:1"
              ),
          } as Response);
        }
        return Promise.resolve({ ok: false } as Response);
      })
    );
  });
  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  it("returns true when password is in breach list", async () => {
    const pwned = await isPasswordPwned("password");
    expect(pwned).toBe(true);
  });

  it("validatePasswordWithPolicy with checkBreach adds breach error when pwned", async () => {
    const permissive: PasswordPolicy = { ...defaultPasswordPolicy, requireDigit: false };
    const r = await validatePasswordWithPolicy("password", permissive, { checkBreach: true });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("data breach"))).toBe(true);
  });

  it("validatePasswordWithPolicy with checkBreach returns valid when not pwned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve("OTHERSUFFIX:1\r\nANOTHER:2"),
        } as Response)
      )
    );
    const r = await validatePasswordWithPolicy("uniqueUnbreachedPwd99!", defaultPasswordPolicy, { checkBreach: true });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("returns false when password is not in breach list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve("OTHERSUFFIX:1\r\nANOTHER:2"),
        } as Response)
      )
    );
    const pwned = await isPasswordPwned("uniqueUnbreachedPwd99!");
    expect(pwned).toBe(false);
  });

  it("returns false when API request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false } as Response))
    );
    const pwned = await isPasswordPwned("anything");
    expect(pwned).toBe(false);
  });

  it("uses HIBP_RANGE_URL from env when set", async () => {
    const customBase = "https://custom-hibp.example.com/range";
    const fetchMock = vi.fn((url: string) => {
      expect(url.startsWith(customBase)).toBe(true);
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    await isPasswordPwned("anypassword", { HIBP_RANGE_URL: customBase });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
