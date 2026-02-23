import { generateSecureToken } from "./secure-token.js";

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
