import type { GetSessionResult } from "./types.js";

export interface SessionClient {
  getSession(): Promise<GetSessionResult>;
}

export function createSessionClient(options: {
  apiUrl?: string | null;
  getSession?: () => Promise<GetSessionResult>;
}): SessionClient {
  const { apiUrl, getSession } = options;
  if (typeof getSession === "function") {
    return { getSession };
  }
  const base = apiUrl ? apiUrl.replace(/\/$/, "") : "";
  return {
    async getSession(): Promise<GetSessionResult> {
      if (!base) {
        return { ok: false, error: "No apiUrl or getSession provided" };
      }
      try {
        const res = await fetch(`${base}/session`, { credentials: "include" });
        if (!res.ok) {
          return { ok: false, error: `Session request failed: ${res.status}` };
        }
        const data = (await res.json()) as {
          session?: { sessionId: string; userId: string; orgId?: string | null; expiresAt?: string | null };
          user?: { id: string; email?: string | null; name?: string | null; firstName?: string | null; lastName?: string | null };
        };
        const session = data.session;
        const user = data.user;
        if (!session || !user) {
          return { ok: false, error: "Invalid session response" };
        }
        return {
          ok: true,
          session: {
            sessionId: session.sessionId,
            userId: session.userId,
            orgId: session.orgId ?? null,
            expiresAt: session.expiresAt ?? null,
          },
          user: {
            id: user.id,
            email: user.email ?? null,
            name: user.name ?? null,
            firstName: user.firstName ?? null,
            lastName: user.lastName ?? null,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}
