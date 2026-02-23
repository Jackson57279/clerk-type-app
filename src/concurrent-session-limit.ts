const DEFAULT_USER_LIMIT = 5;

interface SessionRecord {
  userId: string;
  orgId: string | null;
  createdAt: number;
}

const sessions = new Map<string, SessionRecord>();

export interface SessionLimits {
  user: number;
  org?: number;
}

export interface CheckResult {
  allowed: boolean;
  evictSessionIds: string[];
}

export function checkCanCreateSession(
  userId: string,
  orgId: string | null,
  limits: SessionLimits
): CheckResult {
  const userLimit = limits.user;
  const orgLimit = limits.org;
  if (userLimit < 1) return { allowed: false, evictSessionIds: [] };
  if (orgId != null && orgLimit !== undefined && orgLimit < 1) {
    return { allowed: false, evictSessionIds: [] };
  }
  const userSessions = getSessionsByUser(userId);
  const orgSessions =
    orgId != null ? getSessionsByOrg(orgId) : [];
  const evictForUser =
    userSessions.length >= userLimit
      ? userSessions.slice(0, userSessions.length - userLimit + 1)
      : [];
  const evictForOrg =
    orgId != null &&
    orgLimit !== undefined &&
    orgSessions.length >= orgLimit
      ? orgSessions.slice(0, orgSessions.length - orgLimit + 1)
      : [];
  const evictSessionIds = mergeEvictIdsByCreated(evictForUser, evictForOrg);
  return { allowed: true, evictSessionIds };
}

function getSessionsByUser(userId: string): string[] {
  const entries: { sessionId: string; createdAt: number }[] = [];
  for (const [sessionId, rec] of sessions) {
    if (rec.userId === userId) entries.push({ sessionId, createdAt: rec.createdAt });
  }
  entries.sort((a, b) => a.createdAt - b.createdAt);
  return entries.map((e) => e.sessionId);
}

function getSessionsByOrg(orgId: string): string[] {
  const entries: { sessionId: string; createdAt: number }[] = [];
  for (const [sessionId, rec] of sessions) {
    if (rec.orgId === orgId) entries.push({ sessionId, createdAt: rec.createdAt });
  }
  entries.sort((a, b) => a.createdAt - b.createdAt);
  return entries.map((e) => e.sessionId);
}

function mergeEvictIdsByCreated(
  sessionIdsA: string[],
  sessionIdsB: string[]
): string[] {
  const byCreated: { sessionId: string; createdAt: number }[] = [];
  for (const id of sessionIdsA) {
    const rec = sessions.get(id);
    if (rec) byCreated.push({ sessionId: id, createdAt: rec.createdAt });
  }
  for (const id of sessionIdsB) {
    if (sessionIdsA.includes(id)) continue;
    const rec = sessions.get(id);
    if (rec) byCreated.push({ sessionId: id, createdAt: rec.createdAt });
  }
  byCreated.sort((a, b) => a.createdAt - b.createdAt);
  return byCreated.map((e) => e.sessionId);
}

