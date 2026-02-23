import {
  defaultPasswordPolicy,
  hashPassword,
  type PasswordPolicy,
  type PasswordValidationResult,
  validatePassword,
  verifyPassword,
} from "./password.js";
import {
  hasTotp,
  verifyTotpChallenge,
  type TotpStore,
} from "./totp-authenticator.js";

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
    passwordPolicy = defaultPasswordPolicy,
    validatePasswordFn = validatePassword,
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

  const validation = validatePasswordFn(input.password, passwordPolicy);
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
}

export interface LoginOptions {
  totpStore?: TotpStore;
}

export interface LoginSuccess {
  success: true;
  userId: string;
}

export interface LoginRequiresTotp {
  success: false;
  requiresTotp: true;
  userId: string;
}

export interface LoginFailure {
  success: false;
  reason: "invalid_credentials";
}

export type LoginResult =
  | LoginSuccess
  | LoginFailure
  | LoginRequiresTotp;

export async function login(
  store: RegistrationLoginStore,
  input: LoginInput,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { success: false, reason: "invalid_credentials" };
  }

  const user = await store.findUserByEmail(email);
  if (!user?.passwordHash) {
    return { success: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    return { success: false, reason: "invalid_credentials" };
  }

  const { totpStore } = options;
  if (totpStore) {
    const totpEnabled = await hasTotp(user.userId, totpStore);
    if (totpEnabled) {
      if (!input.totpCode) {
        return { success: false, requiresTotp: true, userId: user.userId };
      }
      const totpValid = await verifyTotpChallenge(
        user.userId,
        input.totpCode,
        totpStore
      );
      if (!totpValid) {
        return { success: false, reason: "invalid_credentials" };
      }
    }
  }

  return { success: true, userId: user.userId };
}
