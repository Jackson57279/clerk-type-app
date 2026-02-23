import { describe, it, expect, vi } from "vitest";
import {
  sendEmailVerification,
  verifyEmailWithToken,
} from "../src/email-verification-flow.js";
import {
  createEmailVerificationToken,
  createMemoryEmailVerificationStore,
} from "../src/email-verification.js";

const SECRET = "verify-secret";

describe("sendEmailVerification", () => {
  it("returns sent: true without calling sendEmail when user not found", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue(null);
    const sendEmail = vi.fn();

    const result = await sendEmailVerification({
      email: "nobody@example.com",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink: (t) => `https://app.example.com/verify?token=${t}`,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("nobody@example.com");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("normalizes email to lowercase when looking up user", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue(null);
    const sendEmail = vi.fn();

    await sendEmailVerification({
      email: "User@Example.COM",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink: (t) => `https://app.example.com/verify?token=${t}`,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(findUserByEmail).toHaveBeenCalledWith("user@example.com");
  });

  it("returns sent: true without sending when email not allowed", async () => {
    const findUserByEmail = vi.fn();
    const sendEmail = vi.fn();

    const result = await sendEmailVerification({
      email: "user@blocked.com",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink: (t) => `https://app.example.com/verify?token=${t}`,
      sendEmail,
      isAllowedEmail: (e) => e.endsWith("@example.com"),
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns sent: true for empty email without sending", async () => {
    const findUserByEmail = vi.fn();
    const sendEmail = vi.fn();

    const result = await sendEmailVerification({
      email: "   ",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink: (t) => `https://app.example.com/verify?token=${t}`,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("creates token, builds link, sends email when user found", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildVerificationLink = vi.fn(
      (token: string) => `https://app.example.com/verify?t=${token}`
    );

    const result = await sendEmailVerification({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("user@example.com");
    expect(buildVerificationLink).toHaveBeenCalledTimes(1);
    const tokenArg = (buildVerificationLink.mock.calls[0] as string[])[0];
    expect(tokenArg).toBeDefined();
    expect(tokenArg).toContain(".");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        html: expect.stringContaining("Verify your email"),
        text: expect.stringContaining("Verify your email"),
      })
    );
    const sentArgs = sendEmail.mock.calls[0];
    const sentHtml =
      sentArgs && sentArgs[0] ? (sentArgs[0] as { html: string }).html : "";
    expect(sentHtml).toContain("https://app.example.com/verify?t=");
  });

  it("uses fallbackSendEmail when primary sendEmail fails", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const fallbackSendEmail = vi.fn().mockResolvedValue(undefined);
    const buildVerificationLink = (t: string) =>
      `https://app.example.com/verify?t=${t}`;

    const result = await sendEmailVerification({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildVerificationLink,
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
        html: expect.stringContaining("Verify your email"),
        text: expect.stringContaining("Verify your email"),
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
    const buildVerificationLink = (t: string) =>
      `https://app.example.com/verify?t=${t}`;

    await expect(
      sendEmailVerification({
        email: "user@example.com",
        secret: SECRET,
        findUserByEmail,
        buildVerificationLink,
        sendEmail,
        fallbackSendEmail,
        isAllowedEmail: () => true,
      })
    ).rejects.toThrow("Failed to send email verification");
  });
});

describe("verifyEmailWithToken", () => {
  it("returns success and calls setEmailVerified when token is valid", async () => {
    const { token } = createEmailVerificationToken(
      { userId: "user-1", email: "user@example.com" },
      SECRET
    );
    const setEmailVerified = vi.fn().mockResolvedValue(undefined);

    const result = await verifyEmailWithToken({
      token,
      secret: SECRET,
      setEmailVerified,
    });

    expect(result).toEqual({
      success: true,
      userId: "user-1",
      email: "user@example.com",
    });
    expect(setEmailVerified).toHaveBeenCalledTimes(1);
    expect(setEmailVerified).toHaveBeenCalledWith("user-1");
  });

  it("returns invalid_or_expired_token for wrong secret", async () => {
    const { token } = createEmailVerificationToken(
      { userId: "user-1", email: "user@example.com" },
      SECRET
    );
    const setEmailVerified = vi.fn();

    const result = await verifyEmailWithToken({
      token,
      secret: "wrong-secret",
      setEmailVerified,
    });

    expect(result).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(setEmailVerified).not.toHaveBeenCalled();
  });

  it("returns invalid_or_expired_token for malformed token", async () => {
    const setEmailVerified = vi.fn();

    const result = await verifyEmailWithToken({
      token: "not.a.valid.jwt",
      secret: SECRET,
      setEmailVerified,
    });

    expect(result).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(setEmailVerified).not.toHaveBeenCalled();
  });

  it("uses provided usedTokenStore and invalidates token after use", async () => {
    const store = createMemoryEmailVerificationStore();
    const { token } = createEmailVerificationToken(
      { userId: "user-1", email: "user@example.com" },
      SECRET
    );
    const setEmailVerified = vi.fn().mockResolvedValue(undefined);

    const first = await verifyEmailWithToken({
      token,
      secret: SECRET,
      usedTokenStore: store,
      setEmailVerified,
    });
    expect(first).toEqual({
      success: true,
      userId: "user-1",
      email: "user@example.com",
    });
    expect(setEmailVerified).toHaveBeenCalledWith("user-1");

    setEmailVerified.mockClear();
    const second = await verifyEmailWithToken({
      token,
      secret: SECRET,
      usedTokenStore: store,
      setEmailVerified,
    });
    expect(second).toEqual({ success: false, reason: "invalid_or_expired_token" });
    expect(setEmailVerified).not.toHaveBeenCalled();
  });
});
