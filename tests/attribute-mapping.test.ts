import { describe, it, expect } from "vitest";
import {
  applyAttributeMapping,
  type AttributeMappingConfig,
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
});
