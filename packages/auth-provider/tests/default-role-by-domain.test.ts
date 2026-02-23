import { describe, it, expect } from "vitest";
import {
  getDefaultRoleForEmail,
  createDefaultRoleResolver,
  type DefaultRoleByDomainOptions,
} from "../src/default-role-by-domain.js";

const baseOptions: DefaultRoleByDomainOptions = {
  defaultRole: "member",
  domainDefaultRoles: {
    "company.com": "admin",
    "contractor.com": "guest",
    "partner.co": "editor",
  },
};

describe("getDefaultRoleForEmail", () => {
  it("returns domain-specific role when email domain matches", () => {
    expect(
      getDefaultRoleForEmail("user@company.com", baseOptions)
    ).toBe("admin");
    expect(
      getDefaultRoleForEmail("admin@company.com", baseOptions)
    ).toBe("admin");
    expect(
      getDefaultRoleForEmail("bob@contractor.com", baseOptions)
    ).toBe("guest");
    expect(
      getDefaultRoleForEmail("alice@partner.co", baseOptions)
    ).toBe("editor");
  });

  it("matches domain case-insensitively", () => {
    expect(
      getDefaultRoleForEmail("u@Company.COM", baseOptions)
    ).toBe("admin");
    expect(
      getDefaultRoleForEmail("u@CONTRACTOR.COM", baseOptions)
    ).toBe("guest");
  });

  it("returns defaultRole when email domain is not in map", () => {
    expect(
      getDefaultRoleForEmail("user@gmail.com", baseOptions)
    ).toBe("member");
    expect(
      getDefaultRoleForEmail("user@other.com", baseOptions)
    ).toBe("member");
  });

  it("returns defaultRole when email has no valid domain", () => {
    expect(getDefaultRoleForEmail("", baseOptions)).toBe("member");
    expect(getDefaultRoleForEmail("no-at-sign", baseOptions)).toBe("member");
    expect(getDefaultRoleForEmail("bad@", baseOptions)).toBe("member");
  });

  it("returns defaultRole when domainDefaultRoles is empty", () => {
    expect(
      getDefaultRoleForEmail("user@company.com", {
        defaultRole: "member",
        domainDefaultRoles: {},
      })
    ).toBe("member");
  });

  it("returns defaultRole when domainDefaultRoles is undefined", () => {
    expect(
      getDefaultRoleForEmail("user@company.com", {
        defaultRole: "guest",
      })
    ).toBe("guest");
  });

  it("matches domainDefaultRoles keys case-insensitively", () => {
    expect(
      getDefaultRoleForEmail("u@company.com", {
        defaultRole: "member",
        domainDefaultRoles: { "Company.COM": "admin" },
      })
    ).toBe("admin");
  });

  it("uses defaultRole for each MemberRole type", () => {
    const roles = ["owner", "admin", "editor", "member", "guest"] as const;
    for (const role of roles) {
      expect(
        getDefaultRoleForEmail("user@unknown.com", {
          defaultRole: role,
          domainDefaultRoles: { "company.com": "admin" },
        })
      ).toBe(role);
    }
  });
});

describe("createDefaultRoleResolver", () => {
  it("returns same role as getDefaultRoleForEmail for same options", () => {
    const resolve = createDefaultRoleResolver(baseOptions);
    expect(resolve("user@company.com")).toBe("admin");
    expect(resolve("bob@contractor.com")).toBe("guest");
    expect(resolve("user@gmail.com")).toBe("member");
  });

  it("uses options from closure", () => {
    const resolve = createDefaultRoleResolver({
      defaultRole: "guest",
      domainDefaultRoles: { "internal.org": "owner" },
    });
    expect(resolve("a@internal.org")).toBe("owner");
    expect(resolve("a@external.com")).toBe("guest");
  });
});
