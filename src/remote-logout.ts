import {
  invalidateAllSessionsForUser as invalidateInMemory,
} from "./concurrent-session-limit.js";

export interface RemoteLogoutStore {
  invalidateAllSessionsForUser(userId: string): string[];
}

export interface InvalidateAllSessionsResult {
  invalidatedSessionIds: string[];
  invalidatedCount: number;
}

export function invalidateAllSessions(
  userId: string,
  store: RemoteLogoutStore
): InvalidateAllSessionsResult {
  const invalidatedSessionIds = store.invalidateAllSessionsForUser(userId);
  return {
    invalidatedSessionIds,
    invalidatedCount: invalidatedSessionIds.length,
  };
}

export function createDefaultRemoteLogoutStore(): RemoteLogoutStore {
  return {
    invalidateAllSessionsForUser(userId: string): string[] {
      return invalidateInMemory(userId);
    },
  };
}
