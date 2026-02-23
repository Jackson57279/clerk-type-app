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

export interface RemoteLogoutRequest {
  userId: string;
}

export type RemoteLogoutResponse = InvalidateAllSessionsResult;

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

export function remoteLogout(
  request: RemoteLogoutRequest,
  store: RemoteLogoutStore
): RemoteLogoutResponse {
  return invalidateAllSessions(request.userId, store);
}

export interface RemoteLogoutEndpointParams {
  userId: string;
}

export interface RemoteLogoutEndpointOptions {
  store: RemoteLogoutStore;
}

export interface RemoteLogoutEndpointSuccess {
  status: 200;
  body: RemoteLogoutResponse;
}

export interface RemoteLogoutEndpointError {
  status: 400;
  body: { error: string; error_description: string };
}

export type RemoteLogoutEndpointResult =
  | RemoteLogoutEndpointSuccess
  | RemoteLogoutEndpointError;

export function handleRemoteLogoutEndpoint(
  params: RemoteLogoutEndpointParams,
  options: RemoteLogoutEndpointOptions
): RemoteLogoutEndpointResult {
  const userId = params.userId?.trim();
  if (!userId) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "userId is required",
      },
    };
  }
  const body = remoteLogout({ userId }, options.store);
  return { status: 200, body };
}
