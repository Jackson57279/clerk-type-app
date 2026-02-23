import type { BrandingConfig } from "./branding.js";
import {
  assertConfirmationForSensitiveOperation,
  createConfirmationToken,
  DEFAULT_CONFIRMATION_LINK_TTL_MS,
  type DoubleOptInPayload,
  type RequireConfirmationContext,
  type SensitiveOperationType,
  type SingleUseConfirmationStore,
  type VerifyConfirmationTokenOptions,
  type VerifyConfirmationTokenResult,
} from "./double-opt-in.js";
import { renderDoubleOptInEmail } from "./email-templates.js";
import {
  checkResend,
  recordResend,
  type ResendPolicyOptions,
  type ResendPolicyStore,
} from "./resend-policy.js";

export const SENSITIVE_OPERATION_LABELS: Record<SensitiveOperationType, string> = {
  change_email: "change email address",
  change_password: "change password",
  disable_mfa: "disable two-factor authentication",
  delete_account: "delete account",
};

export type SendEmailFn = (params: {
  to: string;
  html: string;
  text: string;
}) => Promise<void>;

export interface RequestSensitiveOperationOptions {
  operation: SensitiveOperationType;
  userId: string;
  email: string;
  secret: string;
  buildConfirmLink: (token: string) => string;
  operationParams?: Record<string, string>;
  sendEmail?: SendEmailFn;
  usedTokenStore?: SingleUseConfirmationStore;
  branding?: BrandingConfig | null;
  ttlMs?: number;
  resendPolicyStore?: ResendPolicyStore;
  resendPolicyOptions?: ResendPolicyOptions;
}

export type RequestSensitiveOperationResult =
  | {
      token: string;
      confirmationLink: string;
      expiresAt: number;
      sent: boolean;
    }
  | {
      resendBlocked: { retryAfterSeconds: number };
      sent: false;
    };

export function isRequestSensitiveOperationSuccess(
  r: RequestSensitiveOperationResult
): r is Extract<RequestSensitiveOperationResult, { token: string }> {
  return "token" in r;
}

function resendKey(userId: string, operation: SensitiveOperationType): string {
  return `${userId}:${operation}`;
}

export async function requestSensitiveOperation(
  options: RequestSensitiveOperationOptions
): Promise<RequestSensitiveOperationResult> {
  const {
    operation,
    userId,
    email,
    secret,
    buildConfirmLink,
    operationParams,
    sendEmail,
    branding,
    ttlMs = DEFAULT_CONFIRMATION_LINK_TTL_MS,
    resendPolicyStore,
    resendPolicyOptions,
  } = options;

  if (resendPolicyStore) {
    const key = resendKey(userId, operation);
    const resendResult = checkResend(key, resendPolicyStore, resendPolicyOptions);
    if (!resendResult.allowed && resendResult.retryAfterSeconds !== undefined) {
      return {
        resendBlocked: { retryAfterSeconds: resendResult.retryAfterSeconds },
        sent: false,
      };
    }
  }

  const payload: DoubleOptInPayload = {
    userId,
    email,
    operation,
    operationParams,
  };
  const { token, expiresAt } = createConfirmationToken(payload, secret, {
    ttlMs,
  });
  const confirmationLink = buildConfirmLink(token);
  const expiresInMinutes = Math.max(1, Math.round(ttlMs / 60000));
  const label = SENSITIVE_OPERATION_LABELS[operation];
  const { html, text } = renderDoubleOptInEmail(
    {
      confirmationLink,
      operation: label,
      expiresInMinutes,
    },
    { branding }
  );

  if (sendEmail) {
    await sendEmail({ to: email, html, text });
  }

  if (resendPolicyStore) {
    recordResend(resendKey(userId, operation), resendPolicyStore);
  }

  return {
    token,
    confirmationLink,
    expiresAt,
    sent: Boolean(sendEmail),
  };
}

export interface ExecuteSensitiveOperationOptions {
  usedTokenStore?: SingleUseConfirmationStore;
}

export async function executeSensitiveOperation<T>(
  operation: SensitiveOperationType,
  confirmationToken: string | undefined,
  context: RequireConfirmationContext,
  secret: string,
  action: (payload: VerifyConfirmationTokenResult) => Promise<T>,
  options: ExecuteSensitiveOperationOptions = {}
): Promise<T> {
  const verifyOptions: VerifyConfirmationTokenOptions = {
    usedTokenStore: options.usedTokenStore,
  };
  const payload = assertConfirmationForSensitiveOperation(
    operation,
    confirmationToken,
    context,
    secret,
    verifyOptions
  );
  return action(payload);
}
