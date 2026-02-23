import { createHmac, randomBytes } from "crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export const SENSITIVE_OPERATIONS = [
  "change_email",
  "change_password",
  "disable_mfa",
  "delete_account",
] as const;

export type SensitiveOperationType = (typeof SENSITIVE_OPERATIONS)[number];

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(base64, "base64");
}

export interface DoubleOptInPayload {
  userId: string;
  email: string;
  operation: SensitiveOperationType;
  operationParams?: Record<string, string>;
}

export interface CreateConfirmationTokenOptions {
  ttlMs?: number;
}

export interface CreateConfirmationTokenResult {
  token: string;
  expiresAt: number;
  jti: string;
}

export interface VerifyConfirmationTokenResult extends DoubleOptInPayload {
  jti: string;
}

export interface SingleUseConfirmationStore {
  isUsed(jti: string): boolean;
  markUsed(jti: string, expiresAtMs: number): void;
}

function encodePayload(data: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(data), "utf8"));
}

export function createConfirmationToken(
  payload: DoubleOptInPayload,
  secret: string,
  options: CreateConfirmationTokenOptions = {}
): CreateConfirmationTokenResult {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const expSec = Math.floor(expiresAt / 1000);
  const jti = randomBytes(16).toString("hex");
  const data = {
    exp: expSec,
    jti,
    userId: payload.userId,
    email: payload.email,
    operation: payload.operation,
    operationParams: payload.operationParams ?? {},
  };
  const payloadB64 = encodePayload(data);
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const token = `${payloadB64}.${base64url(sig)}`;
  return { token, expiresAt, jti };
}

export interface VerifyConfirmationTokenOptions {
  usedTokenStore?: SingleUseConfirmationStore;
}

export function verifyConfirmationToken(
  token: string,
  secret: string,
  options: VerifyConfirmationTokenOptions = {}
): VerifyConfirmationTokenResult | null {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let payloadBuf: Buffer;
  try {
    payloadBuf = decodeBase64url(payloadB64);
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  const expectedB64 = base64url(expectedSig);
  if (sigB64 !== expectedB64) return null;
  let data: {
    exp: number;
    jti: string;
    userId: string;
    email: string;
    operation: string;
    operationParams?: Record<string, string>;
  };
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as typeof data;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (data.exp < nowSec) return null;
  if (
    typeof data.jti !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.email !== "string" ||
    typeof data.operation !== "string"
  ) {
    return null;
  }
  if (!SENSITIVE_OPERATIONS.includes(data.operation as SensitiveOperationType)) {
    return null;
  }
  const store = options.usedTokenStore;
  if (store?.isUsed(data.jti)) return null;
  if (store) store.markUsed(data.jti, data.exp * 1000);
  return {
    jti: data.jti,
    userId: data.userId,
    email: data.email,
    operation: data.operation as SensitiveOperationType,
    operationParams: data.operationParams ?? {},
  };
}

export function createMemoryConfirmationStore(): SingleUseConfirmationStore {
  const used = new Map<string, number>();
  return {
    isUsed(jti: string): boolean {
      const exp = used.get(jti);
      if (exp === undefined) return false;
      if (exp < Date.now()) {
        used.delete(jti);
        return false;
      }
      return true;
    },
    markUsed(jti: string, expiresAtMs: number): void {
      used.set(jti, expiresAtMs);
    },
  };
}

export function isSensitiveOperation(
  operation: string
): operation is SensitiveOperationType {
  return SENSITIVE_OPERATIONS.includes(operation as SensitiveOperationType);
}
