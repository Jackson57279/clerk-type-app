import { describe, it, expect } from "vitest";
import {
  provisionUser,
  deactivateUser,
  deleteUser,
  deprovisionUser,
  type UserProvisioningStore,
  type ProvisionedUser,
  type ProvisionUserData,
} from "../src/user-provisioning.js";

function memoryStore(initial: ProvisionedUser[] = []): UserProvisioningStore {
  const users = new Map<string, ProvisionedUser>();
  const byEmail = new Map<string, string>();
  const byExternalId = new Map<string, string>();

  function index(u: ProvisionedUser) {
    users.set(u.id, u);
    if (u.active) byEmail.set(u.email.toLowerCase(), u.id);
    if (u.externalId) byExternalId.set(u.externalId, u.id);
  }

  for (const u of initial) index(u);

  return {
    async findById(id: string) {
      return users.get(id) ?? null;
    },
    async findByEmail(email: string) {
      const id = byEmail.get(email.toLowerCase());
      return id ? users.get(id) ?? null : null;
    },
    async findByExternalId(externalId: string) {
      const id = byExternalId.get(externalId);
      return id ? users.get(id) ?? null : null;
    },
    async create(data: ProvisionUserData): Promise<ProvisionedUser> {
      const id = `user_${users.size + 1}`;
      const user: ProvisionedUser = {
        id,
        email: data.email,
        externalId: data.externalId,
        name: data.name,
        firstName: data.firstName,
        lastName: data.lastName,
        active: data.active ?? true,
      };
      index(user);
      return user;
    },
    async update(id: string, data: Partial<ProvisionUserData>): Promise<ProvisionedUser> {
      const existing = users.get(id);
      if (!existing) throw new Error("User not found");
      const user: ProvisionedUser = {
        ...existing,
        ...data,
        email: data.email ?? existing.email,
        externalId: data.externalId !== undefined ? data.externalId : existing.externalId,
        active: data.active !== undefined ? data.active : existing.active,
      };
      byEmail.delete(existing.email.toLowerCase());
      if (existing.externalId) byExternalId.delete(existing.externalId);
      index(user);
      return user;
    },
    async softDelete(id: string) {
      const u = users.get(id);
      if (!u) return;
      const deactivated: ProvisionedUser = { ...u, active: false };
      users.set(id, deactivated);
      byEmail.delete(u.email.toLowerCase());
      if (u.externalId) byExternalId.delete(u.externalId);
    },
    async hardDelete(id: string) {
      const u = users.get(id);
      if (u) {
        byEmail.delete(u.email.toLowerCase());
        if (u.externalId) byExternalId.delete(u.externalId);
      }
      users.delete(id);
    },
  };
}

describe("provisionUser", () => {
  it("creates a new user when none exists", async () => {
    const store = memoryStore();
    const result = await provisionUser(store, {
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
    });
    expect(result.created).toBe(true);
    expect(result.user.email).toBe("new@example.com");
    expect(result.user.firstName).toBe("New");
    expect(result.user.lastName).toBe("User");
    expect(result.user.active).toBe(true);
  });

  it("updates existing user when matched by email", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "existing@example.com",
        externalId: undefined,
        name: "Old",
        firstName: "Old",
        lastName: "Name",
        active: true,
      },
    ]);
    const result = await provisionUser(store, {
      email: "existing@example.com",
      firstName: "Updated",
      lastName: "Name",
    });
    expect(result.created).toBe(false);
    expect(result.user.id).toBe("user_1");
    expect(result.user.firstName).toBe("Updated");
  });

  it("updates existing user when matched by externalId", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "scim@example.com",
        externalId: "scim-123",
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    const result = await provisionUser(store, {
      email: "scim@example.com",
      externalId: "scim-123",
      name: "SCIM User",
    });
    expect(result.created).toBe(false);
    expect(result.user.name).toBe("SCIM User");
  });

  it("reactivates deactivated user when reactivateIfDeactivated is true", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "deactivated@example.com",
        externalId: "ext-1",
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: false,
      },
    ]);
    const result = await provisionUser(
      store,
      { email: "deactivated@example.com", externalId: "ext-1" },
      { reactivateIfDeactivated: true }
    );
    expect(result.created).toBe(false);
    expect(result.user.active).toBe(true);
  });

  it("does not reactivate deactivated user when reactivateIfDeactivated is false", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "deactivated@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: false,
      },
    ]);
    const result = await provisionUser(
      store,
      { email: "other@example.com", firstName: "New" },
      { reactivateIfDeactivated: false }
    );
    expect(result.created).toBe(true);
    expect(result.user.email).toBe("other@example.com");
  });

  it("creates user with active false when data.active is false", async () => {
    const store = memoryStore();
    const result = await provisionUser(store, {
      email: "inactive@example.com",
      active: false,
    });
    expect(result.created).toBe(true);
    expect(result.user.active).toBe(false);
  });

  it("updates existing user and can set active to false", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "active@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    const result = await provisionUser(store, {
      email: "active@example.com",
      active: false,
    });
    expect(result.created).toBe(false);
    expect(result.user.active).toBe(false);
  });

  it("prefers externalId match over email when both exist", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "first@example.com",
        externalId: "ext-1",
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
      {
        id: "user_2",
        email: "second@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    const result = await provisionUser(store, {
      email: "second@example.com",
      externalId: "ext-1",
      name: "Matched by externalId",
    });
    expect(result.created).toBe(false);
    expect(result.user.id).toBe("user_1");
    expect(result.user.name).toBe("Matched by externalId");
  });
});

describe("deprovisionUser", () => {
  it("soft-deletes user by default", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "soft@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deprovisionUser(store, "user_1");
    const found = await store.findById("user_1");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
  });

  it("hard-deletes user when options.hard is true", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "hard@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deprovisionUser(store, "user_1", { hard: true });
    const found = await store.findById("user_1");
    expect(found).toBeNull();
  });

  it("is no-op when user does not exist", async () => {
    const store = memoryStore();
    await expect(deprovisionUser(store, "nonexistent")).resolves.toBeUndefined();
  });

  it("soft-deleted user is not findable by email", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "gone@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deprovisionUser(store, "user_1");
    const byEmail = await store.findByEmail("gone@example.com");
    expect(byEmail).toBeNull();
  });

  it("calling deprovision twice is idempotent (soft delete)", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "twice@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deprovisionUser(store, "user_1");
    await expect(deprovisionUser(store, "user_1")).resolves.toBeUndefined();
    const found = await store.findById("user_1");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
  });
});

describe("deactivateUser", () => {
  it("soft-deletes (deactivates) user", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "deact@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deactivateUser(store, "user_1");
    const found = await store.findById("user_1");
    expect(found).not.toBeNull();
    expect(found?.active).toBe(false);
  });

  it("is no-op when user does not exist", async () => {
    const store = memoryStore();
    await expect(deactivateUser(store, "nonexistent")).resolves.toBeUndefined();
  });
});

describe("deleteUser", () => {
  it("hard-deletes user", async () => {
    const store = memoryStore([
      {
        id: "user_1",
        email: "del@example.com",
        externalId: undefined,
        name: undefined,
        firstName: undefined,
        lastName: undefined,
        active: true,
      },
    ]);
    await deleteUser(store, "user_1");
    const found = await store.findById("user_1");
    expect(found).toBeNull();
  });

  it("is no-op when user does not exist", async () => {
    const store = memoryStore();
    await expect(deleteUser(store, "nonexistent")).resolves.toBeUndefined();
  });
});
