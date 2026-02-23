import { describe, it, expect } from "vitest";
import {
  getUserById,
  listUsers,
  type UserManagementStore,
  type ManagedUser,
  type ListUsersOptions,
} from "../src/user-management.js";

function memoryUserManagementStore(initial: ManagedUser[] = []): UserManagementStore {
  const users = new Map<string, ManagedUser>();
  const order: string[] = [];
  for (const u of initial) {
    users.set(u.id, u);
    order.push(u.id);
  }
  order.sort((a, b) => a.localeCompare(b));

  return {
    async findById(id: string) {
      return users.get(id) ?? null;
    },
    async listUsers(options: ListUsersOptions) {
      const { limit, cursor, search } = options;
      let list = [...order];
      if (cursor) {
        const idx = list.indexOf(cursor);
        list = idx === -1 ? list : list.slice(idx + 1);
      }
      const q = search?.trim().toLowerCase();
      if (q) {
        list = list.filter((id) => {
          const u = users.get(id);
          if (!u) return false;
          const email = (u.email ?? "").toLowerCase();
          const name = (u.name ?? "").toLowerCase();
          const first = (u.firstName ?? "").toLowerCase();
          const last = (u.lastName ?? "").toLowerCase();
          return (
            email.includes(q) || name.includes(q) || first.includes(q) || last.includes(q)
          );
        });
      }
      const page = list.slice(0, limit);
      const nextCursor =
        list.length > limit ? page[page.length - 1] : undefined;
      const resultUsers = page.map((id) => users.get(id)!).filter(Boolean);
      return {
        users: resultUsers,
        nextCursor,
      };
    },
  };
}

describe("getUserById", () => {
  it("returns user when found", async () => {
    const store = memoryUserManagementStore([
      {
        id: "u1",
        email: "a@example.com",
        name: "Alice",
        active: true,
      },
    ]);
    const user = await getUserById(store, "u1");
    expect(user).not.toBeNull();
    expect(user!.id).toBe("u1");
    expect(user!.email).toBe("a@example.com");
  });

  it("returns null when not found", async () => {
    const store = memoryUserManagementStore();
    const user = await getUserById(store, "none");
    expect(user).toBeNull();
  });
});

describe("listUsers", () => {
  it("returns users with limit and nextCursor", async () => {
    const store = memoryUserManagementStore([
      { id: "u1", email: "a@example.com", active: true },
      { id: "u2", email: "b@example.com", active: true },
      { id: "u3", email: "c@example.com", active: true },
    ]);
    const result = await listUsers(store, { limit: 2 });
    expect(result.users).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    const page2 = await listUsers(store, { limit: 2, cursor: result.nextCursor });
    expect(page2.users).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("filters by search when provided", async () => {
    const store = memoryUserManagementStore([
      { id: "u1", email: "alice@example.com", firstName: "Alice", active: true },
      { id: "u2", email: "bob@example.com", firstName: "Bob", active: true },
    ]);
    const result = await listUsers(store, { limit: 10, search: "alice" });
    expect(result.users).toHaveLength(1);
    const user = result.users[0];
    expect(user).toBeDefined();
    expect(user!.email).toBe("alice@example.com");
  });

  it("returns empty when no users", async () => {
    const store = memoryUserManagementStore();
    const result = await listUsers(store, { limit: 10 });
    expect(result.users).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });
});