export function registerSession(
  sessionId: string,
  userId: string,
  orgId: string | null = null
): void {
  sessions.set(sessionId, {
    userId,
    orgId,
    createdAt: Date.now(),
  });
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getActiveCountByUser(userId: string): number {
  let n = 0;
  for (const rec of sessions.values()) {
    if (rec.userId === userId) n++;
  }
  return n;
}

export function getActiveCountByOrg(orgId: string): number {
  let n = 0;
  for (const rec of sessions.values()) {
    if (rec.orgId === orgId) n++;
  }
  return n;
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function invalidateAllSessionsForUser(userId: string): string[] {
  const ids = getSessionsByUser(userId);
  for (const id of ids) sessions.delete(id);
  return ids;
}

export type SessionLimitsResolver = (
  userId: string,
  orgId: string | null
) => { user?: number; org?: number };

export interface ConcurrentSessionLimitOptions {
  defaultUserLimit?: number;
  defaultOrgLimit?: number;
  getLimits?: SessionLimitsResolver;
}

export function createConcurrentSessionLimit(
  options: ConcurrentSessionLimitOptions = {}
) {
  const defaultUserLimit = options.defaultUserLimit ?? DEFAULT_USER_LIMIT;
  const defaultOrgLimit = options.defaultOrgLimit;
  const getLimits = options.getLimits;
  const store = new Map<string, SessionRecord>();

  function getByUser(userId: string): string[] {
    const entries: { sessionId: string; createdAt: number }[] = [];
    for (const [sessionId, rec] of store) {
      if (rec.userId === userId)
        entries.push({ sessionId, createdAt: rec.createdAt });
    }
    entries.sort((a, b) => a.createdAt - b.createdAt);
    return entries.map((e) => e.sessionId);
  }

  function getByOrg(orgId: string): string[] {
    const entries: { sessionId: string; createdAt: number }[] = [];
    for (const [sessionId, rec] of store) {
      if (rec.orgId === orgId)
        entries.push({ sessionId, createdAt: rec.createdAt });
    }
    entries.sort((a, b) => a.createdAt - b.createdAt);
    return entries.map((e) => e.sessionId);
  }

  function mergeEvict(
    sessionIdsA: string[],
    sessionIdsB: string[]
  ): string[] {
    const byCreated: { sessionId: string; createdAt: number }[] = [];
    for (const id of sessionIdsA) {
      const rec = store.get(id);
      if (rec) byCreated.push({ sessionId: id, createdAt: rec.createdAt });
    }
    for (const id of sessionIdsB) {
      if (sessionIdsA.includes(id)) continue;
      const rec = store.get(id);
      if (rec) byCreated.push({ sessionId: id, createdAt: rec.createdAt });
    }
    byCreated.sort((a, b) => a.createdAt - b.createdAt);
    return byCreated.map((e) => e.sessionId);
  }

  return {
    check(
      userId: string,
      orgId: string | null,
      limits?: { user?: number; org?: number }
    ): CheckResult {
      const resolved =
        getLimits != null ? getLimits(userId, orgId) : ({} as { user?: number; org?: number });
      const userLimit =
        limits?.user ?? resolved.user ?? defaultUserLimit;
      const orgLimit =
        limits?.org ?? resolved.org ?? defaultOrgLimit;
      if (userLimit < 1) return { allowed: false, evictSessionIds: [] };
      if (orgId != null && orgLimit !== undefined && orgLimit < 1) {
        return { allowed: false, evictSessionIds: [] };
      }
      const userSessions = getByUser(userId);
      const orgSessions = orgId != null ? getByOrg(orgId) : [];
      const evictForUser =
        userSessions.length >= userLimit
          ? userSessions.slice(0, userSessions.length - userLimit + 1)
          : [];
      const evictForOrg =
        orgId != null &&
        orgLimit !== undefined &&
        orgSessions.length >= orgLimit
          ? orgSessions.slice(0, orgSessions.length - orgLimit + 1)
          : [];
      const evictSessionIds = mergeEvict(evictForUser, evictForOrg);
      return { allowed: true, evictSessionIds };
    },
    register(sessionId: string, userId: string, orgId: string | null = null): void {
      store.set(sessionId, {
        userId,
        orgId,
        createdAt: Date.now(),
      });
    },
    remove(sessionId: string): void {
      store.delete(sessionId);
    },
    getActiveCountByUser(userId: string): number {
      let n = 0;
      for (const rec of store.values()) {
        if (rec.userId === userId) n++;
      }
      return n;
    },
    getActiveCountByOrg(orgId: string): number {
      let n = 0;
      for (const rec of store.values()) {
        if (rec.orgId === orgId) n++;
      }
      return n;
    },
    invalidateAllSessionsForUser(userId: string): string[] {
      const ids = getByUser(userId);
      for (const id of ids) store.delete(id);
      return ids;
    },
  };
}
