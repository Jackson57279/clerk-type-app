import { describe, it, expect } from "vitest";
import {
  extractMappedClaims,
  getOrProvisionUser,
  type JitAttributeMapping,
  type JitUserStore,
  type JitUser,
  type JitProvisionUserData,
} from "../src/jit-provisioning.js";
import type { SpInitiatedAssertionResult } from "../src/sp-initiated-sso.js";

const EMAIL_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";
const NAME_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const GIVEN_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname";
const SURNAME_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname";

function assertion(overrides: Partial<SpInitiatedAssertionResult> = {}): SpInitiatedAssertionResult {
  return {
    nameId: "user@example.com",
    sessionIndex: "sess_1",
    attributes: {},
    inResponseTo: "req_1",
    relayState: undefined,
    ...overrides,
  };
}

function mapping(overrides: Partial<JitAttributeMapping> = {}): JitAttributeMapping {
  return {
    emailAttribute: EMAIL_ATTR,
    nameAttribute: NAME_ATTR,
    givenNameAttribute: GIVEN_ATTR,
    surnameAttribute: SURNAME_ATTR,
    groupsAttribute: "groups",
    rolesAttribute: "roles",
    ...overrides,
  };
}

describe("extractMappedClaims", () => {
  it("extracts email, name, first name, last name from assertion attributes", () => {
    const a = assertion({
      attributes: {
        [EMAIL_ATTR]: ["jane@example.com"],
        [NAME_ATTR]: ["Jane Doe"],
        [GIVEN_ATTR]: ["Jane"],
        [SURNAME_ATTR]: ["Doe"],
      },
    });
    const claims = extractMappedClaims(a, mapping());
    expect(claims.email).toBe("jane@example.com");
    expect(claims.name).toBe("Jane Doe");
    expect(claims.firstName).toBe("Jane");
    expect(claims.lastName).toBe("Doe");
  });

  it("extracts name (single full-name attribute) when configured", () => {
    const a = assertion({
      attributes: {
        displayName: ["Alice Smith"],
      },
    });
    const claims = extractMappedClaims(a, { nameAttribute: "displayName" });
    expect(claims.name).toBe("Alice Smith");
    expect(claims.email).toBeUndefined();
  });

  it("extracts multi-valued groups and roles", () => {
    const a = assertion({
      attributes: {
        groups: ["engineering", "admin"],
        roles: ["developer", "viewer"],
      },
    });
    const claims = extractMappedClaims(a, mapping());
    expect(claims.groups).toEqual(["engineering", "admin"]);
    expect(claims.roles).toEqual(["developer", "viewer"]);
  });

  it("returns undefined for missing mapped attributes", () => {
    const a = assertion({ attributes: {} });
    const claims = extractMappedClaims(a, mapping());
    expect(claims.email).toBeUndefined();
    expect(claims.name).toBeUndefined();
    expect(claims.firstName).toBeUndefined();
    expect(claims.lastName).toBeUndefined();
    expect(claims.groups).toEqual([]);
    expect(claims.roles).toEqual([]);
  });

  it("uses only configured attribute names", () => {
    const a = assertion({
      attributes: {
        [EMAIL_ATTR]: ["a@b.com"],
        other: ["ignored"],
      },
    });
    const claims = extractMappedClaims(a, {
      emailAttribute: EMAIL_ATTR,
    });
    expect(claims.email).toBe("a@b.com");
    expect(claims.firstName).toBeUndefined();
    expect(claims.groups).toEqual([]);
  });
});

