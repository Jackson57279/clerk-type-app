import { describe, it, expect } from "vitest";
import {
  normalizeHost,
  isValidCustomDomain,
  resolveOrganizationByHost,
  getAuthBaseUrl,
} from "../src/custom-domains.js";

describe("normalizeHost", () => {
  it("lowercases host", () => {
    expect(normalizeHost("AUTH.Customer.COM")).toBe("auth.customer.com");
  });

  it("strips port", () => {
    expect(normalizeHost("auth.customer.com:443")).toBe("auth.customer.com");
    expect(normalizeHost("auth.customer.com:3000")).toBe("auth.customer.com");
  });

  it("trims whitespace", () => {
    expect(normalizeHost("  auth.customer.com  ")).toBe("auth.customer.com");
  });
});

describe("isValidCustomDomain", () => {
  it("accepts auth.customer.com", () => {
    expect(isValidCustomDomain("auth.customer.com")).toBe(true);
  });

  it("accepts subdomains with multiple labels", () => {
    expect(isValidCustomDomain("auth.app.customer.com")).toBe(true);
  });

  it("rejects localhost", () => {
    expect(isValidCustomDomain("localhost")).toBe(false);
    expect(isValidCustomDomain("127.0.0.1")).toBe(false);
  });

  it("rejects single label without dot", () => {
    expect(isValidCustomDomain("auth")).toBe(false);
  });

  it("rejects empty or invalid labels", () => {
    expect(isValidCustomDomain(".customer.com")).toBe(false);
    expect(isValidCustomDomain("auth..customer.com")).toBe(false);
  });

  it("rejects labels that start or end with hyphen", () => {
    expect(isValidCustomDomain("auth-.customer.com")).toBe(false);
    expect(isValidCustomDomain("-auth.customer.com")).toBe(false);
  });

  it("accepts labels with internal hyphens", () => {
    expect(isValidCustomDomain("auth-service.customer.com")).toBe(true);
  });
});

describe("resolveOrganizationByHost", () => {
  it("returns org id when lookup finds domain", () => {
    const lookup = (domain: string) =>
      domain === "auth.customer.com" ? "org_123" : null;
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_123"
    );
    expect(resolveOrganizationByHost("AUTH.Customer.COM:443", lookup)).toBe(
      "org_123"
    );
  });

  it("returns null when lookup returns null", () => {
    const lookup = () => null;
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(null);
  });

  it("uses normalized host for lookup", () => {
    const lookup = (domain: string) =>
      domain === "auth.acme.com" ? "org_acme" : null;
    expect(resolveOrganizationByHost("auth.acme.com", lookup)).toBe("org_acme");
    expect(resolveOrganizationByHost("auth.other.com", lookup)).toBe(null);
  });
});

describe("getAuthBaseUrl", () => {
  it("returns https URL by default", () => {
    expect(getAuthBaseUrl("auth.customer.com")).toBe(
      "https://auth.customer.com"
    );
  });

  it("normalizes host (lowercase, no port)", () => {
    expect(getAuthBaseUrl("AUTH.Customer.COM:443")).toBe(
      "https://auth.customer.com"
    );
  });

  it("accepts custom protocol", () => {
    expect(
      getAuthBaseUrl("auth.customer.com", { protocol: "http" })
    ).toBe("http://auth.customer.com");
  });
});
