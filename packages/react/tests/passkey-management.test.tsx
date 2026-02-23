import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClerkProvider, PasskeyManagement, usePasskeys } from "../src/index.js";

describe("usePasskeys", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty list and no error when apiUrl is null", async () => {
    function Show() {
      const { passkeys, loading, error } = usePasskeys();
      return (
        <span data-testid="out">
          {loading ? "loading" : `count=${passkeys.length} error=${error ?? "none"}`}
        </span>
      );
    }
    render(
      <ClerkProvider publishableKey="pk" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <Show />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("out").textContent).toContain("count=0");
    });
    expect(screen.getByTestId("out").textContent).toContain("error=none");
  });

  it("fetches passkeys when apiUrl is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ passkeys: [{ credentialId: "c1", friendlyName: "Laptop", deviceType: "singleDevice", lastUsedAt: "2025-01-01" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    function Show() {
      const { passkeys, loading } = usePasskeys({ apiUrl: "https://api.example.com" });
      if (loading) return <span data-testid="loading">loading</span>;
      return (
        <ul data-testid="list">
          {passkeys.map((p) => (
            <li key={p.credentialId}>{p.friendlyName ?? p.credentialId}</li>
          ))}
        </ul>
      );
    }
    render(
      <ClerkProvider publishableKey="pk" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <Show />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("list")).toBeDefined();
    });
    expect(screen.getByText("Laptop").textContent).toBe("Laptop");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/passkeys", { credentials: "include" });
  });

  it("revokePasskey calls DELETE and reloads list", async () => {
    let passkeys = [{ credentialId: "c1", friendlyName: "Key", deviceType: "singleDevice" }];
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("/passkeys/") && opts?.method === "DELETE") {
        passkeys = [];
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ revoked: true }) });
      }
      if (url === "https://api.example.com/passkeys") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ passkeys }) });
      }
      return Promise.reject(new Error("unexpected"));
    });
    vi.stubGlobal("fetch", fetchMock);

    function Show() {
      const { passkeys: list, loading, revokePasskey } = usePasskeys({ apiUrl: "https://api.example.com" });
      if (loading) return <span data-testid="loading">loading</span>;
      return (
        <div>
          {list.map((p) => (
            <button key={p.credentialId} onClick={() => void revokePasskey(p.credentialId)} data-testid="revoke">
              Revoke {p.credentialId}
            </button>
          ))}
        </div>
      );
    }
    render(
      <ClerkProvider publishableKey="pk" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <Show />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("revoke")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("revoke"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/passkeys/c1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

describe("PasskeyManagement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading then empty state when no passkeys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ passkeys: [] }) }));

    render(
      <ClerkProvider publishableKey="pk" apiUrl="https://api.example.com" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <PasskeyManagement />
      </ClerkProvider>
    );
    expect(screen.getByTestId("passkey-loading").textContent).toContain("Loading");
    await waitFor(() => {
      expect(screen.getByTestId("passkey-empty")).toBeDefined();
    });
    expect(screen.getByTestId("passkey-empty").textContent).toBe("No passkeys yet.");
    expect(screen.getByTestId("passkey-add").textContent).toBe("Add passkey");
  });

  it("shows list of passkeys with remove buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        passkeys: [
          { credentialId: "cred-1", friendlyName: "MacBook", deviceType: "singleDevice", lastUsedAt: "2025-02-01" },
          { credentialId: "cred-2", deviceType: "multiDevice", deviceInfo: "iPhone" },
        ],
      }),
    }));

    render(
      <ClerkProvider publishableKey="pk" apiUrl="https://api.example.com" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <PasskeyManagement />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("passkey-list")).toBeDefined();
    });
    expect(screen.getByTestId("passkey-name-cred-1").textContent).toContain("MacBook");
    expect(screen.getByTestId("passkey-name-cred-2").textContent).toContain("iPhone");
    expect(screen.getByTestId("passkey-revoke-cred-1").textContent).toBe("Remove");
    expect(screen.getByTestId("passkey-revoke-cred-2").textContent).toBe("Remove");
  });

  it("shows error when list request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("Unauthorized") }));

    render(
      <ClerkProvider publishableKey="pk" apiUrl="https://api.example.com" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <PasskeyManagement />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("passkey-error")).toBeDefined();
    });
    expect(screen.getByTestId("passkey-error").textContent).toContain("Unauthorized");
  });

  it("uses custom title and labels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ passkeys: [] }) }));

    render(
      <ClerkProvider publishableKey="pk" apiUrl="https://api.example.com" getSession={vi.fn().mockResolvedValue({ ok: false })}>
        <PasskeyManagement title="Security keys" addButtonLabel="Register key" emptyMessage="No keys." />
      </ClerkProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("passkey-empty")).toBeDefined();
    });
    expect(screen.getByRole("heading", { name: "Security keys" }).textContent).toBe("Security keys");
    expect(screen.getByTestId("passkey-add").textContent).toBe("Register key");
    expect(screen.getByTestId("passkey-empty").textContent).toBe("No keys.");
  });
});
