import { describe, it, expect } from "vitest";
import {
  renderPasswordResetEmail,
  renderDoubleOptInEmail,
} from "../src/email-templates.js";

describe("renderPasswordResetEmail", () => {
  it("renders html and text with placeholders replaced", () => {
    const result = renderPasswordResetEmail({
      resetLink: "https://app.example.com/reset?token=abc",
      expiresInMinutes: 60,
    });
    expect(result.html).toContain("https://app.example.com/reset?token=abc");
    expect(result.html).toContain("60");
    expect(result.html).not.toContain("{{resetLink}}");
    expect(result.html).not.toContain("{{expiresInMinutes}}");
    expect(result.text).toContain("https://app.example.com/reset?token=abc");
    expect(result.text).toContain("60");
    expect(result.text).not.toContain("{{resetLink}}");
  });

  it("uses default branding when not provided", () => {
    const result = renderPasswordResetEmail({
      resetLink: "https://x.com/r",
      expiresInMinutes: 15,
    });
    expect(result.html).toContain("#2563eb");
    expect(result.html).toContain("Reset your password");
  });

  it("injects branding colors and company name in default template", () => {
    const result = renderPasswordResetEmail(
      { resetLink: "https://x.com/r", expiresInMinutes: 30 },
      {
        branding: {
          primaryColor: "#dc2626",
          secondaryColor: "#1e293b",
          companyName: "MyApp",
        },
      }
    );
    expect(result.html).toContain("#dc2626");
    expect(result.html).toContain("#1e293b");
  });

  it("injects logo when branding has logoUrl", () => {
    const result = renderPasswordResetEmail(
      { resetLink: "https://x.com/r", expiresInMinutes: 15 },
      { branding: { logoUrl: "https://cdn.example.com/logo.png" } }
    );
    expect(result.html).toContain("https://cdn.example.com/logo.png");
  });

  it("uses custom html and text templates when provided", () => {
    const result = renderPasswordResetEmail(
      { resetLink: "https://go.com", expiresInMinutes: 10 },
      {
        htmlTemplate: "<p>Reset: {{resetLink}} in {{expiresInMinutes}} min</p>",
        textTemplate: "Reset: {{resetLink}} in {{expiresInMinutes}} min",
      }
    );
    expect(result.html).toBe(
      "<p>Reset: https://go.com in 10 min</p>"
    );
    expect(result.text).toBe("Reset: https://go.com in 10 min");
  });

  it("replaces branding placeholders in custom template", () => {
    const result = renderPasswordResetEmail(
      { resetLink: "https://r.com", expiresInMinutes: 5 },
      {
        branding: { companyName: "BrandCo", primaryColor: "#000" },
        htmlTemplate: "{{companyName}} {{primaryColor}} {{resetLink}}",
      }
    );
    expect(result.html).toContain("BrandCo");
    expect(result.html).toContain("#000");
    expect(result.html).toContain("https://r.com");
  });
});

describe("renderDoubleOptInEmail", () => {
  it("renders html and text with placeholders replaced", () => {
    const result = renderDoubleOptInEmail({
      confirmationLink: "https://app.example.com/confirm?t=xyz",
      operation: "change email address",
      expiresInMinutes: 15,
    });
    expect(result.html).toContain("https://app.example.com/confirm?t=xyz");
    expect(result.html).toContain("change email address");
    expect(result.html).toContain("15");
    expect(result.html).not.toContain("{{confirmationLink}}");
    expect(result.text).toContain("https://app.example.com/confirm?t=xyz");
    expect(result.text).toContain("change email address");
  });

  it("uses default branding when not provided", () => {
    const result = renderDoubleOptInEmail({
      confirmationLink: "https://x.com/c",
      operation: "disable MFA",
      expiresInMinutes: 15,
    });
    expect(result.html).toContain("#2563eb");
    expect(result.html).toContain("Confirm your request");
  });

  it("uses custom templates when provided", () => {
    const result = renderDoubleOptInEmail(
      {
        confirmationLink: "https://confirm.com",
        operation: "delete account",
        expiresInMinutes: 20,
      },
      {
        htmlTemplate:
          "Confirm {{operation}}: {{confirmationLink}} ({{expiresInMinutes}} min)",
        textTemplate:
          "Confirm {{operation}}: {{confirmationLink}} ({{expiresInMinutes}} min)",
      }
    );
    expect(result.html).toBe(
      "Confirm delete account: https://confirm.com (20 min)"
    );
    expect(result.text).toBe(
      "Confirm delete account: https://confirm.com (20 min)"
    );
  });
});
