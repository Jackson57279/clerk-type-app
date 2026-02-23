import { describe, it, expect } from "vitest";
import {
  getEmailDomain,
  checkEmailDomain,
  createEmailDomainChecker,
} from "../src/email-domain-restriction.js";

const COMPANY_OPTIONS = { allowedDomain: "company.com" };

describe("getEmailDomain", () => {
  it("returns domain part of email", () => {
    expect(getEmailDomain("user@company.com")).toBe("company.com");
    expect(getEmailDomain("a@b.co")).toBe("b.co");
  });

  it("normalizes domain to lowercase", () => {
    expect(getEmailDomain("u@Company.COM")).toBe("company.com");
  });

  it("returns null when no @", () => {
    expect(getEmailDomain("nobody")).toBe(null);
    expect(getEmailDomain("")).toBe(null);
  });

  it("returns null when @ is last character", () => {
    expect(getEmailDomain("bad@")).toBe(null);
  });

  it("uses last @ for domain", () => {
    expect(getEmailDomain("user@name@company.com")).toBe("company.com");
  });
});

describe("checkEmailDomain", () => {
  it("allows email with allowed domain", () => {
    expect(checkEmailDomain("user@company.com", COMPANY_OPTIONS).allowed).toBe(
      true
    );
    expect(checkEmailDomain("admin@company.com", COMPANY_OPTIONS).allowed).toBe(
      true
    );
  });

  it("allows email when domain match is case-insensitive", () => {
    expect(checkEmailDomain("u@Company.COM", COMPANY_OPTIONS).allowed).toBe(
      true
    );
    expect(checkEmailDomain("u@COMPANY.COM", COMPANY_OPTIONS).allowed).toBe(
      true
    );
  });

  it("rejects email with different domain", () => {
    expect(checkEmailDomain("user@gmail.com", COMPANY_OPTIONS).allowed).toBe(
      false
    );
    expect(checkEmailDomain("user@other.com", COMPANY_OPTIONS).allowed).toBe(
      false
    );
  });

  it("rejects email with subdomain of allowed domain", () => {
    expect(
      checkEmailDomain("user@mail.company.com", COMPANY_OPTIONS).allowed
    ).toBe(false);
  });

  it("rejects invalid or empty email", () => {
    expect(checkEmailDomain("", COMPANY_OPTIONS).allowed).toBe(false);
    expect(checkEmailDomain("no-at-sign", COMPANY_OPTIONS).allowed).toBe(false);
    expect(checkEmailDomain("@company.com", COMPANY_OPTIONS).allowed).toBe(
      true
    );
  });

  it("normalizes allowedDomain option", () => {
    expect(
      checkEmailDomain("u@company.com", { allowedDomain: "Company.COM" })
        .allowed
    ).toBe(true);
  });
});

describe("createEmailDomainChecker", () => {
  it("returns true for allowed domain", () => {
    const isAllowed = createEmailDomainChecker(COMPANY_OPTIONS);
    expect(isAllowed("user@company.com")).toBe(true);
  });

  it("returns false for other domains", () => {
    const isAllowed = createEmailDomainChecker(COMPANY_OPTIONS);
    expect(isAllowed("user@gmail.com")).toBe(false);
    expect(isAllowed("invalid")).toBe(false);
  });
});
