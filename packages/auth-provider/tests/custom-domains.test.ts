import { describe, it, expect } from "vitest";
import {
  AUTH_SUBDOMAIN,
  normalizeHost,
  isValidCustomDomain,
  getSuggestedAuthHost,
  resolveOrganizationByHost,
  getAuthBaseUrl,
  createDomainLookup,
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

describe("getSuggestedAuthHost", () => {
  it("returns auth.customer.com for customer.com", () => {
    expect(getSuggestedAuthHost("customer.com")).toBe("auth.customer.com");
  });

  it("normalizes root domain (lowercase, trim)", () => {
    expect(getSuggestedAuthHost("  Customer.COM  ")).toBe("auth.customer.com");
  });

  it("strips leading/trailing dots from root", () => {
    expect(getSuggestedAuthHost(".customer.com.")).toBe("auth.customer.com");
  });

  it("returns empty string for empty root", () => {
    expect(getSuggestedAuthHost("")).toBe("");
    expect(getSuggestedAuthHost("   ")).toBe("");
  });

  it("works with multi-label roots", () => {
    expect(getSuggestedAuthHost("app.customer.co.uk")).toBe(
      "auth.app.customer.co.uk"
    );
  });
});

describe("AUTH_SUBDOMAIN", () => {
  it("is auth", () => {
    expect(AUTH_SUBDOMAIN).toBe("auth");
  });
});

describe("auth.customer.com flow", () => {
  it("validates host, resolves org, and builds base URL", () => {
    const host = "auth.customer.com";
    expect(isValidCustomDomain(host)).toBe(true);
    const lookup = (d: string) => (d === "auth.customer.com" ? "org_123" : null);
    expect(resolveOrganizationByHost(host, lookup)).toBe("org_123");
    expect(getAuthBaseUrl(host)).toBe("https://auth.customer.com");
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

describe("createDomainLookup", () => {
  it("returns org id for auth.customer.com when org has that custom domain", () => {
    const orgs = [
      { id: "org_123", customDomains: ["auth.customer.com"] },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_123"
    );
  });

  it("normalizes domains when building lookup", () => {
    const orgs = [
      { id: "org_abc", customDomains: ["AUTH.Customer.COM"] },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_abc"
    );
  });

  it("returns null for host not in any org custom domains", () => {
    const orgs = [
      { id: "org_123", customDomains: ["auth.customer.com"] },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.other.com", lookup)).toBe(null);
  });

  it("skips invalid custom domains", () => {
    const orgs = [
      {
        id: "org_1",
        customDomains: ["auth.customer.com", "localhost", "singlelabel"],
      },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_1"
    );
    expect(lookup("localhost")).toBe(null);
    expect(lookup("singlelabel")).toBe(null);
  });

  it("first org wins when multiple orgs claim same domain", () => {
    const orgs = [
      { id: "org_first", customDomains: ["auth.customer.com"] },
      { id: "org_second", customDomains: ["auth.customer.com"] },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_first"
    );
  });

  it("returns empty lookup when organizations array is empty", () => {
    const lookup = createDomainLookup([]);
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(null);
  });

  it("supports multiple orgs with different domains", () => {
    const orgs = [
      { id: "org_a", customDomains: ["auth.acme.com"] },
      { id: "org_b", customDomains: ["auth.customer.com", "auth.other.com"] },
    ];
    const lookup = createDomainLookup(orgs);
    expect(resolveOrganizationByHost("auth.acme.com", lookup)).toBe("org_a");
    expect(resolveOrganizationByHost("auth.customer.com", lookup)).toBe(
      "org_b"
    );
    expect(resolveOrganizationByHost("auth.other.com", lookup)).toBe("org_b");
  });
});
