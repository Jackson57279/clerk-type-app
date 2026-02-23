import { describe, it, expect } from "vitest";
import {
  mergeBranding,
  brandingFromOrganization,
} from "../src/branding.js";

describe("mergeBranding", () => {
  it("returns defaults when given null", () => {
    const brand = mergeBranding(null);
    expect(brand.logoUrl).toBe("");
    expect(brand.primaryColor).toBe("#2563eb");
    expect(brand.secondaryColor).toBe("#64748b");
    expect(brand.companyName).toBe("Account");
    expect(brand.faviconUrl).toBe("");
  });

  it("returns defaults when given undefined", () => {
    const brand = mergeBranding(undefined);
    expect(brand.companyName).toBe("Account");
    expect(brand.primaryColor).toBe("#2563eb");
    expect(brand.faviconUrl).toBe("");
  });

  it("overrides with provided logoUrl and companyName", () => {
    const brand = mergeBranding({
      logoUrl: "https://example.com/logo.png",
      companyName: "Acme Inc",
    });
    expect(brand.logoUrl).toBe("https://example.com/logo.png");
    expect(brand.companyName).toBe("Acme Inc");
    expect(brand.primaryColor).toBe("#2563eb");
  });

  it("overrides colors when provided", () => {
    const brand = mergeBranding({
      primaryColor: "#dc2626",
      secondaryColor: "#1e293b",
    });
    expect(brand.primaryColor).toBe("#dc2626");
    expect(brand.secondaryColor).toBe("#1e293b");
  });

  it("overrides faviconUrl when provided", () => {
    const brand = mergeBranding({
      faviconUrl: "https://example.com/favicon.ico",
    });
    expect(brand.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("merges full overrides", () => {
    const brand = mergeBranding({
      logoUrl: "https://acme.com/logo.svg",
      primaryColor: "#0f766e",
      secondaryColor: "#0c4a6e",
      companyName: "Acme",
      faviconUrl: "https://acme.com/fav.ico",
    });
    expect(brand.logoUrl).toBe("https://acme.com/logo.svg");
    expect(brand.primaryColor).toBe("#0f766e");
    expect(brand.secondaryColor).toBe("#0c4a6e");
    expect(brand.companyName).toBe("Acme");
    expect(brand.faviconUrl).toBe("https://acme.com/fav.ico");
  });
});

describe("brandingFromOrganization", () => {
  it("returns null when given null", () => {
    expect(brandingFromOrganization(null)).toBeNull();
  });

  it("returns null when given undefined", () => {
    expect(brandingFromOrganization(undefined)).toBeNull();
  });

  it("returns null when row has no branding fields", () => {
    expect(brandingFromOrganization({})).toBeNull();
  });

  it("maps logo_url and primary_color to BrandingConfig", () => {
    const config = brandingFromOrganization({
      logo_url: "https://org.com/logo.png",
      primary_color: "#dc2626",
    });
    expect(config).toEqual({
      logoUrl: "https://org.com/logo.png",
      primaryColor: "#dc2626",
    });
  });

  it("maps name to companyName and favicon_url to faviconUrl", () => {
    const config = brandingFromOrganization({
      name: "My Org",
      favicon_url: "https://org.com/favicon.ico",
    });
    expect(config).toEqual({
      companyName: "My Org",
      faviconUrl: "https://org.com/favicon.ico",
    });
  });

  it("maps secondary_color to secondaryColor", () => {
    const config = brandingFromOrganization({
      secondary_color: "#1e293b",
    });
    expect(config).toEqual({ secondaryColor: "#1e293b" });
  });

  it("maps all branding fields including secondary_color", () => {
    const config = brandingFromOrganization({
      logo_url: "https://org.com/logo.png",
      primary_color: "#dc2626",
      secondary_color: "#64748b",
      favicon_url: "https://org.com/fav.ico",
      name: "Org Name",
    });
    expect(config).toEqual({
      logoUrl: "https://org.com/logo.png",
      primaryColor: "#dc2626",
      secondaryColor: "#64748b",
      faviconUrl: "https://org.com/fav.ico",
      companyName: "Org Name",
    });
  });

  it("trims and omits empty strings", () => {
    const config = brandingFromOrganization({
      logo_url: "  https://x.com/l  ",
      name: "",
      primary_color: null,
    });
    expect(config).toEqual({ logoUrl: "https://x.com/l" });
  });
});
