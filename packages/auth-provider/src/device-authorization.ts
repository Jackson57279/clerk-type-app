import { createHmac, randomBytes } from "crypto";

const USER_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LEN = 8;
const DEFAULT_EXPIRES_IN_SEC = 900;
const DEFAULT_INTERVAL_SEC = 5;
const SLOW_DOWN_EXTRA_SEC = 5;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

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

function formatUserCode(raw: string): string {
  const mid = Math.floor(raw.length / 2);
  return `${raw.slice(0, mid)}-${raw.slice(mid)}`;
}

function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_LEN);
  let out = "";
  for (let i = 0; i < USER_CODE_LEN; i++) {
    out += USER_CODE_CHARS[(bytes[i] ?? 0) % USER_CODE_CHARS.length];
  }
  return formatUserCode(out);
}

export type DeviceCodeStatus = "pending" | "authorized" | "denied";

export interface StoredDeviceEntry {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scope?: string;
  status: DeviceCodeStatus;
  sub?: string;
  expiresAt: number;
  lastPollAt?: number;
  intervalSec: number;
}

export interface DeviceCodeStore {
  save(entry: StoredDeviceEntry): void;
  findByDeviceCode(deviceCode: string): StoredDeviceEntry | null;
  findByUserCode(userCode: string): StoredDeviceEntry | null;
  update(deviceCode: string, update: Partial<StoredDeviceEntry>): void;
  remove(deviceCode: string): void;
}

export interface CreateDeviceAuthorizationOptions {
  clientId: string;
  scope?: string;
  verificationUri: string;
  expiresInSec?: number;
  intervalSec?: number;
  store: DeviceCodeStore;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export function createDeviceAuthorization(
  options: CreateDeviceAuthorizationOptions
): DeviceAuthorizationResponse {
  const expiresInSec = options.expiresInSec ?? DEFAULT_EXPIRES_IN_SEC;
  const intervalSec = options.intervalSec ?? DEFAULT_INTERVAL_SEC;
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = generateUserCode();
  const verificationUri = options.verificationUri.replace(/\/$/, "");
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;
  const expiresAt = Date.now() + expiresInSec * 1000;

  const entry: StoredDeviceEntry = {
    deviceCode,
    userCode,
    clientId: options.clientId,
    scope: options.scope,
    status: "pending",
    expiresAt,
    intervalSec,
  };
  options.store.save(entry);

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresInSec,
    interval: intervalSec,
  };
}

export function approveDeviceByUserCode(
  userCode: string,
  sub: string,
  store: DeviceCodeStore
): boolean {
  const entry = store.findByUserCode(userCode);
  if (!entry || entry.status !== "pending") return false;
  if (entry.expiresAt < Date.now()) return false;
  store.update(entry.deviceCode, { status: "authorized", sub });
  return true;
}

export function denyDeviceByUserCode(
  userCode: string,
  store: DeviceCodeStore
): boolean {
  const entry = store.findByUserCode(userCode);
  if (!entry || entry.status !== "pending") return false;
  store.update(entry.deviceCode, { status: "denied" });
  return true;
}

export type DeviceExchangeErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_grant";

export interface DeviceExchangeError {
  error: DeviceExchangeErrorCode;
  error_description?: string;
  interval?: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCodeFlowParams {
  grant_type: string;
  device_code?: string;
  client_id?: string;
}

export type DeviceCodeFlowErrorRequest =
  | { error: "unsupported_grant_type"; error_description: string }
  | { error: "invalid_request"; error_description: string };

export type DeviceCodeFlowResponse =
  | DeviceTokenResponse
  | DeviceExchangeError
  | DeviceCodeFlowErrorRequest;

export interface ExchangeDeviceCodeOptions {
  deviceCode: string;
  clientId: string;
  store: DeviceCodeStore;
  secret: string;
  ttlMs?: number;
  iss?: string;
  aud?: string;
}

function encodePayload(data: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(data), "utf8"));
}

