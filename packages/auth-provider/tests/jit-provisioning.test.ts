import { describe, it, expect } from "vitest";
import {
  extractMappedClaims,
  getOrProvisionUser,
  handleSpInitiatedAssertWithJit,
  type JitAttributeMapping,
  type JitUserStore,
  type JitUser,
  type JitProvisionUserData,
} from "../src/jit-provisioning.js";
import type { SpInitiatedAssertionResult, SpInitiatedIdpConfig, SpInitiatedSpConfig } from "../src/sp-initiated-sso.js";
import { createIdpInitiatedResponse } from "../src/idp-initiated-sso.js";

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

const TEST_SP_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBX9ZAnn+hUzzM
UEqE4QGRhTZosYfH0Qy7FKOfKRBcM7QUVD1kurOkJfJgO+WgBHaOPiVchPED4uRf
n1m506FpCMOxO2BperPhEnEjEGBygi6uJjxzzB7WbKRaMDaflWsfPEklKNUypaVT
VSBopvCUOUkYt6dGg+lAIrvVsUObPsR5w8IL0Irt0muAjpeTUI5Ata9i64SZyUEI
sNIbJ9ZxoINeYxGgwmWvLj8NRLR7/LJqGaY028EQVY17cy7JGCEcmC0I76kfv0AH
dF2XGr9C3U8EEeqG4PwsEoL+6hv1jerduVSCBkAyFJFTAYSw5gofEEaU78dWFrpk
lluA9pNpAgMBAAECggEAfi4XFBtYlOBHr9pEheh8qYQPOMl/HDeg4wJYsiaNclya
iRle5jeduOK6AWmUMJI4+iA7KN/mlO6crnjAh608idkaOK/R/YH/lkH+aS7qgE3K
QADbOYRcKvbBV8hWHFPXjo47/G9kjqPf+Tx25VLpcQ7gT6ynDjBNJ3iCsLH2t3lf
M3rgdeRqauRrCvHb8zJzLgOFd+d5UZWGzcQxfSlRTkReBul2QPEK+GE3tLVVWWCg
sC51teOHnPq6l0ymgFou6Z48e2QXXGc7I7ebYWIwjBQlHwhwT32q1uNB/xXyOHmh
jJ5z7N8ZJk0mrtDZ8N3ClhMUdVH8+nm5G79WVonTwQKBgQDjaMR8B98s3QPOFoWG
3JK5xBw4dV2z7cTPr/qakA12E5vslqKjab51NQ1kzU7GyRWhNthv4iHM8KyerLH2
GgZfYM4cve9uW5KOZKRPrBkvou3XBe/FFikRk19EvTL6BXqhnxyYYdOC6LfppGI9
8PbEGq0Z1BF0fbadw3Pmxvi5xQKBgQDZr6WTESfLHfXHJ6EmI3yvM3RBrUdojRY7
WpwGcn6MkqnuFuTqkqJ1UUbB7wsDFvuBEXLvd3mgmWJYLditVvhhCxbqbPO2rj/B
1FC34FdMQLl2981ucz6qwTolaUwjBlhtoMnL+03hoJTG7lf2ZxlfbJZzXawMa0m/
1RHHChyhVQKBgQDEPSJhDcHuywJ/kzvCtxD+sVbQ+abUn/fYaTnOq0SSgjVpokvS
zGuIZTGbrPev3tKFffikA/W7Dm1HuCsR/j9FixoR/21gRDFiI0MPZamOTAEGLp9L
6eWivxPVE5er3ZKHafCZJsIJE52xRyNn5Epty79YrIIrjlhKJ+IaYdU9KQKBgAaC
okkLskz40GjsXn1tgkUbHNb5/7C4x3lu9EudEPvTRxG/zYjWadVoYN1b8NBe15a8
lttij1imPbK1bE2C1FrSohTQvVkxTObXGrLlGrdFGEbekl5DRBSHQt3rkENb5Tki
Hebj1ShyTQDGEAtmefPIo5c/re2RJ9t829NAEishAoGAGOW5CPq7Q0tEvOVE+/br
JXddPyZe++FB1e7i+iVYrA5F8wtvhVHsVsSxpm47XdAyAFdLdnttrnwzt3EA+QvB
tsprKkdbwhTwaVKRDwnIAfwwpvONAV+/6X5W0UDJEmevDQZR8x74nBHWezdDv+lk
Ig9R0ZWbG6k7TkdrLwTbs1c=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIJAO8HJfrb3JZeMA0GCSqGSIb3DQEBBQUAMCMxITAfBgNV
BAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0xNDAzMTgwMTE3MTdaFw0y
NDAzMTcwMTE3MTdaMCMxITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0
ZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMFf1kCef6FTPMxQSoTh
AZGFNmixh8fRDLsUo58pEFwztBRUPWS6s6Ql8mA75aAEdo4+JVyE8QPi5F+fWbnT
oWkIw7E7YGl6s+EScSMQYHKCLq4mPHPMHtZspFowNp+Vax88SSUo1TKlpVNVIGi
m8JQ5SRi3p0aD6UAiu9WxQ5s+xHnDwgvQiu3Sa4COl5NQjkC1r2LrhJnJQQiw0hs
n1nGgg15jEaDCZa8uPw1EtHv8smoZpjTbwRBVjXtzLskYIRyYLQjvqR+/QAd0XZc
av0LdTwQR6obg/CwSgv7qG/WN6t25VIIGQDIUkVMBhLDmCh8QRpTvx1YWumSWW4D
2k2kCAwEAAaNQME4wHQYDVR0OBBYEFLpo8Vz1m19xvPmzx+2wf2PaSTIpMB8GA1Ud
IwQYMBaAFLpo8Vz1m19xvPmzx+2wf2PaSTIpMAwGA1UdEwQFMAMBAf8wDQYJKoZI
hvcNAQEFBQADggEBALhwpLS6C+97nWrEICI5yetQjexCJGltMESg1llNYjsbIuJ/
S4XbrVzhN4nfNGMSbj8rb/9FT6TSru5QLjJQQmj38pqsWtEhR2vBLclqGqEcJfvP
Mdn1qAJhJfhrs0KUpsX6xFTnSkNoyGxCP8Wh2C1L0NL5r+x58lkma5vL6ncwWYY+
0C3bt1XbBRdeOZHUwuYTIcD+BCNixQiNor7KjO1TzpOb6V3m1SKHu8idDM5fUcKo
oGbV3WuE7AJrAG5fvt59V9MtMPc2FklVFminfTeYKboEaxZJxuPDbQs2IyJ/0lI8
P0Mv4LIKj4+OipQ/fGbZuE7cOioPKKl02dE7eCA=
-----END CERTIFICATE-----`;

function spConfigForAssert(overrides: Partial<SpInitiatedSpConfig> = {}): SpInitiatedSpConfig {
  return {
    entityId: "https://sp.example.com/metadata.xml",
    privateKey: TEST_SP_KEY,
    certificate: TEST_CERT,
    assertEndpoint: "https://sp.example.com/assert",
    allowUnencryptedAssertion: true,
    ...overrides,
  };
}

function idpConfigForAssert(overrides: Partial<SpInitiatedIdpConfig> = {}): SpInitiatedIdpConfig {
  return {
    ssoLoginUrl: "https://idp.example.com/sso/login",
    ssoLogoutUrl: "https://idp.example.com/sso/logout",
    certificates: TEST_CERT,
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
      { organizationId: "org1", isAllowedEmail: () => true }
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
      { organizationId: "org1", isAllowedEmail: () => true }
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
      { organizationId: "org1", isAllowedEmail: () => true }
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
      { organizationId: "org1", isAllowedEmail: () => true }
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
        { organizationId: "org1", jitEnabled: false, isAllowedEmail: () => true }
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
        { organizationId: "org1", isAllowedEmail: () => true }
      )
    ).rejects.toThrow("Cannot JIT provision");
  });

  it("provisions separate user per organization for same email", async () => {
    const store = memoryStore();
    const first = await getOrProvisionUser(
      assertion({
        nameId: "user@example.com",
        attributes: { [EMAIL_ATTR]: ["user@example.com"] },
      }),
      mapping(),
      store,
      { organizationId: "org1", isAllowedEmail: () => true }
    );
    expect(first.created).toBe(true);
    const second = await getOrProvisionUser(
      assertion({
        nameId: "user@example.com",
        attributes: { [EMAIL_ATTR]: ["user@example.com"] },
      }),
      mapping(),
      store,
      { organizationId: "org2", isAllowedEmail: () => true }
    );
    expect(second.created).toBe(true);
    expect(second.user.id).not.toBe(first.user.id);
    expect(second.user.email).toBe(first.user.email);
  });

  it("throws when JIT provisioning with email domain not allowed (default @company.com)", async () => {
    const store = memoryStore();
    await expect(
      getOrProvisionUser(
        assertion({
          nameId: "user@gmail.com",
          attributes: { [EMAIL_ATTR]: ["user@gmail.com"] },
        }),
        mapping(),
        store,
        { organizationId: "org1" }
      )
    ).rejects.toThrow("Email domain not allowed");
  });

  it("provisions new user when email is @company.com (default allowed domain)", async () => {
    const store = memoryStore();
    const result = await getOrProvisionUser(
      assertion({
        nameId: "user@company.com",
        attributes: { [EMAIL_ATTR]: ["user@company.com"], [NAME_ATTR]: ["Company User"] },
      }),
      mapping(),
      store,
      { organizationId: "org1" }
    );
    expect(result.created).toBe(true);
    expect(result.user.email).toBe("user@company.com");
  });
});

describe("handleSpInitiatedAssertWithJit", () => {
  it("returns 200 and provisions new user when valid SAML and JIT enabled", async () => {
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      {
        nameId: "newuser@example.com",
        sessionIndex: "sess_1",
        attributes: {
          [EMAIL_ATTR]: ["newuser@example.com"],
          [NAME_ATTR]: ["New User"],
          [GIVEN_ATTR]: ["New"],
          [SURNAME_ATTR]: ["User"],
        },
      }
    );
    const store = memoryStore();
    const result = await handleSpInitiatedAssertWithJit(
      { SAMLResponse: idpResponse.samlResponseBase64 },
      {
        spConfig: spConfigForAssert(),
        idpConfig: idpConfigForAssert(),
        requireSessionIndex: true,
        mapping: mapping(),
        store,
        organizationId: "org1",
        isAllowedEmail: () => true,
      }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.created).toBe(true);
      expect(result.user.email).toBe("newuser@example.com");
      expect(result.user.name).toBe("New User");
      expect(result.user.firstName).toBe("New");
      expect(result.user.lastName).toBe("User");
    }
  });

  it("returns 200 and existing user when found by nameId", async () => {
    const existing: JitUser = {
      id: "user_1",
      email: "existing@example.com",
      samlNameId: "existing@example.com",
    };
    const store = memoryStore([existing]);
    const idpResponse = await createIdpInitiatedResponse(
      { entityId: "https://idp.example.com/metadata", privateKey: TEST_SP_KEY, certificate: TEST_CERT },
      { entityId: "https://sp.example.com/metadata.xml", assertEndpoint: "https://sp.example.com/assert" },
      { nameId: "existing@example.com", sessionIndex: "sess_1" }
    );
    const result = await handleSpInitiatedAssertWithJit(
      { SAMLResponse: idpResponse.samlResponseBase64 },
      {
        spConfig: spConfigForAssert(),
        idpConfig: idpConfigForAssert(),
        requireSessionIndex: true,
        mapping: mapping(),
        store,
        organizationId: "org1",
        isAllowedEmail: () => true,
      }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.created).toBe(false);
      expect(result.user.id).toBe("user_1");
      expect(result.user.email).toBe("existing@example.com");
    }
  });

  it("returns 400 when SAMLResponse is missing", async () => {
    const store = memoryStore();
    const result = await handleSpInitiatedAssertWithJit(
      { SAMLResponse: "" },
      {
        spConfig: spConfigForAssert(),
        idpConfig: idpConfigForAssert(),
        mapping: mapping(),
        store,
        organizationId: "org1",
        isAllowedEmail: () => true,
      }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.errorDescription).toContain("SAMLResponse");
    }
  });

  it("returns 400 when SAMLResponse is invalid", async () => {
    const store = memoryStore();
    const result = await handleSpInitiatedAssertWithJit(
      { SAMLResponse: "not-valid-base64!!!" },
      {
        spConfig: spConfigForAssert(),
        idpConfig: idpConfigForAssert(),
        mapping: mapping(),
        store,
        organizationId: "org1",
        isAllowedEmail: () => true,
      }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.error).toBe("invalid_request");
    }
  });

  it("returns 400 when JIT disabled and no user found", async () => {
    const idpResponse = await createIdpInitiatedResponse(
      { entityId: "https://idp.example.com/metadata", privateKey: TEST_SP_KEY, certificate: TEST_CERT },
      { entityId: "https://sp.example.com/metadata.xml", assertEndpoint: "https://sp.example.com/assert" },
      { nameId: "unknown@example.com", sessionIndex: "sess_1" }
    );
    const store = memoryStore();
    const result = await handleSpInitiatedAssertWithJit(
      { SAMLResponse: idpResponse.samlResponseBase64 },
      {
        spConfig: spConfigForAssert(),
        idpConfig: idpConfigForAssert(),
        requireSessionIndex: true,
        mapping: mapping(),
        store,
        organizationId: "org1",
        jitEnabled: false,
        isAllowedEmail: () => true,
      }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.errorDescription).toContain("JIT provisioning is disabled");
    }
  });
});
