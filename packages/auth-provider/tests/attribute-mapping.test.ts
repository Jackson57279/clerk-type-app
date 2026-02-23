import { describe, it, expect } from "vitest";
import {
  applyAttributeMapping,
  DEFAULT_ATTRIBUTE_MAPPING,
  mapScimUserToProvisionData,
  DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING,
  type AttributeMappingConfig,
  type ScimUserAttributeMappingConfig,
} from "../src/attribute-mapping.js";

const EMAIL_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";
const NAME_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const GIVEN_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname";
const SURNAME_ATTR = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname";

function config(overrides: Partial<AttributeMappingConfig> = {}): AttributeMappingConfig {
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

describe("applyAttributeMapping", () => {
  it("extracts email, name, first name, last name from attributes", () => {
    const attrs: Record<string, string[]> = {
      [EMAIL_ATTR]: ["jane@example.com"],
      [NAME_ATTR]: ["Jane Doe"],
      [GIVEN_ATTR]: ["Jane"],
      [SURNAME_ATTR]: ["Doe"],
    };
    const claims = applyAttributeMapping(attrs, config());
    expect(claims.email).toBe("jane@example.com");
    expect(claims.name).toBe("Jane Doe");
    expect(claims.firstName).toBe("Jane");
    expect(claims.lastName).toBe("Doe");
  });

  it("extracts name when only nameAttribute is configured", () => {
    const attrs: Record<string, string[]> = { displayName: ["Alice Smith"] };
    const claims = applyAttributeMapping(attrs, { nameAttribute: "displayName" });
    expect(claims.name).toBe("Alice Smith");
    expect(claims.email).toBeUndefined();
  });

  it("extracts multi-valued groups and roles", () => {
    const attrs: Record<string, string[]> = {
      groups: ["engineering", "admin"],
      roles: ["developer", "viewer"],
    };
    const claims = applyAttributeMapping(attrs, config());
    expect(claims.groups).toEqual(["engineering", "admin"]);
    expect(claims.roles).toEqual(["developer", "viewer"]);
  });

  it("returns undefined and empty arrays for missing mapped attributes", () => {
    const claims = applyAttributeMapping({}, config());
    expect(claims.email).toBeUndefined();
    expect(claims.name).toBeUndefined();
    expect(claims.firstName).toBeUndefined();
    expect(claims.lastName).toBeUndefined();
    expect(claims.groups).toEqual([]);
    expect(claims.roles).toEqual([]);
  });

  it("uses only configured attribute names", () => {
    const attrs: Record<string, string[]> = {
      [EMAIL_ATTR]: ["a@b.com"],
      other: ["ignored"],
    };
    const claims = applyAttributeMapping(attrs, { emailAttribute: EMAIL_ATTR });
    expect(claims.email).toBe("a@b.com");
    expect(claims.firstName).toBeUndefined();
    expect(claims.groups).toEqual([]);
  });

  it("trims whitespace from single values", () => {
    const attrs: Record<string, string[]> = {
      [EMAIL_ATTR]: ["  user@example.com  "],
      [NAME_ATTR]: ["  Bob  "],
    };
    const claims = applyAttributeMapping(attrs, config());
    expect(claims.email).toBe("user@example.com");
    expect(claims.name).toBe("Bob");
  });

  it("filters empty strings from multi-valued attributes", () => {
    const attrs: Record<string, string[]> = {
      groups: ["a", "  ", "", "b"],
    };
    const claims = applyAttributeMapping(attrs, { groupsAttribute: "groups" });
    expect(claims.groups).toEqual(["a", "b"]);
  });

  it("filters empty strings from roles attribute", () => {
    const attrs: Record<string, string[]> = {
      roles: ["admin", "", "  ", "viewer"],
    };
    const claims = applyAttributeMapping(attrs, { rolesAttribute: "roles" });
    expect(claims.roles).toEqual(["admin", "viewer"]);
  });

  it("returns first value for single-value attributes when multiple present", () => {
    const attrs: Record<string, string[]> = {
      [EMAIL_ATTR]: ["first@example.com", "second@example.com"],
    };
    const claims = applyAttributeMapping(attrs, { emailAttribute: EMAIL_ATTR });
    expect(claims.email).toBe("first@example.com");
  });

  it("maps SAML AttributeStatement-style email, name, groups, roles", () => {
    const attrs: Record<string, string[]> = {
      email: ["user@company.com"],
      name: ["User Name"],
      groups: ["engineering", "admin"],
      roles: ["developer"],
    };
    const mapping: AttributeMappingConfig = {
      emailAttribute: "email",
      nameAttribute: "name",
      groupsAttribute: "groups",
      rolesAttribute: "roles",
    };
    const claims = applyAttributeMapping(attrs, mapping);
    expect(claims.email).toBe("user@company.com");
    expect(claims.name).toBe("User Name");
    expect(claims.groups).toEqual(["engineering", "admin"]);
    expect(claims.roles).toEqual(["developer"]);
  });

  it("returns all undefined and empty arrays with empty config", () => {
    const attrs: Record<string, string[]> = {
      email: ["a@b.com"],
      name: ["Bob"],
    };
    const claims = applyAttributeMapping(attrs, {});
    expect(claims.email).toBeUndefined();
    expect(claims.name).toBeUndefined();
    expect(claims.firstName).toBeUndefined();
    expect(claims.lastName).toBeUndefined();
    expect(claims.groups).toEqual([]);
    expect(claims.roles).toEqual([]);
  });

  it("DEFAULT_ATTRIBUTE_MAPPING maps standard attribute names", () => {
    const attrs: Record<string, string[]> = {
      email: ["u@example.com"],
      name: ["Full Name"],
      givenName: ["Given"],
      surname: ["Surname"],
      groups: ["g1", "g2"],
      roles: ["r1"],
    };
    const claims = applyAttributeMapping(attrs, DEFAULT_ATTRIBUTE_MAPPING);
    expect(claims.email).toBe("u@example.com");
    expect(claims.name).toBe("Full Name");
    expect(claims.firstName).toBe("Given");
    expect(claims.lastName).toBe("Surname");
    expect(claims.groups).toEqual(["g1", "g2"]);
    expect(claims.roles).toEqual(["r1"]);
  });
});

describe("mapScimUserToProvisionData", () => {
  it("maps standard SCIM user to provision data using default config", () => {
    const scimUser = {
      userName: "jane@example.com",
      emails: [{ value: "jane@example.com", primary: true }],
      name: { formatted: "Jane Doe", givenName: "Jane", familyName: "Doe" },
      externalId: "ext-123",
      active: true,
    };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.email).toBe("jane@example.com");
    expect(result.name).toBe("Jane Doe");
    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");
    expect(result.externalId).toBe("ext-123");
    expect(result.active).toBe(true);
  });

  it("uses primary email when emails array has multiple", () => {
    const scimUser = {
      emails: [
        { value: "secondary@example.com", primary: false },
        { value: "primary@example.com", primary: true },
      ],
    };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.email).toBe("primary@example.com");
  });

  it("falls back to userName when emails missing", () => {
    const scimUser = { userName: "login@example.com" };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.email).toBe("login@example.com");
  });

  it("uses custom emailPath to take email from userName", () => {
    const scimUser = {
      userName: "user@corp.com",
      emails: [{ value: "other@corp.com" }],
    };
    const config: ScimUserAttributeMappingConfig = { emailPath: "userName" };
    const result = mapScimUserToProvisionData(scimUser, config);
    expect(result.email).toBe("user@corp.com");
  });

  it("uses custom paths for name fields", () => {
    const scimUser = {
      name: { formatted: "Ignore", givenName: "First", familyName: "Last" },
    };
    const config: ScimUserAttributeMappingConfig = {
      namePath: "name.formatted",
      givenNamePath: "name.givenName",
      familyNamePath: "name.familyName",
    };
    const result = mapScimUserToProvisionData(scimUser, config);
    expect(result.name).toBe("Ignore");
    expect(result.firstName).toBe("First");
    expect(result.lastName).toBe("Last");
  });

  it("derives name from givenName and familyName when namePath empty", () => {
    const scimUser = {
      emails: [{ value: "a@b.com" }],
      name: { givenName: "Alice", familyName: "Smith" },
    };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.name).toBe("Alice Smith");
  });

  it("defaults active to true when missing", () => {
    const scimUser = { userName: "u@example.com" };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.active).toBe(true);
  });

  it("respects active false from SCIM user", () => {
    const scimUser = { userName: "u@example.com", active: false };
    const result = mapScimUserToProvisionData(scimUser);
    expect(result.active).toBe(false);
  });

  it("DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING has expected paths", () => {
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.emailPath).toBe("emails");
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.namePath).toBe("name.formatted");
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.givenNamePath).toBe("name.givenName");
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.familyNamePath).toBe("name.familyName");
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.externalIdPath).toBe("externalId");
    expect(DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING.activePath).toBe("active");
  });
});
