import type { BrandingConfig } from "./branding.js";
import { renderPasswordResetEmail } from "./email-templates.js";
import {
  defaultPasswordPolicy,
  hashPassword,
  type PasswordPolicy,
  type PasswordValidationResult,
  validatePassword,
} from "./password.js";
import {
  createPasswordResetToken,
  DEFAULT_PASSWORD_RESET_TTL_MS,
  type SingleUseTokenStore,
  verifyPasswordResetToken,
} from "./password-reset.js";

export interface UserByEmail {
  userId: string;
  email: string;
}

export interface RequestPasswordResetOptions {
  email: string;
  secret: string;
  findUserByEmail: (email: string) => Promise<UserByEmail | null>;
  buildResetLink: (token: string) => string;
  sendEmail: (params: { to: string; html: string; text: string }) => Promise<void>;
  usedTokenStore?: SingleUseTokenStore;
  branding?: BrandingConfig | null;
  ttlMs?: number;
}

export interface RequestPasswordResetResult {
  sent: boolean;
}

export async function requestPasswordReset(
  options: RequestPasswordResetOptions
): Promise<RequestPasswordResetResult> {
  const {
    email,
    secret,
    findUserByEmail,
    buildResetLink,
    sendEmail,
    branding,
    ttlMs = DEFAULT_PASSWORD_RESET_TTL_MS,
  } = options;

  const user = await findUserByEmail(email);
  if (!user) return { sent: true };

  const { token } = createPasswordResetToken(
    { userId: user.userId, email: user.email },
    secret,
    { ttlMs }
  );
  const resetLink = buildResetLink(token);
  const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));
  const { html, text } = renderPasswordResetEmail(
    { resetLink, expiresInMinutes },
    { branding }
  );
  await sendEmail({ to: user.email, html, text });
  return { sent: true };
}

export interface ResetPasswordWithTokenOptions {
  token: string;
  newPassword: string;
  secret: string;
  usedTokenStore: SingleUseTokenStore;
  updateUserPassword: (userId: string, passwordHash: string) => Promise<void>;
  passwordPolicy?: PasswordPolicy;
  validatePasswordFn?: (
    plainPassword: string,
    policy: PasswordPolicy
  ) => PasswordValidationResult;
  validatePasswordAsync?: (
    plainPassword: string,
    policy: PasswordPolicy
  ) => Promise<PasswordValidationResult>;
}

export interface ResetPasswordWithTokenSuccess {
  success: true;
  userId: string;
}

export interface ResetPasswordWithTokenFailure {
  success: false;
  reason: "invalid_or_expired_token" | "invalid_password";
  errors?: string[];
}

export type ResetPasswordWithTokenResult =
  | ResetPasswordWithTokenSuccess
  | ResetPasswordWithTokenFailure;

export async function resetPasswordWithToken(
  options: ResetPasswordWithTokenOptions
): Promise<ResetPasswordWithTokenResult> {
  const {
    token,
    newPassword,
    secret,
    usedTokenStore,
    updateUserPassword,
    passwordPolicy = defaultPasswordPolicy,
    validatePasswordFn = validatePassword,
    validatePasswordAsync,
  } = options;

  const verified = verifyPasswordResetToken(token, secret, { usedTokenStore });
  if (!verified) {
    return { success: false, reason: "invalid_or_expired_token" };
  }

  const validation = validatePasswordAsync
    ? await validatePasswordAsync(newPassword, passwordPolicy)
    : validatePasswordFn(newPassword, passwordPolicy);
  if (!validation.valid) {
    return {
      success: false,
      reason: "invalid_password",
      errors: validation.errors,
    };
  }

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(verified.userId, passwordHash);
  return { success: true, userId: verified.userId };
}
