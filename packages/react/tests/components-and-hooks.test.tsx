import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  useUser,
  useSession,
  useAuth,
} from "../src/index.js";

function ShowUser() {
  const user = useUser();
  return <span data-testid="user">{user ? user.email ?? user.id : "none"}</span>;
}

function ShowSession() {
  const session = useSession();
  return <span data-testid="session">{session ? session.sessionId : "none"}</span>;
}

function ShowAuth() {
  const auth = useAuth();
  return (
    <span data-testid="auth">
      {auth.isLoaded ? (auth.isSignedIn ? "in" : "out") : "loading"}
    </span>
  );
}

describe("ClerkProvider, SignedIn, SignedOut, hooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("SignedIn renders children when signed in", async () => {
    const getSession = vi.fn().mockResolvedValue({
      ok: true,
      session: { sessionId: "sid1", userId: "u1", orgId: null, expiresAt: null },
      user: { id: "u1", email: "u@example.com", name: "User", firstName: null, lastName: null },
    });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <SignedIn>
          <span data-testid="signed-in-content">Signed in content</span>
        </SignedIn>
        <SignedOut>
          <span data-testid="signed-out-content">Signed out content</span>
        </SignedOut>
      </ClerkProvider>
    );

    await screen.findByTestId("signed-in-content");
    expect(screen.getByTestId("signed-in-content").textContent).toBe("Signed in content");
    expect(screen.queryByTestId("signed-out-content")).toBeNull();
  });

  it("SignedOut renders children when not signed in", async () => {
    const getSession = vi.fn().mockResolvedValue({ ok: false, error: "No session" });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <SignedIn>
          <span data-testid="signed-in-content">Signed in</span>
        </SignedIn>
        <SignedOut>
          <span data-testid="signed-out-content">Signed out</span>
        </SignedOut>
      </ClerkProvider>
    );

    await screen.findByTestId("signed-out-content");
    expect(screen.getByTestId("signed-out-content").textContent).toBe("Signed out");
    expect(screen.queryByTestId("signed-in-content")).toBeNull();
  });

  it("useUser returns user when signed in", async () => {
    const getSession = vi.fn().mockResolvedValue({
      ok: true,
      session: { sessionId: "s1", userId: "u1", orgId: null, expiresAt: null },
      user: { id: "u1", email: "user@test.com", name: "Test", firstName: null, lastName: null },
    });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <ShowUser />
      </ClerkProvider>
    );

    await screen.findByTestId("user");
    expect(screen.getByTestId("user").textContent).toBe("user@test.com");
  });

  it("useSession returns session when signed in", async () => {
    const getSession = vi.fn().mockResolvedValue({
      ok: true,
      session: { sessionId: "mysession", userId: "u1", orgId: null, expiresAt: null },
      user: { id: "u1", email: null, name: null, firstName: null, lastName: null },
    });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <ShowSession />
      </ClerkProvider>
    );

    await screen.findByTestId("session");
    expect(screen.getByTestId("session").textContent).toBe("mysession");
  });

  it("useAuth reflects loaded and signed-in state", async () => {
    const getSession = vi.fn().mockResolvedValue({
      ok: true,
      session: { sessionId: "s", userId: "u", orgId: null, expiresAt: null },
      user: { id: "u", email: null, name: null, firstName: null, lastName: null },
    });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <ShowAuth />
      </ClerkProvider>
    );

    await screen.findByTestId("auth");
    expect(screen.getByTestId("auth").textContent).toBe("in");
  });

  it("useAuth reflects signed-out state", async () => {
    const getSession = vi.fn().mockResolvedValue({ ok: false });

    render(
      <ClerkProvider publishableKey="pk_test" getSession={getSession}>
        <ShowAuth />
      </ClerkProvider>
    );

    await screen.findByTestId("auth");
    expect(screen.getByTestId("auth").textContent).toBe("out");
  });
});
