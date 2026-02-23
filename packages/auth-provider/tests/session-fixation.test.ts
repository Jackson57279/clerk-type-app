import { describe, it, expect } from "vitest";
import { regenerateSessionId } from "../src/session-fixation.js";

describe("regenerateSessionId (session fixation prevention)", () => {
  it("returns a new session ID different from the old one", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const oldId = "fixed-session-123";
    sessionStore.register(oldId, "user1", null);

    const newId = regenerateSessionId(oldId, "user1", null, sessionStore);

    expect(newId).not.toBe(oldId);
    expect(newId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("removes the old session from the store", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const oldId = "old-session";
    sessionStore.register(oldId, "user1", null);

    regenerateSessionId(oldId, "user1", null, sessionStore);

    expect(store.has(oldId)).toBe(false);
  });

  it("registers the new session with the same userId and orgId", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const oldId = "old-session";
    sessionStore.register(oldId, "user1", "org1");

    const newId = regenerateSessionId(oldId, "user1", "org1", sessionStore);

    const rec = store.get(newId);
    expect(rec).toEqual({ userId: "user1", orgId: "org1" });
  });

  it("works when old session was not in store (e.g. first login)", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const oldId = "pre-login-or-fixated-id";

    const newId = regenerateSessionId(oldId, "user1", null, sessionStore);

    expect(store.has(oldId)).toBe(false);
    expect(store.get(newId)).toEqual({ userId: "user1", orgId: null });
  });

  it("produces unique new session IDs on each call", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const id1 = regenerateSessionId("pre1", "user1", null, sessionStore);
    const id2 = regenerateSessionId("pre2", "user1", null, sessionStore);
    expect(id1).not.toBe(id2);
  });

  it("prevents session fixation: after login old session is invalid, only new session is valid", () => {
    const store = new Map<string, { userId: string; orgId: string | null }>();
    const sessionStore = {
      remove(id: string) {
        store.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        store.set(id, { userId, orgId });
      },
    };
    const fixatedSessionId = "attacker-known-session-id";
    sessionStore.register(fixatedSessionId, "anonymous", null);

    const newSessionId = regenerateSessionId(
      fixatedSessionId,
      "user1",
      null,
      sessionStore
    );

    expect(store.has(fixatedSessionId)).toBe(false);
    expect(store.get(newSessionId)).toEqual({ userId: "user1", orgId: null });
    expect(newSessionId).not.toBe(fixatedSessionId);
  });
});
