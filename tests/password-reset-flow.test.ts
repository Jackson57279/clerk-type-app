import { describe, it, expect, vi } from "vitest";
import {
  requestPasswordReset,
  resetPasswordWithToken,
} from "../src/password-reset-flow.js";
import { createMemoryUsedTokenStore } from "../src/password-reset.js";
import { createPasswordResetToken } from "../src/password-reset.js";

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
});