function issueDeviceAccessToken(
  sub: string,
  clientId: string,
  scope: string | undefined,
  options: { secret: string; ttlMs: number; iss?: string; aud?: string }
): { access_token: string; expires_in: number } {
  const nowMs = Date.now();
  const expSec = Math.floor((nowMs + options.ttlMs) / 1000);
  const iatSec = Math.floor(nowMs / 1000);
  const jti = randomBytes(16).toString("hex");
  const payload: Record<string, unknown> = {
    sub,
    client_id: clientId,
    iat: iatSec,
    exp: expSec,
    jti,
  };
  if (scope) payload.scope = scope;
  if (options.iss) payload.iss = options.iss;
  if (options.aud) payload.aud = options.aud;

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = encodePayload(header as unknown as Record<string, unknown>);
  const payloadB64 = encodePayload(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", options.secret)
    .update(signingInput)
    .digest();
  const access_token = `${signingInput}.${base64url(sig)}`;
  return {
    access_token,
    expires_in: Math.floor(options.ttlMs / 1000),
  };
}

export function exchangeDeviceCode(
  options: ExchangeDeviceCodeOptions
): DeviceTokenResponse | DeviceExchangeError {
  const entry = options.store.findByDeviceCode(options.deviceCode);
  if (!entry) {
    return { error: "invalid_grant", error_description: "Unknown or invalid device_code" };
  }
  if (entry.clientId !== options.clientId) {
    return { error: "invalid_grant", error_description: "client_id does not match" };
  }
  if (entry.expiresAt < Date.now()) {
    options.store.remove(entry.deviceCode);
    return { error: "expired_token", error_description: "The device_code has expired" };
  }
  if (entry.status === "denied") {
    options.store.remove(entry.deviceCode);
    return { error: "access_denied", error_description: "The user denied the request" };
  }
  if (entry.status === "pending") {
    const now = Date.now();
    const intervalMs = entry.intervalSec * 1000;
    const lastPoll = entry.lastPollAt ?? 0;
    if (now - lastPoll < intervalMs) {
      options.store.update(entry.deviceCode, {
        lastPollAt: now,
        intervalSec: entry.intervalSec + SLOW_DOWN_EXTRA_SEC,
      });
      return {
        error: "slow_down",
        error_description: "Polling too frequently",
        interval: entry.intervalSec + SLOW_DOWN_EXTRA_SEC,
      };
    }
    options.store.update(entry.deviceCode, { lastPollAt: now });
    return {
      error: "authorization_pending",
      error_description: "The authorization request is still pending",
      interval: entry.intervalSec,
    };
  }
  if (entry.status === "authorized" && entry.sub) {
    const ttlMs = options.ttlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
    const token = issueDeviceAccessToken(
      entry.sub,
      entry.clientId,
      entry.scope,
      {
        secret: options.secret,
        ttlMs,
        iss: options.iss,
        aud: options.aud,
      }
    );
    options.store.remove(entry.deviceCode);
    const result: DeviceTokenResponse = {
      access_token: token.access_token,
      token_type: "Bearer",
      expires_in: token.expires_in,
    };
    if (entry.scope) result.scope = entry.scope;
    return result;
  }
  return { error: "invalid_grant", error_description: "Invalid device state" };
}

export type HandleDeviceCodeFlowOptions = Omit<
  ExchangeDeviceCodeOptions,
  "deviceCode" | "clientId"
>;

export function handleDeviceCodeFlow(
  params: DeviceCodeFlowParams,
  options: HandleDeviceCodeFlowOptions
): DeviceCodeFlowResponse {
  if (params.grant_type !== DEVICE_CODE_GRANT_TYPE) {
    return {
      error: "unsupported_grant_type",
      error_description: `grant_type must be ${DEVICE_CODE_GRANT_TYPE}`,
    };
  }
  const deviceCode = params.device_code?.trim();
  if (!deviceCode) {
    return {
      error: "invalid_request",
      error_description: "device_code is required",
    };
  }
  const clientId = params.client_id?.trim();
  if (!clientId) {
    return {
      error: "invalid_request",
      error_description: "client_id is required",
    };
  }
  return exchangeDeviceCode({
    ...options,
    deviceCode,
    clientId,
  });
}

export interface DeviceAccessTokenPayload {
  sub: string;
  client_id: string;
  scope?: string;
  iss?: string;
  aud?: string;
  iat: number;
  exp: number;
  jti: string;
}

export function verifyDeviceAccessToken(
  token: string,
  secret: string
): DeviceAccessTokenPayload | null {
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
  if (typeof sub !== "string") return null;
  const client_id = (data.client_id as string | undefined) ?? sub;
  const iat = data.iat as number | undefined;
  const jti = data.jti as string | undefined;
  return {
    sub,
    client_id,
    scope: data.scope as string | undefined,
    iss: data.iss as string | undefined,
    aud: data.aud as string | undefined,
    iat: typeof iat === "number" ? iat : 0,
    exp,
    jti: typeof jti === "string" ? jti : "",
  };
}

export function createMemoryDeviceCodeStore(): DeviceCodeStore {
  const byDevice = new Map<string, StoredDeviceEntry>();
  const byUser = new Map<string, string>();

  return {
    save(entry: StoredDeviceEntry): void {
      byDevice.set(entry.deviceCode, { ...entry });
      byUser.set(entry.userCode.toUpperCase(), entry.deviceCode);
    },
    findByDeviceCode(deviceCode: string): StoredDeviceEntry | null {
      const e = byDevice.get(deviceCode);
      return e ? { ...e } : null;
    },
    findByUserCode(userCode: string): StoredDeviceEntry | null {
      const deviceCode = byUser.get(userCode.toUpperCase());
      if (!deviceCode) return null;
      const e = byDevice.get(deviceCode);
      return e ? { ...e } : null;
    },
    update(deviceCode: string, update: Partial<StoredDeviceEntry>): void {
      const e = byDevice.get(deviceCode);
      if (!e) return;
      const next = { ...e, ...update };
      byDevice.set(deviceCode, next);
      if (next.userCode) byUser.set(next.userCode.toUpperCase(), deviceCode);
    },
    remove(deviceCode: string): void {
      const e = byDevice.get(deviceCode);
      if (e) byUser.delete(e.userCode.toUpperCase());
      byDevice.delete(deviceCode);
    },
  };
}
