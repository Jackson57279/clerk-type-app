import { createHash, randomInt } from "crypto";
import { createRateLimiter, type RateLimitResult } from "./rate-limit.js";
import type { SmsSender } from "./sms-otp.js";

const DEFAULT_DIGITS = 6;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;
const DEFAULT_TEMPLATE =
  "Your login verification code is {{code}}. Valid for 10 minutes.";

export interface UserMfaPhoneStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, phone: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

export interface SmsMfaChallengeStore {
  set(userId: string, codeHash: string, expiresAt: number): Promise<void>;
  get(userId: string): Promise<{ codeHash: string; expiresAt: number } | null>;
  delete(userId: string): Promise<void>;
}

export function createMemoryUserMfaPhoneStore(): UserMfaPhoneStore {
  const map = new Map<string, string>();
  return {
    async get(userId: string) {
      return map.get(userId) ?? null;
    },
    async set(userId: string, phone: string) {
      map.set(userId, phone);
    },
    async delete(userId: string) {
      map.delete(userId);
    },
  };
}

export function createMemorySmsMfaChallengeStore(): SmsMfaChallengeStore {
  const map = new Map<string, { codeHash: string; expiresAt: number }>();
  return {
    async set(userId: string, codeHash: string, expiresAt: number) {
      map.set(userId, { codeHash, expiresAt });
    },
    async get(userId: string) {
      return map.get(userId) ?? null;
    },
    async delete(userId: string) {
      map.delete(userId);
    },
  };
}

const challengeRateLimiter = createRateLimiter(
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX
);

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function generateCode(digits: number = DEFAULT_DIGITS): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, "0");
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

export async function hasSmsMfa(
  userId: string,
  phoneStore: UserMfaPhoneStore
): Promise<boolean> {
  const phone = await phoneStore.get(userId);
  return phone != null && phone.length > 0;
}

export interface SendLoginSmsOtpOptions {
  phoneStore: UserMfaPhoneStore;
  challengeStore: SmsMfaChallengeStore;
  sender: SmsSender;
  template?: string;
  ttlMs?: number;
  fallbackSender?: SmsSender;
  rateLimitKey?: string;
}

export interface SendLoginSmsOtpResult {
  success: boolean;
  phoneMasked?: string;
  retryAfterSeconds?: number;
}

export async function sendLoginSmsOtp(
  userId: string,
  options: SendLoginSmsOtpOptions
): Promise<SendLoginSmsOtpResult> {
  const {
    phoneStore,
    challengeStore,
    sender,
    template = DEFAULT_TEMPLATE,
    ttlMs = DEFAULT_TTL_MS,
    rateLimitKey = userId,
  } = options;

  const phone = await phoneStore.get(userId);
  if (!phone) {
    return { success: false };
  }

  const limitResult: RateLimitResult = challengeRateLimiter.check(rateLimitKey);
  if (!limitResult.allowed) {
    return {
      success: false,
      phoneMasked: maskPhone(phone),
      retryAfterSeconds: limitResult.retryAfterSeconds,
    };
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = Date.now() + ttlMs;
  await challengeStore.set(userId, codeHash, expiresAt);
  challengeRateLimiter.record(rateLimitKey);

  const body = template.replace(/\{\{code\}\}/g, code);
  try {
    await sender.send(phone, body);
  } catch {
    if (options.fallbackSender) {
      try {
        await options.fallbackSender.send(phone, body);
      } catch {
        await challengeStore.delete(userId);
        throw new Error("Failed to send SMS MFA code");
      }
    } else {
      await challengeStore.delete(userId);
      throw new Error("Failed to send SMS MFA code");
    }
  }

  return { success: true, phoneMasked: maskPhone(phone) };
}

export interface VerifyLoginSmsOtpOptions {
  challengeStore: SmsMfaChallengeStore;
}

export async function verifyLoginSmsOtp(
  userId: string,
  code: string,
  options: VerifyLoginSmsOtpOptions
): Promise<boolean> {
  const { challengeStore } = options;
  const stored = await challengeStore.get(userId);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    await challengeStore.delete(userId);
    return false;
  }
  const codeHash = hashCode(code);
  if (codeHash !== stored.codeHash) return false;
  await challengeStore.delete(userId);
  return true;
}
