import type { BrandingConfig } from "./branding.js";
import { createDefaultEmailDomainChecker } from "./email-domain-restriction.js";
import { renderMagicLinkEmail } from "./email-templates.js";
import {
  createMagicLinkToken,
  getMagicLinkTtlMs,
  type SingleUseTokenStore,
  verifyMagicLinkToken,
} from "./magic-link.js";

export interface UserByEmail {
  userId: string;
  email: string;
}

export type SendEmailFn = (params: {
  to: string;
  html: string;
  text: string;
}) => Promise<void>;

export interface RequestMagicLinkOptions {
  email: string;
  secret: string;
  findUserByEmail: (email: string) => Promise<UserByEmail | null>;
  buildMagicLink: (token: string) => string;
  sendEmail: SendEmailFn;
  fallbackSendEmail?: SendEmailFn;
  usedTokenStore?: SingleUseTokenStore;
  branding?: BrandingConfig | null;
  htmlTemplate?: string;
  textTemplate?: string;
  ttlMs?: number;
  isAllowedEmail?: (email: string) => boolean;
  deviceFingerprint?: string | null;
}

export interface RequestMagicLinkResult {
  sent: boolean;
}

export async function requestMagicLink(
  options: RequestMagicLinkOptions
): Promise<RequestMagicLinkResult> {
  const {
    email,
    secret,
    findUserByEmail,
    buildMagicLink,
    sendEmail,
    fallbackSendEmail,
    branding,
    htmlTemplate,
    textTemplate,
    ttlMs = getMagicLinkTtlMs(),
    isAllowedEmail: isAllowedEmailOpt,
    deviceFingerprint,
  } = options;

  const isAllowed = isAllowedEmailOpt ?? createDefaultEmailDomainChecker();
  if (!isAllowed(email)) return { sent: true };

  const user = await findUserByEmail(email);
  if (!user) return { sent: true };

  const { token } = createMagicLinkToken(
    {
      email: user.email,
      userId: user.userId,
      deviceFingerprint: deviceFingerprint ?? undefined,
    },
    secret,
    { ttlMs }
  );
  const magicLink = buildMagicLink(token);
  const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));
  const { html, text } = renderMagicLinkEmail(
    { magicLink, expiresInMinutes },
    { branding, htmlTemplate, textTemplate }
  );
  const payload = { to: user.email, html, text };
  try {
    await sendEmail(payload);
  } catch {
    if (fallbackSendEmail) {
      try {
        await fallbackSendEmail(payload);
      } catch {
        throw new Error("Failed to send magic link email");
      }
    } else {
      throw new Error("Failed to send magic link email");
    }
  }
  return { sent: true };
}

export interface VerifyMagicLinkOptions {
  token: string;
  secret: string;
  usedTokenStore?: SingleUseTokenStore;
  deviceFingerprint?: string | null;
  findUserByEmail?: (email: string) => Promise<UserByEmail | null>;
}

export interface VerifyMagicLinkSuccess {
  success: true;
  userId: string;
  email: string;
}

export interface VerifyMagicLinkFailure {
  success: false;
  reason: "invalid_or_expired_token";
}

export type VerifyMagicLinkResult =
  | VerifyMagicLinkSuccess
  | VerifyMagicLinkFailure;

export async function verifyMagicLink(
  options: VerifyMagicLinkOptions
): Promise<VerifyMagicLinkResult> {
  const {
    token,
    secret,
    usedTokenStore,
    deviceFingerprint,
    findUserByEmail,
  } = options;

  const payload = verifyMagicLinkToken(token, secret, {
    ...(usedTokenStore !== undefined && { usedTokenStore }),
    deviceFingerprint,
  });
  if (!payload) {
    return { success: false, reason: "invalid_or_expired_token" };
  }

  let userId: string | undefined = payload.userId;
  if (userId === undefined && findUserByEmail) {
    const user = await findUserByEmail(payload.email);
    userId = user?.userId;
  }
  if (userId === undefined) {
    return { success: false, reason: "invalid_or_expired_token" };
  }

  return {
    success: true,
    userId,
    email: payload.email,
  };
}
