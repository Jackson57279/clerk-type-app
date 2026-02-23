import { createHash } from "crypto";
import { createRateLimiter, type RateLimitResult } from "./rate-limit.js";
import { generateSmsOtpCode } from "./sms-otp.js";
import type { SmsSender } from "./sms-otp.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 3;
const DEFAULT_TEMPLATE =
  "Your phone verification code is {{code}}. Valid for 10 minutes.";

function verificationKey(userId: string, phone: string): string {
  return `${userId}:${phone}`;
}

export interface PhoneVerificationStore {
  set(
    userId: string,
    phone: string,
    codeHash: string,
    expiresAt: number
  ): Promise<void>;
  get(
    userId: string,
    phone: string
  ): Promise<{ codeHash: string; expiresAt: number } | null>;
  delete(userId: string, phone: string): Promise<void>;
}

export interface SendPhoneVerificationOptions {
  template?: string;
  ttlMs?: number;
  store?: PhoneVerificationStore;
  sender?: SmsSender;
  fallbackSender?: SmsSender;
  rateLimitKey?: string;
}

export interface SendPhoneVerificationResult {
  success: boolean;
  retryAfterSeconds?: number;
}

export interface VerifyPhoneVerificationOptions {
  store?: PhoneVerificationStore;
}

function inMemoryStore(): PhoneVerificationStore {
  const map = new Map<
    string,
    { codeHash: string; expiresAt: number }
  >();
  return {
    async set(userId: string, phone: string, codeHash: string, expiresAt: number) {
      map.set(verificationKey(userId, phone), { codeHash, expiresAt });
    },
    async get(userId: string, phone: string) {
      return map.get(verificationKey(userId, phone)) ?? null;
    },
    async delete(userId: string, phone: string) {
      map.delete(verificationKey(userId, phone));
    },
  };
}

const defaultStore = inMemoryStore();
const rateLimiter = createRateLimiter(
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX
);

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function createMemoryPhoneVerificationStore(): PhoneVerificationStore {
  return inMemoryStore();
}

export async function sendPhoneVerificationCode(
  userId: string,
  phone: string,
  options: SendPhoneVerificationOptions = {}
): Promise<SendPhoneVerificationResult> {
  const store = options.store ?? defaultStore;
  const sender = options.sender;
  const template = options.template ?? DEFAULT_TEMPLATE;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = options.rateLimitKey ?? verificationKey(userId, phone);

  const limitResult: RateLimitResult = rateLimiter.check(key);
  if (!limitResult.allowed) {
    return {
      success: false,
      retryAfterSeconds: limitResult.retryAfterSeconds,
    };
  }

  if (!sender) {
    throw new Error("SMS sender is required (e.g. createTwilioSender from sms-otp)");
  }

  const code = generateSmsOtpCode();
  const codeHash = hashCode(code);
  const expiresAt = Date.now() + ttlMs;
  await store.set(userId, phone, codeHash, expiresAt);
  rateLimiter.record(key);

  const body = template.replace(/\{\{code\}\}/g, code);
  try {
    await sender.send(phone, body);
  } catch {
    if (options.fallbackSender) {
      try {
        await options.fallbackSender.send(phone, body);
      } catch {
        await store.delete(userId, phone);
        throw new Error("Failed to send phone verification SMS");
      }
    } else {
      await store.delete(userId, phone);
      throw new Error("Failed to send phone verification SMS");
    }
  }

  return { success: true };
}

export async function verifyPhoneVerificationCode(
  userId: string,
  phone: string,
  code: string,
  options: VerifyPhoneVerificationOptions = {}
): Promise<boolean> {
  const store = options.store ?? defaultStore;
  const stored = await store.get(userId, phone);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    await store.delete(userId, phone);
    return false;
  }
  const codeHash = hashCode(code);
  if (codeHash !== stored.codeHash) return false;
  await store.delete(userId, phone);
  return true;
}
