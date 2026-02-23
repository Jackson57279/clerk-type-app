import { generateSecureToken } from "./secure-token.js";

export interface SessionStore {
  remove(sessionId: string): void;
  register(sessionId: string, userId: string, orgId: string | null): void;
}

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
