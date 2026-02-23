import { describe, it, expect } from "vitest";
import { mergeBranding } from "../src/branding.js";

describe("mergeBranding", () => {
  it("returns defaults when given null", () => {
    const brand = mergeBranding(null);
    expect(brand.logoUrl).toBe("");
    expect(brand.primaryColor).toBe("#2563eb");
    expect(brand.secondaryColor).toBe("#64748b");
    expect(brand.companyName).toBe("Account");
  });

  it("returns defaults when given undefined", () => {
    const brand = mergeBranding(undefined);
    expect(brand.companyName).toBe("Account");
    expect(brand.primaryColor).toBe("#2563eb");
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

  it("merges full overrides", () => {
    const brand = mergeBranding({
      logoUrl: "https://acme.com/logo.svg",
      primaryColor: "#0f766e",
      secondaryColor: "#0c4a6e",
      companyName: "Acme",
    });
    expect(brand.logoUrl).toBe("https://acme.com/logo.svg");
    expect(brand.primaryColor).toBe("#0f766e");
    expect(brand.secondaryColor).toBe("#0c4a6e");
    expect(brand.companyName).toBe("Acme");
  });
});
