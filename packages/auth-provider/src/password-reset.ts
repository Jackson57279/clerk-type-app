import { createHmac, randomBytes } from "crypto";

export const DEFAULT_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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

export interface SingleUseTokenStore {
  isUsed(jti: string): boolean;
  markUsed(jti: string, expiresAtMs: number): void;
}

export function createPasswordResetToken(
  payload: PasswordResetPayload,
  secret: string,
  options: CreatePasswordResetTokenOptions = {}
): CreatePasswordResetTokenResult {
  const ttlMs = options.ttlMs ?? DEFAULT_PASSWORD_RESET_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const expSec = Math.floor(expiresAt / 1000);
  const jti = randomBytes(16).toString("hex");
  const data = {
    exp: expSec,
    jti,
    userId: payload.userId,
    email: payload.email,
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

export interface VerifyPasswordResetTokenOptions {
  usedTokenStore?: SingleUseTokenStore;
}

export function verifyPasswordResetToken(
  token: string,
  secret: string,
  options: VerifyPasswordResetTokenOptions = {}
): VerifyPasswordResetTokenResult | null {
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
  const store = options.usedTokenStore ?? defaultUsedTokenStore;
  if (store.isUsed(data.jti)) return null;
  store.markUsed(data.jti, data.exp * 1000);
  return {
    jti: data.jti,
    userId: data.userId,
    email: data.email,
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

const defaultUsedTokenStore = createMemoryUsedTokenStore();

export function createNoOpUsedTokenStore(): SingleUseTokenStore {
  return {
    isUsed: () => false,
    markUsed: () => {},
  };
}
