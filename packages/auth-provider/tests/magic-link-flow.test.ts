import { describe, it, expect, vi } from "vitest";
import {
  requestMagicLink,
  verifyMagicLink,
} from "../src/magic-link-flow.js";
import {
  createMagicLinkToken,
  createMemoryUsedTokenStore,
} from "../src/magic-link.js";

const SECRET = "magic-link-secret";

describe("requestMagicLink", () => {
  it("returns sent: true without calling sendEmail when user not found", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue(null);
    const sendEmail = vi.fn();

    const result = await requestMagicLink({
      email: "nobody@example.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink: (t) => `https://app.example.com/auth?token=${t}`,
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
    const buildMagicLink = vi.fn((token: string) => `https://app.example.com/auth?t=${token}`);

    const result = await requestMagicLink({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
      sendEmail,
      isAllowedEmail: () => true,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).toHaveBeenCalledWith("user@example.com");
    expect(buildMagicLink).toHaveBeenCalledTimes(1);
    const tokenArg = (buildMagicLink.mock.calls[0] as string[])[0];
    expect(tokenArg).toBeDefined();
    expect(tokenArg).toContain(".");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        html: expect.stringContaining("Sign in"),
        text: expect.stringContaining("Sign in"),
      })
    );
    const sentArgs = sendEmail.mock.calls[0];
    const sentHtml = sentArgs && sentArgs[0] ? (sentArgs[0] as { html: string }).html : "";
    expect(sentHtml).toContain("https://app.example.com/auth?t=");
  });

  it("uses fallbackSendEmail when primary sendEmail fails", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockRejectedValue(new Error("SMTP down"));
    const fallbackSendEmail = vi.fn().mockResolvedValue(undefined);
    const buildMagicLink = (t: string) => `https://app.example.com/auth?t=${t}`;

    const result = await requestMagicLink({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
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
        html: expect.stringContaining("Sign in"),
        text: expect.stringContaining("Sign in"),
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
    const buildMagicLink = (t: string) => `https://app.example.com/auth?t=${t}`;

    await expect(
      requestMagicLink({
        email: "user@example.com",
        secret: SECRET,
        findUserByEmail,
        buildMagicLink,
        sendEmail,
        fallbackSendEmail,
        isAllowedEmail: () => true,
      })
    ).rejects.toThrow("Failed to send magic link email");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(fallbackSendEmail).toHaveBeenCalledTimes(1);
  });

  it("uses custom branding (logo, colors) in sent email", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildMagicLink = (t: string) => `https://app.example.com/auth?t=${t}`;

    await requestMagicLink({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
      sendEmail,
      isAllowedEmail: () => true,
      branding: {
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#2563eb",
        companyName: "Acme",
      },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("https://cdn.example.com/logo.png");
    expect(payload?.html).toContain("#2563eb");
    expect(payload?.html).toContain("Acme");
  });

  it("uses custom htmlTemplate and textTemplate when provided", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const buildMagicLink = (t: string) => `https://app.example.com/auth?t=${t}`;

    await requestMagicLink({
      email: "user@example.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
      sendEmail,
      isAllowedEmail: () => true,
      htmlTemplate: "<p>Custom: {{magicLink}} ({{expiresInMinutes}} min)</p>",
      textTemplate: "Custom: {{magicLink}} ({{expiresInMinutes}} min)",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("Custom:");
    expect(payload?.html).toContain("https://app.example.com/auth?t=");
    expect(payload?.html).not.toContain("{{magicLink}}");
    expect(payload?.text).toContain("Custom:");
    expect(payload?.text).not.toContain("{{magicLink}}");
  });

  it("returns sent: true without calling findUserByEmail or sendEmail when email domain not allowed", async () => {
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "user-1",
      email: "user@gmail.com",
    });
    const sendEmail = vi.fn();

    const result = await requestMagicLink({
      email: "user@gmail.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink: (t) => `https://app.example.com/auth?t=${t}`,
      sendEmail,
    });

    expect(result).toEqual({ sent: true });
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("verifyMagicLink", () => {
  it("returns invalid_or_expired_token for invalid token", async () => {
    const result = await verifyMagicLink({
      token: "invalid.token.here",
      secret: SECRET,
      findUserByEmail: async () => ({ userId: "u1", email: "u@x.com" }),
    });

    expect(result).toEqual({ success: false, reason: "invalid_or_expired_token" });
  });

  it("returns success with userId and email when token valid and has userId", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "u@x.com", userId: "user-99" },
      SECRET,
      { ttlMs: 15 * 60 * 1000 }
    );

    const result = await verifyMagicLink({
      token,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail: async () => ({ userId: "user-99", email: "u@x.com" }),
    });

    expect(result).toEqual({ success: true, userId: "user-99", email: "u@x.com" });
  });

  it("returns invalid_or_expired_token when token already used", async () => {
    const store = createMemoryUsedTokenStore();
    let capturedToken: string | null = null;
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "u1",
      email: "u@x.com",
    });
    const buildMagicLink = (t: string) => {
      capturedToken = t;
      return `https://app.example.com/auth?t=${t}`;
    };
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    await requestMagicLink({
      email: "u@x.com",
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
      sendEmail,
      usedTokenStore: store,
      isAllowedEmail: () => true,
    });

    const first = await verifyMagicLink({
      token: capturedToken!,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail: async () => ({ userId: "u1", email: "u@x.com" }),
    });
    expect(first).toEqual({ success: true, userId: "u1", email: "u@x.com" });

    const second = await verifyMagicLink({
      token: capturedToken!,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail: async () => ({ userId: "u1", email: "u@x.com" }),
    });
    expect(second).toEqual({ success: false, reason: "invalid_or_expired_token" });
  });

  it("resolves userId via findUserByEmail when token has no userId", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "no-userid@x.com" },
      SECRET,
      { ttlMs: 15 * 60 * 1000 }
    );
    const findUserByEmail = vi.fn().mockResolvedValue({
      userId: "resolved-user",
      email: "no-userid@x.com",
    });

    const result = await verifyMagicLink({
      token,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail,
    });

    expect(result).toEqual({
      success: true,
      userId: "resolved-user",
      email: "no-userid@x.com",
    });
    expect(findUserByEmail).toHaveBeenCalledWith("no-userid@x.com");
  });

  it("returns invalid_or_expired_token when findUserByEmail returns null and token has no userId", async () => {
    const store = createMemoryUsedTokenStore();
    const { token } = createMagicLinkToken(
      { email: "deleted@x.com" },
      SECRET,
      { ttlMs: 15 * 60 * 1000 }
    );
    const findUserByEmail = vi.fn().mockResolvedValue(null);

    const result = await verifyMagicLink({
      token,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail,
    });

    expect(result).toEqual({ success: false, reason: "invalid_or_expired_token" });
  });
});

