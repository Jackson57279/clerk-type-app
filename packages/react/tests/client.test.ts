import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionClient } from "../src/client.js";

describe("createSessionClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses getSession when provided", async () => {
    const getSession = vi.fn().mockResolvedValue({
      ok: true,
      session: { sessionId: "s1", userId: "u1", orgId: null, expiresAt: null },
      user: { id: "u1", email: "a@b.com", name: "Alice", firstName: null, lastName: null },
    });
    const client = createSessionClient({ getSession });
    const result = await client.getSession();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.sessionId).toBe("s1");
      expect(result.user.id).toBe("u1");
      expect(result.user.email).toBe("a@b.com");
    }
  });

  it("returns ok: false when getSession returns error", async () => {
    const getSession = vi.fn().mockResolvedValue({ ok: false, error: "Unauthorized" });
    const client = createSessionClient({ getSession });
    const result = await client.getSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Unauthorized");
  });

  it("returns ok: false when no apiUrl and no getSession", async () => {
    const client = createSessionClient({});
    const result = await client.getSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("No apiUrl");
  });

  it("fetches from apiUrl/session when apiUrl provided", async () => {
    const session = { sessionId: "s2", userId: "u2", orgId: null, expiresAt: null };
    const user = { id: "u2", email: "b@c.com", name: "Bob", firstName: null, lastName: null };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session, user }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createSessionClient({ apiUrl: "https://api.example.com" });
    const result = await client.getSession();

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/session", {
      credentials: "include",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.sessionId).toBe("s2");
      expect(result.user.email).toBe("b@c.com");
    }
  });

  it("returns ok: false when fetch returns non-ok", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false }));
    const client = createSessionClient({ apiUrl: "https://api.example.com" });
    const result = await client.getSession();
    expect(result.ok).toBe(false);
  });

  it("strips trailing slash from apiUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          session: { sessionId: "s", userId: "u", orgId: null, expiresAt: null },
          user: { id: "u", email: null, name: null, firstName: null, lastName: null },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createSessionClient({ apiUrl: "https://api.example.com/" });
    await client.getSession();
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/session", expect.any(Object));
  });
});
