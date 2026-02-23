import { generateSecureToken } from "./secure-token.js";
import { buildSessionCookie, type SessionCookieOptions } from "./http-only-cookie.js";

export interface SessionStore {
  remove(sessionId: string): void;
  register(sessionId: string, userId: string, orgId: string | null): void;
}

/**
 * Returns a new session ID and updates the store (remove old, register new).
 * Call after successful login to prevent session fixation: the response must
 * set the session cookie to the returned ID so the pre-login/fixated ID is no longer valid.
 */
export function regenerateSessionId(
  oldSessionId: string,
  userId: string,
  orgId: string | null,
  store: SessionStore
): string {
  const newSessionId = generateSecureToken();
  store.remove(oldSessionId);
  store.register(newSessionId, userId, orgId);
  return newSessionId;
}

export interface CreateSessionAfterLoginOptions extends SessionCookieOptions {
  cookieName?: string;
}

/**
 * Regenerates session ID after login (session fixation prevention) and builds the
 * Set-Cookie header. Use the returned header on the login response so the client
 * receives the new session ID and the pre-login/fixated ID is no longer valid.
 */
export function createSessionAfterLogin(
  oldSessionId: string,
  userId: string,
  orgId: string | null,
  store: SessionStore,
  options: CreateSessionAfterLoginOptions = {}
): { newSessionId: string; setCookieHeader: string } {
  const { cookieName = "session", ...cookieOpts } = options;
  const newSessionId = regenerateSessionId(oldSessionId, userId, orgId, store);
  const setCookieHeader = buildSessionCookie(cookieName, newSessionId, cookieOpts);
  return { newSessionId, setCookieHeader };
}
