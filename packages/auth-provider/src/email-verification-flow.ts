import type { BrandingConfig } from "./branding.js";
import { createDefaultEmailDomainChecker } from "./email-domain-restriction.js";
import {
  createEmailVerificationToken,
  DEFAULT_EMAIL_VERIFICATION_LINK_TTL_MS,
  type SingleUseEmailVerificationStore,
  verifyEmailVerificationToken,
} from "./email-verification.js";
import { renderEmailVerificationEmail } from "./email-templates.js";

export interface UserByEmail {
  userId: string;
  email: string;
}

export type SendEmailFn = (params: {
  to: string;
  html: string;
  text: string;
}) => Promise<void>;

export interface SendEmailVerificationOptions {
  email: string;
  secret: string;
  findUserByEmail: (email: string) => Promise<UserByEmail | null>;
  buildVerificationLink: (token: string) => string;
  sendEmail: SendEmailFn;
  fallbackSendEmail?: SendEmailFn;
  usedTokenStore?: SingleUseEmailVerificationStore;
  branding?: BrandingConfig | null;
  htmlTemplate?: string;
  textTemplate?: string;
  ttlMs?: number;
  isAllowedEmail?: (email: string) => boolean;
}

export interface SendEmailVerificationResult {
  sent: boolean;
}

export async function sendEmailVerification(
  options: SendEmailVerificationOptions
): Promise<SendEmailVerificationResult> {
  const {
    email,
    secret,
    findUserByEmail,
    buildVerificationLink,
    sendEmail,
    fallbackSendEmail,
    branding,
    htmlTemplate,
    textTemplate,
    ttlMs = DEFAULT_EMAIL_VERIFICATION_LINK_TTL_MS,
    isAllowedEmail: isAllowedEmailOpt,
  } = options;

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { sent: true };

  const isAllowed = isAllowedEmailOpt ?? createDefaultEmailDomainChecker();
  if (!isAllowed(normalizedEmail)) return { sent: true };

  const user = await findUserByEmail(normalizedEmail);
  if (!user) return { sent: true };

  const { token } = createEmailVerificationToken(
    { userId: user.userId, email: user.email },
    secret,
    { ttlMs }
  );
  const verificationLink = buildVerificationLink(token);
  const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));
  const { html, text } = renderEmailVerificationEmail(
    { verificationLink, expiresInMinutes },
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
        throw new Error("Failed to send email verification");
      }
    } else {
      throw new Error("Failed to send email verification");
    }
  }
  return { sent: true };
}

export interface EmailVerificationFlowStore {
  setEmailVerified(userId: string): Promise<void>;
}

export interface VerifyEmailWithTokenOptions {
  token: string;
  secret: string;
  usedTokenStore?: SingleUseEmailVerificationStore;
  setEmailVerified: (userId: string) => Promise<void>;
}

export interface VerifyEmailWithTokenSuccess {
  success: true;
  userId: string;
  email: string;
}

export interface VerifyEmailWithTokenFailure {
  success: false;
  reason: "invalid_or_expired_token";
}

export type VerifyEmailWithTokenResult =
  | VerifyEmailWithTokenSuccess
  | VerifyEmailWithTokenFailure;

export async function verifyEmailWithToken(
  options: VerifyEmailWithTokenOptions
): Promise<VerifyEmailWithTokenResult> {
  const { token, secret, usedTokenStore, setEmailVerified } = options;

  const payload = verifyEmailVerificationToken(token, secret, {
    ...(usedTokenStore !== undefined && { usedTokenStore }),
  });
  if (!payload) {
    return { success: false, reason: "invalid_or_expired_token" };
  }

  await setEmailVerified(payload.userId);
  return {
    success: true,
    userId: payload.userId,
    email: payload.email,
  };
}
