import { createHmac, randomBytes } from "crypto";
import { hashDeviceFingerprint, validateDeviceBinding } from "./device-binding.js";

export const DEFAULT_MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;

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

export interface MagicLinkPayload {
  email: string;
  userId?: string;
  deviceFingerprint?: string | null;
}

export interface CreateMagicLinkTokenOptions {
  ttlMs?: number;
}

export interface CreateMagicLinkTokenResult {
  token: string;
  expiresAt: number;
  jti: string;
}

export interface VerifyMagicLinkTokenResult extends MagicLinkPayload {
  jti: string;
}

export interface SingleUseTokenStore {
  isUsed(jti: string): boolean;
  markUsed(jti: string, expiresAtMs: number): void;
}

export function createMagicLinkToken(
  payload: MagicLinkPayload,
  secret: string,
  options: CreateMagicLinkTokenOptions = {}
): CreateMagicLinkTokenResult {
  const ttlMs = options.ttlMs ?? DEFAULT_MAGIC_LINK_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const expSec = Math.floor(expiresAt / 1000);
  const jti = randomBytes(16).toString("hex");
  const deviceFingerprintHash =
    payload.deviceFingerprint != null && payload.deviceFingerprint !== ""
      ? hashDeviceFingerprint(payload.deviceFingerprint)
      : undefined;
  const data = {
    exp: expSec,
    jti,
    email: payload.email,
    ...(payload.userId !== undefined && { userId: payload.userId }),
    ...(deviceFingerprintHash !== undefined && { deviceFingerprintHash }),
  };
  const headerB64 = base64url(
    Buffer.from(JSON.stringify(JWT_HEADER), "utf8")
  );
  const payloadB64 = base64url(Buffer.from(JSON.stringify(data), "utf8"));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  const token = `${signingInput}.${base64url(sig)}`;
  return { token, expiresAt, jti };
}

export interface VerifyMagicLinkTokenOptions {
  usedTokenStore?: SingleUseTokenStore;
  deviceFingerprint?: string | null;
}

export function verifyMagicLinkToken(
  token: string,
  secret: string,
  options: VerifyMagicLinkTokenOptions = {}
): VerifyMagicLinkTokenResult | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const expectedB64 = base64url(expectedSig);
  if (sigB64 !== expectedB64) return null;
  let payloadBuf: Buffer;
  try {
    payloadBuf = decodeBase64url(payloadB64);
  } catch {
    return null;
  }
  let data: {
    exp: number;
    jti: string;
    email: string;
    userId?: string;
    deviceFingerprintHash?: string;
  };
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as typeof data;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (data.exp < nowSec) return null;
  if (typeof data.jti !== "string" || typeof data.email !== "string") {
    return null;
  }
  const store = options.usedTokenStore;
  if (store?.isUsed(data.jti)) return null;
  if (
    data.deviceFingerprintHash != null &&
    !validateDeviceBinding({
      storedFingerprintHash: data.deviceFingerprintHash,
      currentFingerprint: options.deviceFingerprint ?? null,
    })
  ) {
    return null;
  }
  if (store) store.markUsed(data.jti, data.exp * 1000);
  return {
    jti: data.jti,
    email: data.email,
    ...(data.userId !== undefined && { userId: data.userId }),
  };
}

export function createMemoryUsedTokenStore(): SingleUseTokenStore {
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
