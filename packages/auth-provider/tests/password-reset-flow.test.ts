import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestPasswordReset,
  resetPasswordWithToken,
} from "../src/password-reset-flow.js";
import { createMemoryUsedTokenStore } from "../src/password-reset.js";
import { createPasswordResetToken } from "../src/password-reset.js";
import {
  validatePasswordWithPolicy,
  defaultPasswordPolicy,
} from "../src/password.js";

const SECRET = "reset-secret";

describe("requestPasswordReset", () => {
  it("returns sent: true without calling sendEmail when user not found", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue(null);
    const sendEmail = vi.fn();

    const result = await requestPasswordReset({
      email: "nobody@example.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink: (t) => `https://app.example.com/reset?token=${t}`,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("nobody@example.com");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("creates token, builds link, sends email when user found", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildResetLink = vi.fn((token: string) => `https://app.example.com/reset?t=${token}`);

    const result = await requestPasswordReset({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("user@example.com");
    expect(buildResetLink).toHaveBeenCalledTimes(1);
    const tokenArg = (buildResetLink.mock.calls[0] as string[])[0];
    expect(tokenArg).toBeDefined();
    expect(tokenArg).toContain(".");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        html: expect.stringContaining("Reset your password"),
        text: expect.stringContaining("Reset your password"),
      })
    );
    const sentArgs = sendEmail.mock.calls[0];
    const sentHtml = sentArgs && sentArgs[0] ? (sentArgs[0] as { html: string }).html : "";
    expect(sentHtml).toContain("https://app.example.com/reset?t=");
  });

  it("uses fallbackSendEmail when primary sendEmail fails", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const fallbackSendEmail = vi.fn().mockResolvedValue(undefined);
    const buildResetLink = (t: string) => `https://app.example.com/reset?t=${t}`;

    const result = await requestPasswordReset({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink,
      sendEmail,
      fallbackSendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(fallbackSendEmail).toHaveBeenCalledTimes(1);
    expect(fallbackSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        html: expect.stringContaining("Reset your password"),
        text: expect.stringContaining("Reset your password"),
      })
    );
  });

  it("throws when both sendEmail and fallbackSendEmail fail", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const fallbackSendEmail = vi.fn().mockRejectedValue(new Error("Fallback down"));
    const buildResetLink = (t: string) => `https://app.example.com/reset?t=${t}`;

    await expect(
      requestPasswordReset({
        email: "user@example.com",
        secret: SECRET,
        findUserByEmail,
        buildResetLink,
        sendEmail,
        fallbackSendEmail,
        isAllowedEmail: () => true,
      })
    ).rejects.toThrow("Failed to send password reset email");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(fallbackSendEmail).toHaveBeenCalledTimes(1);
  });

  it("throws when sendEmail fails and no fallback provided", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const buildResetLink = (t: string) => `https://app.example.com/reset?t=${t}`;

    await expect(
      requestPasswordReset({
        email: "user@example.com",
        secret: SECRET,
        findUserByEmail,
        buildResetLink,
        sendEmail,
        isAllowedEmail: () => true,
      })
    ).rejects.toThrow("Failed to send password reset email");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("uses custom branding (logo, colors) in sent email", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildResetLink = (t: string) => `https://app.example.com/reset?t=${t}`;

    await requestPasswordReset({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink,
      sendEmail,
      isAllowedEmail: () => true,
      branding: {
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#dc2626",
        companyName: "Acme",
      },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("https://cdn.example.com/logo.png");
    expect(payload?.html).toContain("#dc2626");
    expect(payload?.html).toContain("Acme");
  });

  it("uses custom htmlTemplate and textTemplate when provided", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildResetLink = (t: string) => `https://app.example.com/reset?t=${t}`;

    await requestPasswordReset({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink,
      sendEmail,
      isAllowedEmail: () => true,
      htmlTemplate: "<p>Custom: {{resetLink}} ({{expiresInMinutes}} min)</p>",
      textTemplate: "Custom: {{resetLink}} ({{expiresInMinutes}} min)",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("Custom:");
    expect(payload?.html).toContain("https://app.example.com/reset?t=");
    expect(payload?.html).not.toContain("{{resetLink}}");
    expect(payload?.text).toContain("Custom:");
    expect(payload?.text).not.toContain("{{resetLink}}");
  });

  it("returns sent: true without calling findUserByEmail or sendEmail when email domain not allowed (default @company.com)", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@gmail.com",
    });
    const sendEmail = vi.fn();

    const result = await requestPasswordReset({
      email: "user@gmail.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink: (t) => `https://app.example.com/reset?t=${t}`,
      sendEmail,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends reset email when email is @company.com (default allowed domain)", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@company.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);

    const result = await requestPasswordReset({
      email: "user@company.com",
      secret: SECRET,
      findUserByEmail,
      buildResetLink: (t) => `https://app.example.com/reset?t=${t}`,
      sendEmail,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("user@company.com");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("resetPasswordWithToken", () => {
  it("returns invalid_or_expired_token for invalid token", async () => {
    const store = createMemoryUsedTokenStore();
    const updateUserPassword = vi.fn();

    const result = await resetPasswordWithToken({
      token: "invalid.token.here",
      newPassword: "validpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
    });

    expect(result).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(updateUserPassword).not.toHaveBeenCalled();
  });

  it("returns invalid_password when new password fails policy", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "u@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn();

    const result = await resetPasswordWithToken({
      token,
      newPassword: "short",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
    });

    expect(result).toEqual({
      success: false,
      reason: "invalid_password",
      errors: expect.any(Array),
    });
    expect((result as { errors?: string[] }).errors?.length).toBeGreaterThan(0);
    expect(updateUserPassword).not.toHaveBeenCalled();
  });

  it("verifies token, hashes password, updates user and returns userId", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "user-99", email: "u@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn().mockResolvedValue(undefined);

    const result = await resetPasswordWithToken({
      token,
      newPassword: "validpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
    });

    expect(result).toEqual({ success: true, userId: "user-99" });
    expect(updateUserPassword).toHaveBeenCalledTimes(1);
    const args = updateUserPassword.mock.calls[0];
    const userId = args?.[0];
    const hash = args?.[1];
    expect(userId).toBe("user-99");
    expect(hash).toBeDefined();
    expect(hash).not.toBe("validpass1");
    expect(typeof hash === "string" ? hash.length : 0).toBeGreaterThan(20);
  });

  it("returns invalid_or_expired_token when token already used", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "u@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn().mockResolvedValue(undefined);

    const first = await resetPasswordWithToken({
      token,
      newPassword: "validpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
    });
    expect(first).toEqual({ success: true, userId: "u1" });

    const second = await resetPasswordWithToken({
      token,
      newPassword: "otherpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
    });
    expect(second).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it("single-use: token invalidated after use by default when usedTokenStore omitted", async () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "u@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn().mockResolvedValue(undefined);

    const first = await resetPasswordWithToken({
      token,
      newPassword: "validpass1",
      secret: SECRET,
      updateUserPassword,
    });
    expect(first).toEqual({ success: true, userId: "u1" });

    const second = await resetPasswordWithToken({
      token,
      newPassword: "otherpass1",
      secret: SECRET,
      updateUserPassword,
    });
    expect(second).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it("uses validatePasswordAsync when provided and succeeds when valid", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "u2", email: "u2@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn().mockResolvedValue(undefined);
    const validateAsync = vi.fn().mockResolvedValue({
      valid: true,
      errors: [],
    });

    const result = await resetPasswordWithToken({
      token,
      newPassword: "validpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
      validatePasswordAsync: validateAsync,
    });

    expect(result).toEqual({ success: true, userId: "u2" });
    expect(validateAsync).toHaveBeenCalledWith("validpass1", defaultPasswordPolicy);
    expect(updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it("uses validatePasswordAsync when provided and returns invalid_password on failure", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createPasswordResetToken(
      { userId: "u3", email: "u3@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn();
    const validateAsync = vi.fn().mockResolvedValue({
      valid: false,
      errors: ["Password has been found in a data breach"],
    });

    const result = await resetPasswordWithToken({
      token,
      newPassword: "validpass1",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
      validatePasswordAsync: validateAsync,
    });

    expect(result).toEqual({
      success: false,
      reason: "invalid_password",
      errors: ["Password has been found in a data breach"],
    });
    expect(updateUserPassword).not.toHaveBeenCalled();
  });
});

describe("resetPasswordWithToken with breach detection", () => {
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
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") } as Response);
      })
    );
  });
  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  it("rejects pwned password when using validatePasswordWithPolicy with checkBreach", async () => {
    const store = createMemoryUsedTokenStore();
    const policy = { ...defaultPasswordPolicy, requireDigit: false };
    const { token } = createPasswordResetToken(
      { userId: "u4", email: "u4@x.com" },
      SECRET
    );
    const updateUserPassword = vi.fn();
    const validateAsync = (plain: string, p: typeof policy) =>
      validatePasswordWithPolicy(plain, p, { checkBreach: true });

    const result = await resetPasswordWithToken({
      token,
      newPassword: "password",
      secret: SECRET,
      usedTokenStore: store,
      updateUserPassword,
      passwordPolicy: policy,
      validatePasswordAsync: validateAsync,
    });

    expect(result).toEqual({
      success: false,
      reason: "invalid_password",
      errors: expect.arrayContaining([expect.stringMatching(/breach/)]),
    });
    expect(updateUserPassword).not.toHaveBeenCalled();
  });
});
