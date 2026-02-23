import { randomBytes } from "crypto";
import { encode as base32Encode, decode as base32Decode } from "hi-base32";
import QRCode from "qrcode";
import { verifyTOTP } from "./totp.js";

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const SECRET_BYTES = 20;

export interface TotpStoreData {
  secret: string | null;
  enabled: boolean;
  pendingSecret: string | null;
}

export interface TotpStore {
  get(userId: string): Promise<TotpStoreData>;
  set(
    userId: string,
    data: Partial<TotpStoreData>
  ): Promise<void>;
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(SECRET_BYTES);
  const encoded = base32Encode(bytes).replace(/=+$/, "");
  return encoded;
}

export function buildOtpauthUri(
  issuer: string,
  accountName: string,
  secretBase32: string
): string {
  const label = accountName
    ? `${issuer}:${accountName}`
    : issuer;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    period: String(TOTP_PERIOD),
    digits: String(TOTP_DIGITS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export async function generateTotpQrDataUrl(
  otpauthUri: string
): Promise<string> {
  return QRCode.toDataURL(otpauthUri, { margin: 2 });
}

function secretToBuffer(secretBase32: string): Buffer {
  const bytes = base32Decode.asBytes(secretBase32);
  return Buffer.from(bytes);
}

export interface StartTotpSetupResult {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export async function startTotpSetup(
  userId: string,
  issuer: string,
  accountName: string,
  store: TotpStore
): Promise<StartTotpSetupResult> {
  const data = await store.get(userId);
  if (data.secret && data.enabled) {
    throw new Error("TOTP already enabled");
  }
  const secret = generateTotpSecret();
  await store.set(userId, { pendingSecret: secret });
  const otpauthUri = buildOtpauthUri(issuer, accountName, secret);
  const qrDataUrl = await generateTotpQrDataUrl(otpauthUri);
  return { secret, otpauthUri, qrDataUrl };
}

export async function confirmTotpSetup(
  userId: string,
  code: string,
  store: TotpStore
): Promise<boolean> {
  const data = await store.get(userId);
  const secret = data.pendingSecret;
  if (!secret) return false;
  const key = secretToBuffer(secret);
  if (!verifyTOTP(key, code, { period: TOTP_PERIOD, digits: TOTP_DIGITS })) {
    return false;
  }
  await store.set(userId, {
    secret,
    enabled: true,
    pendingSecret: null,
  });
  return true;
}

export async function verifyTotpChallenge(
  userId: string,
  code: string,
  store: TotpStore
): Promise<boolean> {
  const data = await store.get(userId);
  if (!data.secret || !data.enabled) return false;
  const key = secretToBuffer(data.secret);
  return verifyTOTP(key, code, { period: TOTP_PERIOD, digits: TOTP_DIGITS });
}

export async function disableTotp(
  userId: string,
  code: string,
  store: TotpStore
): Promise<boolean> {
  const data = await store.get(userId);
  if (!data.secret || !data.enabled) return false;
  const key = secretToBuffer(data.secret);
  if (!verifyTOTP(key, code, { period: TOTP_PERIOD, digits: TOTP_DIGITS })) {
    return false;
  }
  await store.set(userId, { secret: null, enabled: false, pendingSecret: null });
  return true;
}

export async function hasTotp(userId: string, store: TotpStore): Promise<boolean> {
  const data = await store.get(userId);
  return Boolean(data.secret && data.enabled);
}

export function createMemoryTotpStore(): TotpStore {
  const byUser = new Map<
    string,
    { secret: string | null; enabled: boolean; pendingSecret: string | null }
  >();
  const empty = (): TotpStoreData => ({
    secret: null,
    enabled: false,
    pendingSecret: null,
  });
  return {
    async get(userId: string) {
      const v = byUser.get(userId);
      return v ?? empty();
    },
    async set(userId: string, data: Partial<TotpStoreData>) {
      const current = byUser.get(userId) ?? empty();
      const next: TotpStoreData = {
        secret: data.secret !== undefined ? data.secret : current.secret,
        enabled: data.enabled !== undefined ? data.enabled : current.enabled,
        pendingSecret:
          data.pendingSecret !== undefined
            ? data.pendingSecret
            : current.pendingSecret,
      };
      if (
        next.secret === null &&
        !next.enabled &&
        next.pendingSecret === null
      ) {
        byUser.delete(userId);
      } else {
        byUser.set(userId, next);
      }
    },
  };
}
