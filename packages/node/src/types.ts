export interface AuthPayload {
  userId: string;
  sessionId: string;
  orgId: string | null;
}

export interface AuthMiddlewareOptions {
  secret: string;
  headerName?: string;
}
