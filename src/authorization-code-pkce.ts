import { createHmac, randomBytes, createHash } from "crypto";

const VERIFIER_MIN_LEN = 43;
const VERIFIER_MAX_LEN = 128;
const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;

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

export type CodeChallengeMethod = "S256" | "plain";

export function generateCodeVerifier(): string {
  const len =
    VERIFIER_MIN_LEN +
    Math.floor(
      (VERIFIER_MAX_LEN - VERIFIER_MIN_LEN) * (randomBytes(1)[0] ?? 0) / 256
    );
  let out = "";
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i++) {
    out += VERIFIER_CHARS[(bytes[i] ?? 0) % VERIFIER_CHARS.length];
  }
  return out;
}

export function computeCodeChallenge(
  codeVerifier: string,
  method: CodeChallengeMethod
): string {
  if (method === "plain") return codeVerifier;
  const hash = createHash("sha256").update(codeVerifier, "utf8").digest();
  return base64url(hash);
}

export function verifyCodeVerifier(
  codeVerifier: string,
  codeChallenge: string,
  method: CodeChallengeMethod
): boolean {
  if (method === "plain") return codeVerifier === codeChallenge;
  const expected = computeCodeChallenge(codeVerifier, "S256");
  return expected === codeChallenge;
}

export interface AuthorizationCodePayload {
  clientId: string;
  redirectUri: string;
  scope?: string;
  sub: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  state?: string;
}

export interface CreateAuthorizationCodeOptions {
  ttlMs?: number;
}

export interface CreateAuthorizationCodeResult {
  code: string;
  expiresAt: number;
  jti: string;
}

interface StoredCodePayload {
  exp: number;
  jti: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  sub: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  state?: string;
}

export function createAuthorizationCode(
  payload: AuthorizationCodePayload,
  secret: string,
  options: CreateAuthorizationCodeOptions = {}
): CreateAuthorizationCodeResult {
  const ttlMs = options.ttlMs ?? DEFAULT_CODE_TTL_MS;
  const expiresAt = Date.now() + ttlMs;
  const expSec = Math.floor(expiresAt / 1000);
  const jti = randomBytes(16).toString("hex");
  const data: StoredCodePayload = {
    exp: expSec,
    jti,
    clientId: payload.clientId,
    redirectUri: payload.redirectUri,
    scope: payload.scope,
    sub: payload.sub,
    codeChallenge: payload.codeChallenge,
    codeChallengeMethod: payload.codeChallengeMethod,
    state: payload.state,
  };
  const payloadStr = JSON.stringify(data);
  const payloadB64 = base64url(Buffer.from(payloadStr, "utf8"));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const code = `${payloadB64}.${base64url(sig)}`;
  return { code, expiresAt, jti };
}

export interface UsedAuthorizationCodeStore {
  isUsed(jti: string): boolean;
  markUsed(jti: string, expiresAtMs: number): void;
}

export interface VerifyAuthorizationCodeOptions {
  usedCodeStore?: UsedAuthorizationCodeStore;
}

export interface VerifyAuthorizationCodeResult extends AuthorizationCodePayload {
  jti: string;
}

export function verifyAndConsumeAuthorizationCode(
  code: string,
  codeVerifier: string,
  secret: string,
  options: VerifyAuthorizationCodeOptions = {}
): VerifyAuthorizationCodeResult | null {
  const dot = code.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = code.slice(0, dot);
  const sigB64 = code.slice(dot + 1);
  let payloadBuf: Buffer;
  try {
    payloadBuf = decodeBase64url(payloadB64);
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  if (sigB64 !== base64url(expectedSig)) return null;
  let data: StoredCodePayload;
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as StoredCodePayload;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (data.exp < nowSec) return null;
  if (
    typeof data.jti !== "string" ||
    typeof data.clientId !== "string" ||
    typeof data.redirectUri !== "string" ||
    typeof data.sub !== "string" ||
    typeof data.codeChallenge !== "string" ||
    typeof data.codeChallengeMethod !== "string"
  ) {
    return null;
  }
  if (
    data.codeChallengeMethod !== "S256" &&
    data.codeChallengeMethod !== "plain"
  ) {
    return null;
  }
  if (!verifyCodeVerifier(codeVerifier, data.codeChallenge, data.codeChallengeMethod)) {
    return null;
  }
  const store = options.usedCodeStore;
  if (store?.isUsed(data.jti)) return null;
  if (store) store.markUsed(data.jti, data.exp * 1000);
  return {
    jti: data.jti,
    clientId: data.clientId,
    redirectUri: data.redirectUri,
    scope: data.scope,
    sub: data.sub,
    codeChallenge: data.codeChallenge,
    codeChallengeMethod: data.codeChallengeMethod,
    state: data.state,
  };
}

export function createMemoryUsedAuthorizationCodeStore(): UsedAuthorizationCodeStore {
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
