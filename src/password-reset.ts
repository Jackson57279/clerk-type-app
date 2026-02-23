import { createHmac, randomBytes } from "crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

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

export interface PasswordResetPayload {
  userId: string;
  email: string;
}

export interface CreatePasswordResetTokenOptions {
  ttlMs?: number;
}

export interface CreatePasswordResetTokenResult {
  token: string;
  expiresAt: number;
  jti: string;
}

export interface VerifyPasswordResetTokenResult extends PasswordResetPayload {
  jti: string;
}

export function createPasswordResetToken(
  payload: PasswordResetPayload,
  secret: string,
  options: CreatePasswordResetTokenOptions = {}
): CreatePasswordResetTokenResult {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const expSec = Math.floor(expiresAt / 1000);
  const jti = randomBytes(16).toString("hex");
  const data = {
    exp: expSec,
    jti,
    userId: payload.userId,
    email: payload.email,
  };
  const payloadStr = JSON.stringify(data);
  const payloadB64 = base64url(Buffer.from(payloadStr, "utf8"));
  const sig = createHmac("sha256", secret)
    .update(payloadB64)
    .digest();
  const token = `${payloadB64}.${base64url(sig)}`;
  return { token, expiresAt, jti };
}

export function verifyPasswordResetToken(
  token: string,
  secret: string
): VerifyPasswordResetTokenResult | null {
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
  let data: { exp: number; jti: string; userId: string; email: string };
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as {
      exp: number;
      jti: string;
      userId: string;
      email: string;
    };
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (data.exp < nowSec) return null;
  if (
    typeof data.jti !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.email !== "string"
  ) {
    return null;
  }
  return {
    jti: data.jti,
    userId: data.userId,
    email: data.email,
  };
}
