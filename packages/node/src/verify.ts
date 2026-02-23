import { createHmac } from "crypto";

function decodeBase64url(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(base64, "base64");
}

export interface AccessTokenPayload {
  sub: string;
  session_id: string;
  org_id?: string | null;
  iat: number;
  exp: number;
  jti: string;
}

export function verifyAccessToken(
  token: string,
  secret: string
): AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const base64urlSig = expectedSig
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (sigB64 !== base64urlSig) return null;
  let payloadBuf: Buffer;
  try {
    payloadBuf = decodeBase64url(payloadB64);
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = data.exp as number | undefined;
  if (typeof exp !== "number" || exp < nowSec) return null;
  const sub = data.sub as string | undefined;
  const session_id = data.session_id as string | undefined;
  if (typeof sub !== "string" || typeof session_id !== "string") return null;
  const iat = data.iat as number | undefined;
  const jti = data.jti as string | undefined;
  const org_id = data.org_id as string | null | undefined;
  return {
    sub,
    session_id,
    org_id: org_id ?? null,
    iat: typeof iat === "number" ? iat : 0,
    exp,
    jti: typeof jti === "string" ? jti : "",
  };
}
