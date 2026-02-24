import { createHmac, createHash, randomBytes } from "crypto";
import { hashDeviceFingerprint, validateDeviceBinding } from "./device-binding.js";
import {
  checkCanCreateSession,
  registerSession,
  removeSession,
  type SessionLimits,
} from "./concurrent-session-limit.js";

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
const REFRESH_TOKEN_BYTES = 32;

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

function encodePayload(data: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(data), "utf8"));
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  orgId: string | null;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  deviceFingerprint?: string | null;
}

export interface CreateSessionParams {
  userId: string;
  orgId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
}

export interface SessionStore {
  createSession(params: {
    sessionId: string;
    userId: string;
    orgId: string | null;
    refreshTokenHash: string;
    refreshTokenFamily: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceFingerprint?: string | null;
  }): Promise<string>;

  getSessionByRefreshHash(refreshTokenHash: string): Promise<SessionInfo | null>;

  rotateRefreshToken(sessionId: string, newRefreshTokenHash: string): Promise<void>;

  addUsedRefreshHash(familyId: string, refreshTokenHash: string): Promise<void>;

  getFamilyIdByUsedRefreshHash(refreshTokenHash: string): Promise<string | null>;

  revokeSession(sessionId: string): Promise<void>;

  revokeAllSessionsInFamily(familyId: string): Promise<void>;

  revokeAllForUser(userId: string): Promise<string[]>;
}

export interface SessionManagementOptions {
  secret: string;
  accessTokenTtlMs?: number;
  refreshTokenTtlSec?: number;
  iss?: string;
  aud?: string;
  concurrentLimit?: SessionLimits;
}

export interface RefreshSessionOptions extends SessionManagementOptions {
  deviceFingerprint?: string | null;
  skipDeviceBinding?: boolean;
}