function memoryStore(initialUsers: JitUser[] = []): JitUserStore {
  const users = new Map<string, JitUser>();
  const byOrgNameId = new Map<string, string>();
  const byOrgEmail = new Map<string, string>();
  for (const u of initialUsers) {
    users.set(u.id, u);
    if (u.samlNameId) byOrgNameId.set(`org1:${u.samlNameId}`, u.id);
    byOrgEmail.set(`org1:${u.email}`, u.id);
  }
  return {
    async findBySamlNameId(organizationId: string, nameId: string): Promise<JitUser | null> {
      const id = byOrgNameId.get(`${organizationId}:${nameId}`);
      return id ? users.get(id) ?? null : null;
    },
    async findByEmail(organizationId: string, email: string): Promise<JitUser | null> {
      const id = byOrgEmail.get(`${organizationId}:${email}`);
      return id ? users.get(id) ?? null : null;
    },
    async createUser(organizationId: string, data: JitProvisionUserData): Promise<JitUser> {
      const id = `user_${users.size + 1}`;
      const user: JitUser = {
        id,
        email: data.email,
        samlNameId: data.samlNameId,
        name: data.name,
        firstName: data.firstName,
        lastName: data.lastName,
        groups: data.groups,
        roles: data.roles,
      };
      users.set(id, user);
      byOrgNameId.set(`${organizationId}:${data.samlNameId}`, id);
      byOrgEmail.set(`${organizationId}:${data.email}`, id);
      return user;
    },
  };
}

describe("getOrProvisionUser", () => {
  it("returns existing user when found by nameId", async () => {
    const existing: JitUser = {
      id: "user_1",
      email: "existing@example.com",
      samlNameId: "user@example.com",
    };
    const store = memoryStore([existing]);
    const result = await getOrProvisionUser(
      assertion({ nameId: "user@example.com" }),
      mapping(),
      store,
      { organizationId: "org1" }
    );
    expect(result.user.id).toBe("user_1");
    expect(result.created).toBe(false);
  });

  it("returns existing user when found by email", async () => {
    const existing: JitUser = {
      id: "user_1",
      email: "match@example.com",
    };
    const store = memoryStore([existing]);
    const result = await getOrProvisionUser(
      assertion({
        nameId: "different-name-id",
        attributes: { [EMAIL_ATTR]: ["match@example.com"] },
      }),
      mapping(),
      store,
      { organizationId: "org1" }
    );
    expect(result.user.id).toBe("user_1");
    expect(result.created).toBe(false);
  });

  it("provisions new user when not found and JIT enabled", async () => {
    const store = memoryStore();
    const result = await getOrProvisionUser(
      assertion({
        nameId: "newuser@example.com",
        attributes: {
          [EMAIL_ATTR]: ["newuser@example.com"],
          [NAME_ATTR]: ["New User"],
          [GIVEN_ATTR]: ["New"],
          [SURNAME_ATTR]: ["User"],
          groups: ["eng"],
          roles: ["viewer"],
        },
      }),
      mapping(),
      store,
      { organizationId: "org1" }
    );
    expect(result.created).toBe(true);
    expect(result.user.email).toBe("newuser@example.com");
    expect(result.user.samlNameId).toBe("newuser@example.com");
    expect(result.user.name).toBe("New User");
    expect(result.user.firstName).toBe("New");
    expect(result.user.lastName).toBe("User");
    expect(result.user.groups).toEqual(["eng"]);
    expect(result.user.roles).toEqual(["viewer"]);
  });

  it("uses nameId as email fallback when email attribute missing", async () => {
    const store = memoryStore();
    const result = await getOrProvisionUser(
      assertion({
        nameId: "fallback@example.com",
        attributes: {},
      }),
      mapping(),
      store,
      { organizationId: "org1" }
    );
    expect(result.created).toBe(true);
    expect(result.user.email).toBe("fallback@example.com");
  });

  it("throws when JIT disabled and no user found", async () => {
    const store = memoryStore();
    await expect(
      getOrProvisionUser(
        assertion({ nameId: "unknown@example.com", attributes: {} }),
        mapping(),
        store,
        { organizationId: "org1", jitEnabled: false }
      )
    ).rejects.toThrow("JIT provisioning is disabled");
  });

  it("throws when JIT enabled but no email and nameId not usable", async () => {
    const store = memoryStore();
    await expect(
      getOrProvisionUser(
        assertion({ nameId: "not-an-email", attributes: {} }),
        mapping(),
        store,
        { organizationId: "org1" }
      )
    ).rejects.toThrow("Cannot JIT provision");
  });
});