describe("magic link flow (request then verify)", () => {
  it("full flow: request magic link email then verify token", async () => {
    const store = createMemoryUsedTokenStore();
    const user = { userId: "usr-42", email: "flow@example.com" };
    const findUserByEmail = vi.fn().mockResolvedValue(user);
    let capturedToken: string | null = null;
    const buildMagicLink = vi.fn((token: string) => {
      capturedToken = token;
      return `https://app.example.com/auth?token=${token}`;
    });
    const sendEmail = vi.fn().mockResolvedValue(undefined);

    const requestResult = await requestMagicLink({
      email: user.email,
      secret: SECRET,
      findUserByEmail,
      buildMagicLink,
      sendEmail,
      usedTokenStore: store,
      isAllowedEmail: () => true,
    });
    expect(requestResult).toEqual({ sent: true });
    expect(capturedToken).not.toBeNull();

    const verifyResult = await verifyMagicLink({
      token: capturedToken!,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail: async () => user,
    });
    expect(verifyResult).toEqual({ success: true, userId: "usr-42", email: "flow@example.com" });

    const secondVerify = await verifyMagicLink({
      token: capturedToken!,
      secret: SECRET,
      usedTokenStore: store,
      findUserByEmail: async () => user,
    });
    expect(secondVerify).toEqual({
      success: false,
      reason: "invalid_or_expired_token",
    });
  });
});
