import { randomInt, createHash } from "crypto";
import { createRateLimiter, type RateLimitResult } from "./rate-limit.js";

const DEFAULT_DIGITS = 6;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const SMS_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const SMS_RATE_LIMIT_MAX = 3;
const DEFAULT_TEMPLATE = "Your verification code is {{code}}. Valid for 10 minutes.";

export interface SmsOtpStore {
  set(phone: string, codeHash: string, expiresAt: number): Promise<void>;
  get(phone: string): Promise<{ codeHash: string; expiresAt: number } | null>;
  delete(phone: string): Promise<void>;
}

export interface SmsSender {
  send(phone: string, body: string): Promise<void>;
}

export interface SendSmsOtpOptions {
  template?: string;
  ttlMs?: number;
  store?: SmsOtpStore;
  sender?: SmsSender;
  fallbackSender?: SmsSender;
  rateLimitKey?: string;
}

export interface SendSmsOtpResult {
  success: boolean;
  retryAfterSeconds?: number;
}

export interface VerifySmsOtpOptions {
  store?: SmsOtpStore;
}

function inMemoryStore(): SmsOtpStore {
  const map = new Map<
    string,
    { codeHash: string; expiresAt: number }
  >();
  return {
    async set(phone: string, codeHash: string, expiresAt: number) {
      map.set(phone, { codeHash, expiresAt });
    },
    async get(phone: string) {
      return map.get(phone) ?? null;
    },
    async delete(phone: string) {
      map.delete(phone);
    },
  };
}

export function createMemorySmsOtpStore(): SmsOtpStore {
  return inMemoryStore();
}

const defaultStore = inMemoryStore();
const smsRateLimiter = createRateLimiter(
  SMS_RATE_LIMIT_WINDOW_MS,
  SMS_RATE_LIMIT_MAX
);

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function generateSmsOtpCode(digits: number = DEFAULT_DIGITS): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, "0");
}

export function createTwilioSender(): SmsSender {
  return {
    async send(phone: string, body: string) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !from) {
        throw new Error(
          "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be set"
        );
      }
      const { default: Twilio } = await import("twilio");
      const client = Twilio(accountSid, authToken);
      await client.messages.create({
        body,
        from,
        to: phone,
      });
    },
  };
}

export async function sendSmsOtp(
  phone: string,
  options: SendSmsOtpOptions = {}
): Promise<SendSmsOtpResult> {
  const store = options.store ?? defaultStore;
  const sender = options.sender;
  const template = options.template ?? DEFAULT_TEMPLATE;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = options.rateLimitKey ?? phone;

  const limitResult: RateLimitResult = smsRateLimiter.check(key);
  if (!limitResult.allowed) {
    return {
      success: false,
      retryAfterSeconds: limitResult.retryAfterSeconds,
    };
  }

  if (!sender) {
    throw new Error("SMS sender is required (e.g. createTwilioSender())");
  }

  const code = generateSmsOtpCode();
  const codeHash = hashCode(code);
  const expiresAt = Date.now() + ttlMs;
  await store.set(phone, codeHash, expiresAt);
  smsRateLimiter.record(key);

  const body = template.replace(/\{\{code\}\}/g, code);
  try {
    await sender.send(phone, body);
  } catch {
    if (options.fallbackSender) {
      try {
        await options.fallbackSender.send(phone, body);
      } catch {
        await store.delete(phone);
        throw new Error("Failed to send SMS OTP");
      }
    } else {
      await store.delete(phone);
      throw new Error("Failed to send SMS OTP");
    }
  }

  return { success: true };
}

export async function verifySmsOtp(
  phone: string,
  code: string,
  options: VerifySmsOtpOptions = {}
): Promise<boolean> {
  const store = options.store ?? defaultStore;
  const stored = await store.get(phone);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    await store.delete(phone);
    return false;
  }
  const codeHash = hashCode(code);
  if (codeHash !== stored.codeHash) return false;
  await store.delete(phone);
  return true;
}
