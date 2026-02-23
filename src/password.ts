import * as argon2 from "argon2";
import { createHash } from "crypto";

const MEMORY_KB = 64 * 1024;
const ITERATIONS = 3;
const PARALLELISM = 4;

export interface PasswordPolicy {
  minLength: number;
  maxLength?: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
}

export const defaultPasswordPolicy: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: false,
};

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(
  plainPassword: string,
  policy: PasswordPolicy = defaultPasswordPolicy
): PasswordValidationResult {
  const errors: string[] = [];
  if (plainPassword.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  const maxLen = policy.maxLength ?? 128;
  if (plainPassword.length > maxLen) {
    errors.push(`Password must be at most ${maxLen} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(plainPassword)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (policy.requireLowercase && !/[a-z]/.test(plainPassword)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (policy.requireDigit && !/\d/.test(plainPassword)) {
    errors.push("Password must contain at least one digit");
  }
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(plainPassword)) {
    errors.push("Password must contain at least one special character");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ValidatePasswordWithPolicyOptions {
  checkBreach?: boolean;
}

export async function validatePasswordWithPolicy(
  plainPassword: string,
  policy: PasswordPolicy = defaultPasswordPolicy,
  options: ValidatePasswordWithPolicyOptions = {}
): Promise<PasswordValidationResult> {
  const result = validatePassword(plainPassword, policy);
  if (!options.checkBreach) return result;
  if (!result.valid) return result;
  const pwned = await isPasswordPwned(plainPassword);
  if (pwned) {
    return {
      valid: false,
      errors: [...result.errors, "Password has been found in a data breach"],
    };
  }
  return result;
}

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function isPasswordPwned(plainPassword: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(plainPassword, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetch(`${HIBP_RANGE_URL}${prefix}`);
  if (!res.ok) return false;
  const text = await res.text();
  const lines = text.split("\r\n");
  return lines.some((line) => {
    const [hashSuffix] = line.split(":");
    return hashSuffix === suffix;
  });
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: MEMORY_KB,
    timeCost: ITERATIONS,
    parallelism: PARALLELISM,
  });
}

export async function verifyPassword(
  hash: string,
  plainPassword: string
): Promise<boolean> {
  return argon2.verify(hash, plainPassword);
}
