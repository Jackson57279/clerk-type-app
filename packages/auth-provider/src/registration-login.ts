import {
  defaultPasswordPolicy,
  getPasswordPolicyConfig,
  hashPassword,
  type PasswordPolicy,
  type PasswordValidationResult,
  validatePassword,
  validatePasswordWithEnv,
  verifyPassword,
} from "./password.js";
import {
  hasTotp,
  verifyTotpChallenge,
  type TotpStore,
} from "./totp-authenticator.js";
import {
  hasSmsMfa,
  verifyLoginSmsOtp,
  maskPhone,
  type UserMfaPhoneStore,
  type SmsMfaChallengeStore,
} from "./sms-mfa.js";
import {
  verifyAndConsumeBackupCode,
  type BackupCodeStore,
} from "./backup-codes.js";
import { checkRateLimit, recordAttempt } from "./rate-limit.js";
import type { BruteForceResult } from "./brute-force.js";
import type { AccountLockoutResult } from "./account-lockout.js";
import type { LoginContext, SuspiciousActivityResult } from "./suspicious-activity.js";
import {
  createAuditEvent,
  AUDIT_EVENT_TYPES,
  type AuditLogStore,
} from "./audit-log.js";
import {
  createSessionAfterLogin,
  type SessionStore,
  type CreateSessionAfterLoginOptions,
} from "./session-fixation.js";

export interface CredentialUser {
  userId: string;
  email: string;
  passwordHash: string | null;
}

