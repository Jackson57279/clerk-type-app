import type { Request, Response } from "express";

export interface RemoteLogoutStore {
  invalidateAllSessionsForUser(userId: string): string[];
}

export interface RemoteLogoutRouteOptions {
  store: RemoteLogoutStore;
}

export function remoteLogoutRoute(options: RemoteLogoutRouteOptions) {
  return (req: Request, res: Response): void => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const userId = auth.userId?.trim();
    if (!userId) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "userId is required",
      });
      return;
    }
    const invalidatedSessionIds = options.store.invalidateAllSessionsForUser(userId);
    res.status(200).json({
      invalidatedSessionIds,
      invalidatedCount: invalidatedSessionIds.length,
    });
  };
}