export interface CreateSessionResult {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export class SessionLimitReachedError extends Error {
  constructor() {
    super("Concurrent session limit reached");
    this.name = "SessionLimitReachedError";
  }
}

export interface AccessTokenPayload {
  sub: string;
  session_id: string;
  org_id?: string | null;
  iat: number;
  exp: number;
  jti: string;
}

export interface RefreshSessionSuccess {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface RefreshSessionReplayDetected {
  error: "invalid_grant";
  error_description: string;
  replayDetected: true;
}

export interface RefreshSessionInvalidGrant {
  error: "invalid_grant";
  error_description: string;
}

export type RefreshSessionResult =
  | RefreshSessionSuccess
  | RefreshSessionReplayDetected
  | RefreshSessionInvalidGrant;

export async function createSession(
  store: SessionStore,
  params: CreateSessionParams,
  options: SessionManagementOptions
): Promise<CreateSessionResult> {
  const accessTtlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const refreshTtlSec = options.refreshTokenTtlSec ?? DEFAULT_REFRESH_TOKEN_TTL_SEC;
  const orgId = params.orgId ?? null;

  if (options.concurrentLimit) {
    const limitCheck = checkCanCreateSession(
      params.userId,
      orgId,
      options.concurrentLimit
    );
    if (!limitCheck.allowed) {
      throw new SessionLimitReachedError();
    }
    for (const sessionId of limitCheck.evictSessionIds) {
      await store.revokeSession(sessionId);
      removeSession(sessionId);
    }
  }

  const sessionId = randomBytes(16).toString("hex");
  const familyId = randomBytes(16).toString("hex");
  const rawRefresh = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const refreshTokenHash = hashRefreshToken(rawRefresh);
  const expiresAt = new Date(Date.now() + refreshTtlSec * 1000);

  const createdSessionId = await store.createSession({
    sessionId,
    userId: params.userId,
    orgId,
    refreshTokenHash,
    refreshTokenFamily: familyId,
    expiresAt,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    deviceFingerprint: params.deviceFingerprint,
  });
  const usedId = createdSessionId || sessionId;

  if (options.concurrentLimit) {
    registerSession(usedId, params.userId, orgId);
  }

  const accessToken = issueAccessToken(
    params.userId,
    usedId,
    orgId,
    options.secret,
    accessTtlMs,
    options.iss,
    options.aud
  );
  const expiresIn = Math.floor(accessTtlMs / 1000);
  return {
    accessToken,
    refreshToken: rawRefresh,
    sessionId: usedId,
    expiresIn,
    refreshExpiresIn: refreshTtlSec,
  };
}

function issueAccessToken(
  sub: string,
  sessionId: string,
  orgId: string | null,
  secret: string,
  ttlMs: number,
  iss?: string,
  aud?: string
): string {
  const nowMs = Date.now();
  const expSec = Math.floor((nowMs + ttlMs) / 1000);
  const iatSec = Math.floor(nowMs / 1000);
  const jti = randomBytes(16).toString("hex");
  const payload: Record<string, unknown> = {
    sub,
    session_id: sessionId,
    iat: iatSec,
    exp: expSec,
    jti,
  };
  if (orgId != null) payload.org_id = orgId;
  if (iss) payload.iss = iss;
  if (aud) payload.aud = aud;

  const headerB64 = encodePayload(JWT_HEADER as unknown as Record<string, unknown>);
  const payloadB64 = encodePayload(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
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
  if (sigB64 !== base64url(expectedSig)) return null;
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

export async function refreshSession(
  store: SessionStore,
  refreshToken: string,
  options: RefreshSessionOptions
): Promise<RefreshSessionResult> {
  const hash = hashRefreshToken(refreshToken);
  const usedFamilyId = await store.getFamilyIdByUsedRefreshHash(hash);
  if (usedFamilyId != null) {
    await store.revokeAllSessionsInFamily(usedFamilyId);
    return {
      error: "invalid_grant",
      error_description: "Refresh token reuse detected; all sessions in this family have been revoked",
      replayDetected: true,
    };
  }

  const session = await store.getSessionByRefreshHash(hash);
  if (!session) {
    return {
      error: "invalid_grant",
      error_description: "Invalid or expired refresh token",
    };
  }
  if (session.revokedAt != null) {
    return {
      error: "invalid_grant",
      error_description: "Session has been revoked",
    };
  }
  if (session.expiresAt.getTime() < Date.now()) {
    return {
      error: "invalid_grant",
      error_description: "Refresh token has expired",
    };
  }

  const storedFp = session.deviceFingerprint != null && session.deviceFingerprint.trim() !== ""
    ? session.deviceFingerprint
    : null;
  const storedFingerprintHash = storedFp ? hashDeviceFingerprint(storedFp) : null;
  if (
    !options.skipDeviceBinding &&
    storedFingerprintHash != null &&
    !validateDeviceBinding({
      storedFingerprintHash,
      currentFingerprint: options.deviceFingerprint ?? null,
    })
  ) {
    return {
      error: "invalid_grant",
      error_description: "Device binding validation failed",
    };
  }

  const accessTtlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const refreshTtlSec = options.refreshTokenTtlSec ?? DEFAULT_REFRESH_TOKEN_TTL_SEC;
  const newRawRefresh = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const newHash = hashRefreshToken(newRawRefresh);

  await store.addUsedRefreshHash(session.familyId, hash);
  await store.rotateRefreshToken(session.sessionId, newHash);

  const accessToken = issueAccessToken(
    session.userId,
    session.sessionId,
    session.orgId,
    options.secret,
    accessTtlMs,
    options.iss,
    options.aud
  );
  const expiresIn = Math.floor(accessTtlMs / 1000);

  return {
    accessToken,
    refreshToken: newRawRefresh,
    sessionId: session.sessionId,
    expiresIn,
    refreshExpiresIn: refreshTtlSec,
  };
}

export interface RevokeSessionOptions {
  onRevoke?: (sessionId: string) => void;
}

export function revokeSession(
  store: SessionStore,
  sessionId: string,
  options?: RevokeSessionOptions
): Promise<void> {
  options?.onRevoke?.(sessionId);
  return store.revokeSession(sessionId);
}

export function revokeAllSessionsForUser(
  store: SessionStore,
  userId: string
): Promise<string[]> {
  return store.revokeAllForUser(userId);
}

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<
    string,
    {
      sessionId: string;
      userId: string;
      orgId: string | null;
      familyId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
      deviceFingerprint: string | null;
    }
  >();
  const byRefreshHash = new Map<string, string>();
  const usedHashes = new Map<string, string>();

  return {
    async createSession(params) {
      const sessionId = params.sessionId;
      const rec = {
        sessionId,
        userId: params.userId,
        orgId: params.orgId,
        familyId: params.refreshTokenFamily,
        refreshTokenHash: params.refreshTokenHash,
        expiresAt: params.expiresAt,
        revokedAt: null as Date | null,
        deviceFingerprint: params.deviceFingerprint ?? null,
      };
      sessions.set(sessionId, rec);
      byRefreshHash.set(params.refreshTokenHash, sessionId);
      return sessionId;
    },

    async getSessionByRefreshHash(refreshTokenHash) {
      const sessionId = byRefreshHash.get(refreshTokenHash);
      if (!sessionId) return null;
      const rec = sessions.get(sessionId);
      if (!rec) return null;
      return {
        sessionId: rec.sessionId,
        userId: rec.userId,
        orgId: rec.orgId,
        familyId: rec.familyId,
        expiresAt: rec.expiresAt,
        revokedAt: rec.revokedAt,
        deviceFingerprint: rec.deviceFingerprint,
      };
    },

    async rotateRefreshToken(sessionId, newRefreshTokenHash) {
      const rec = sessions.get(sessionId);
      if (!rec) return;
      byRefreshHash.delete(rec.refreshTokenHash);
      rec.refreshTokenHash = newRefreshTokenHash;
      byRefreshHash.set(newRefreshTokenHash, sessionId);
    },

    async addUsedRefreshHash(familyId, refreshTokenHash) {
      usedHashes.set(refreshTokenHash, familyId);
    },

    async getFamilyIdByUsedRefreshHash(refreshTokenHash) {
      return usedHashes.get(refreshTokenHash) ?? null;
    },

    async revokeSession(sessionId) {
      const rec = sessions.get(sessionId);
      if (rec) {
        rec.revokedAt = new Date();
        byRefreshHash.delete(rec.refreshTokenHash);
      }
    },

    async revokeAllSessionsInFamily(familyId) {
      for (const rec of sessions.values()) {
        if (rec.familyId === familyId) {
          rec.revokedAt = new Date();
          byRefreshHash.delete(rec.refreshTokenHash);
        }
      }
    },

    async revokeAllForUser(userId) {
      const ids: string[] = [];
      for (const [sessionId, rec] of sessions) {
        if (rec.userId === userId) {
          rec.revokedAt = new Date();
          byRefreshHash.delete(rec.refreshTokenHash);
          ids.push(sessionId);
        }
      }
      return ids;
    },
  };
}
