import { describe, it, expect, afterEach } from "vitest";
import {
  getEmailDomain,
  checkEmailDomain,
  createEmailDomainChecker,
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  getDefaultAllowedDomain,
  createDefaultEmailDomainChecker,
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

describe("DEFAULT_ALLOWED_EMAIL_DOMAIN", () => {
  it("is company.com", () => {
    expect(DEFAULT_ALLOWED_EMAIL_DOMAIN).toBe("company.com");
  });
});

describe("getDefaultAllowedDomain", () => {
  const orig = process.env.ALLOWED_EMAIL_DOMAIN;

  afterEach(() => {
    if (orig !== undefined) process.env.ALLOWED_EMAIL_DOMAIN = orig;
    else delete process.env.ALLOWED_EMAIL_DOMAIN;
  });

  it("returns company.com when ALLOWED_EMAIL_DOMAIN is unset", () => {
    delete process.env.ALLOWED_EMAIL_DOMAIN;
    expect(getDefaultAllowedDomain()).toBe("company.com");
  });

  it("returns company.com when ALLOWED_EMAIL_DOMAIN is empty", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "";
    expect(getDefaultAllowedDomain()).toBe("company.com");
  });

  it("returns env value when ALLOWED_EMAIL_DOMAIN is set", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "example.org";
    expect(getDefaultAllowedDomain()).toBe("example.org");
  });
});

describe("domain restriction: only @company.com emails", () => {
  it("allows @company.com and rejects all other domains", () => {
    const result = checkEmailDomain("user@company.com", COMPANY_OPTIONS);
    expect(result.allowed).toBe(true);
    expect(checkEmailDomain("user@gmail.com", COMPANY_OPTIONS).allowed).toBe(false);
    expect(checkEmailDomain("user@mail.company.com", COMPANY_OPTIONS).allowed).toBe(false);
    expect(checkEmailDomain("invalid", COMPANY_OPTIONS).allowed).toBe(false);
  });

  it("rejects non-company domains regardless of casing", () => {
    const emails = ["user@Gmail.com", "test@OTHER.com", "admin@Sub.Company.com"];
    for (const email of emails) {
      expect(checkEmailDomain(email, COMPANY_OPTIONS).allowed).toBe(false);
    }
  });
});

describe("createDefaultEmailDomainChecker", () => {
  const orig = process.env.ALLOWED_EMAIL_DOMAIN;

  afterEach(() => {
    if (orig !== undefined) process.env.ALLOWED_EMAIL_DOMAIN = orig;
    else delete process.env.ALLOWED_EMAIL_DOMAIN;
  });

  it("allows only @company.com emails by default", () => {
    delete process.env.ALLOWED_EMAIL_DOMAIN;
    const isAllowed = createDefaultEmailDomainChecker();
    expect(isAllowed("user@company.com")).toBe(true);
    expect(isAllowed("admin@company.com")).toBe(true);
    expect(isAllowed("u@Company.COM")).toBe(true);
    expect(isAllowed("user@gmail.com")).toBe(false);
    expect(isAllowed("user@other.com")).toBe(false);
    expect(isAllowed("invalid")).toBe(false);
  });

  it("respects ALLOWED_EMAIL_DOMAIN when set", () => {
    process.env.ALLOWED_EMAIL_DOMAIN = "example.org";
    const isAllowed = createDefaultEmailDomainChecker();
    expect(isAllowed("user@example.org")).toBe(true);
    expect(isAllowed("user@company.com")).toBe(false);
  });
});
