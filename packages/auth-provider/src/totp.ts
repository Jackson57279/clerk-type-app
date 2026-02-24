/**
 * RFC 6238 TOTP: time-based one-time passwords (HOTP with T = floor((time - T0) / X)).
 */
import { createHmac } from "crypto";

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;
const EPOCH = 0;

export interface TOTPOptions {
  time?: number;
  digits?: number;
  period?: number;
  t0?: number;
}

export interface VerifyTOTPOptions {
  digits?: number;
  period?: number;
  t0?: number;
  window?: number;
}

function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret);
  hmac.update(msg);
  const hash = hmac.digest();
  const offset = hash[19]! & 0xf;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

function toSecretBuffer(secret: Buffer | string): Buffer {
  return Buffer.isBuffer(secret) ? secret : Buffer.from(secret, "utf8");
}

export function generateTOTP(
  secret: Buffer | string,
  options: TOTPOptions = {}
): string {
  const key = toSecretBuffer(secret);
  const period = options.period ?? DEFAULT_PERIOD;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const t0 = options.t0 ?? EPOCH;
  const time = options.time ?? Math.floor(Date.now() / 1000);
  const t = Math.floor((time - t0) / period);
  const counter = t >= 0 ? BigInt(t) : BigInt(0);
  return hotp(key, counter, digits);
}

export function verifyTOTP(
  secret: Buffer | string,
  token: string,
  options: VerifyTOTPOptions = {}
): boolean {
  const key = toSecretBuffer(secret);
  const period = options.period ?? DEFAULT_PERIOD;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const t0 = options.t0 ?? EPOCH;
  const window = options.window ?? 1;
  const time = Math.floor(Date.now() / 1000);
  const t = Math.floor((time - t0) / period);
  if (token.length !== digits || !/^\d+$/.test(token)) {
    return false;
  }
  for (let d = -window; d <= window; d++) {
    const counter = BigInt(Math.max(0, t + d));
    if (hotp(key, counter, digits) === token) {
      return true;
    }
  }
  return false;
}