export interface RegistrationLoginStore {
  findUserByEmail(email: string): Promise<CredentialUser | null>;
  createUser(data: {
    email: string;
    passwordHash: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<CredentialUser>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}

export interface RegisterOptions {
  passwordPolicy?: PasswordPolicy;
  validatePasswordFn?: (
    plain: string,
    policy: PasswordPolicy
  ) => PasswordValidationResult;
  validatePasswordAsync?: (
    plain: string,
    policy: PasswordPolicy
  ) => Promise<PasswordValidationResult>;
  env?: NodeJS.ProcessEnv;
  isAllowedEmail?: (email: string) => boolean;
}

export interface RegisterSuccess {
  success: true;
  userId: string;
  created: boolean;
}

export interface RegisterFailure {
  success: false;
  reason: "email_taken" | "invalid_password" | "email_not_allowed";
  errors?: string[];
}

export type RegisterResult = RegisterSuccess | RegisterFailure;

export async function register(
  store: RegistrationLoginStore,
  input: RegisterInput,
  options: RegisterOptions = {}
): Promise<RegisterResult> {
  const {
    passwordPolicy: policyOpt = defaultPasswordPolicy,
    validatePasswordFn = validatePassword,
    validatePasswordAsync,
    env: envOpt,
    isAllowedEmail,
  } = options;

  const email = input.email.trim().toLowerCase();
  if (!email) {
    return {
      success: false,
      reason: "invalid_password",
      errors: ["Email is required"],
    };
  }

  if (isAllowedEmail && !isAllowedEmail(input.email)) {
    return { success: false, reason: "email_not_allowed" };
  }

  let passwordPolicy: PasswordPolicy;
  let validation: PasswordValidationResult;
  if (envOpt !== undefined) {
    const config = getPasswordPolicyConfig(envOpt);
    passwordPolicy = config.policy;
    validation = config.checkBreach
      ? await validatePasswordWithEnv(input.password, envOpt)
      : validatePassword(input.password, passwordPolicy);
  } else if (validatePasswordAsync !== undefined) {
    passwordPolicy = policyOpt;
    validation = await validatePasswordAsync(input.password, passwordPolicy);
  } else {
    passwordPolicy = policyOpt;
    validation = validatePasswordFn(input.password, passwordPolicy);
  }
  if (!validation.valid) {
    return {
      success: false,
      reason: "invalid_password",
      errors: validation.errors,
    };
  }

  const existing = await store.findUserByEmail(email);
  if (existing?.passwordHash) {
    return { success: false, reason: "email_taken" };
  }

  const passwordHash = await hashPassword(input.password);

  if (existing) {
    await store.setPassword(existing.userId, passwordHash);
    return { success: true, userId: existing.userId, created: false };
  }

  const user = await store.createUser({
    email,
    passwordHash,
    name: input.name,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  return { success: true, userId: user.userId, created: true };
}

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string;
  smsOtpCode?: string;
  backupCode?: string;
  deviceFingerprint?: string | null;
  location?: { lat: number; lng: number } | null;
  ip?: string;
}

export interface SmsMfaLoginOptions {
  phoneStore: UserMfaPhoneStore;
  challengeStore: SmsMfaChallengeStore;
}

export interface BruteForceProtection {
  check(key: string): BruteForceResult;
  recordFailedAttempt(key: string): void;
  clearFailedAttempts(key: string): void;
}

export interface AccountLockoutProtection {
  check(key: string): AccountLockoutResult;
  recordFailedAttempt(key: string): void;
  clearFailedAttempts(key: string): void;
}

export interface SuspiciousActivityDetector {
  evaluateLogin(context: LoginContext): SuspiciousActivityResult;
}

export interface LoginSessionFixationOptions {
  sessionStore: SessionStore;
  currentSessionId: string;
  orgId?: string | null;
}

export interface LoginOptions {
  totpStore?: TotpStore;
  smsMfa?: SmsMfaLoginOptions;
  backupCodeStore?: BackupCodeStore;
  getBruteForceKey?: (input: LoginInput) => string;
  bruteForceProtection?: BruteForceProtection;
  accountLockout?: AccountLockoutProtection;
  suspiciousActivityDetector?: SuspiciousActivityDetector;
  auditLogStore?: AuditLogStore;
  useIpRateLimit?: boolean;
  sessionFixation?: LoginSessionFixationOptions & CreateSessionAfterLoginOptions;
}

export interface LoginSuccess {
  success: true;
  userId: string;
  suspicious?: boolean;
  suspiciousReasons?: string[];
  newSessionId?: string;
  setCookieHeader?: string;
}

export interface LoginRequiresTotp {
  success: false;
  requiresTotp: true;
  userId: string;
}

export interface LoginRequiresSmsOtp {
  success: false;
  requiresSmsOtp: true;
  userId: string;
  phoneMasked?: string;
}

export interface LoginFailure {
  success: false;
  reason: "invalid_credentials";
}

export interface LoginRateLimited {
  success: false;
  reason: "rate_limited";
  retryAfterSeconds: number;
}

export interface LoginAccountLocked {
  success: false;
  reason: "account_locked";
  retryAfterSeconds: number;
}

export type LoginResult =
  | LoginSuccess
  | LoginFailure
  | LoginRateLimited
  | LoginAccountLocked
  | LoginRequiresTotp
  | LoginRequiresSmsOtp;

function recordLoginFailure(
  email: string,
  options: LoginOptions,
  bruteForceKey: string | undefined
): void {
  if (options.bruteForceProtection && bruteForceKey) {
    options.bruteForceProtection.recordFailedAttempt(bruteForceKey);
  }
  if (options.accountLockout) {
    options.accountLockout.recordFailedAttempt(email);
  }
}

export async function login(
  store: RegistrationLoginStore,
  input: LoginInput,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { success: false, reason: "invalid_credentials" };
  }

  if (options.useIpRateLimit && input.ip) {
    const limitResult = checkRateLimit(input.ip);
    if (!limitResult.allowed) {
      return {
        success: false,
        reason: "rate_limited",
        retryAfterSeconds: limitResult.retryAfterSeconds ?? 1,
      };
    }
  }

  const bruteForceKey =
    options.getBruteForceKey?.(input) ?? undefined;
  if (options.bruteForceProtection && bruteForceKey) {
    const bf = options.bruteForceProtection.check(bruteForceKey);
    if (!bf.allowed) {
      return {
        success: false,
        reason: "rate_limited",
        retryAfterSeconds: bf.retryAfterSeconds ?? 1,
      };
    }
  }
  if (options.accountLockout) {
    const lock = options.accountLockout.check(email);
    if (lock.locked) {
      return {
        success: false,
        reason: "account_locked",
        retryAfterSeconds: lock.retryAfterSeconds ?? 1,
      };
    }
  }

  if (options.useIpRateLimit && input.ip) {
    recordAttempt(input.ip);
  }

  const user = await store.findUserByEmail(email);
  if (!user?.passwordHash) {
    recordLoginFailure(email, options, bruteForceKey);
    return { success: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    recordLoginFailure(email, options, bruteForceKey);
    return { success: false, reason: "invalid_credentials" };
  }

  const { totpStore, smsMfa, backupCodeStore } = options;
  if (totpStore) {
    const totpEnabled = await hasTotp(user.userId, totpStore);
    if (totpEnabled) {
      if (input.totpCode) {
        const totpValid = await verifyTotpChallenge(
          user.userId,
          input.totpCode,
          totpStore
        );
        if (!totpValid) {
          recordLoginFailure(email, options, bruteForceKey);
          return { success: false, reason: "invalid_credentials" };
        }
      } else if (input.backupCode && backupCodeStore) {
        const backupValid = await verifyAndConsumeBackupCode(
          user.userId,
          input.backupCode,
          backupCodeStore
        );
        if (!backupValid) {
          recordLoginFailure(email, options, bruteForceKey);
          return { success: false, reason: "invalid_credentials" };
        }
      } else {
        return { success: false, requiresTotp: true, userId: user.userId };
      }
    }
  }

  if (smsMfa) {
    const smsEnabled = await hasSmsMfa(user.userId, smsMfa.phoneStore);
    if (smsEnabled) {
      if (input.smsOtpCode) {
        const smsValid = await verifyLoginSmsOtp(
          user.userId,
          input.smsOtpCode,
          { challengeStore: smsMfa.challengeStore }
        );
        if (!smsValid) {
          recordLoginFailure(email, options, bruteForceKey);
          return { success: false, reason: "invalid_credentials" };
        }
      } else if (input.backupCode && backupCodeStore) {
        const backupValid = await verifyAndConsumeBackupCode(
          user.userId,
          input.backupCode,
          backupCodeStore
        );
        if (!backupValid) {
          recordLoginFailure(email, options, bruteForceKey);
          return { success: false, reason: "invalid_credentials" };
        }
      } else {
        const phone = await smsMfa.phoneStore.get(user.userId);
        return {
          success: false,
          requiresSmsOtp: true,
          userId: user.userId,
          phoneMasked: phone ? maskPhone(phone) : undefined,
        };
      }
    }
  }

  if (options.accountLockout) {
    options.accountLockout.clearFailedAttempts(email);
  }

  const success: LoginSuccess = { success: true, userId: user.userId };
  const detector = options.suspiciousActivityDetector;
  if (detector) {
    const context: LoginContext = {
      userId: user.userId,
      deviceFingerprint: input.deviceFingerprint ?? null,
      location: input.location ?? null,
    };
    const result = detector.evaluateLogin(context);
    if (result.suspicious) {
      success.suspicious = true;
      success.suspiciousReasons = result.reasons;
      if (options.auditLogStore) {
        await createAuditEvent(options.auditLogStore, {
          eventType: AUDIT_EVENT_TYPES.SECURITY_SUSPICIOUS_LOGIN,
          actorType: "user",
          actorId: user.userId,
          targetType: "user",
          targetId: user.userId,
          metadata: { reasons: result.reasons },
        });
      }
    }
  }
  const fix = options.sessionFixation;
  if (fix) {
    const { sessionStore, currentSessionId, orgId, ...cookieOptions } = fix;
    const { newSessionId, setCookieHeader } = createSessionAfterLogin(
      currentSessionId,
      user.userId,
      orgId ?? null,
      sessionStore,
      cookieOptions
    );
    success.newSessionId = newSessionId;
    success.setCookieHeader = setCookieHeader;
  }
  return success;
}
