import { describe, it, expect, vi } from "vitest";
import { mergeBranding, brandingFromOrganization, type BrandingConfig } from "../src/branding.js";
import {
  renderPasswordResetEmail,
  renderDoubleOptInEmail,
  renderMagicLinkEmail,
  renderEmailVerificationEmail,
  EMAIL_TEMPLATE_PLACEHOLDERS,
} from "../src/email-templates.js";
import { requestSensitiveOperation } from "../src/sensitive-operations-flow.js";
import { requestPasswordReset } from "../src/password-reset-flow.js";

const SECRET = "test-secret";
const branding: BrandingConfig = {
  logoUrl: "https://cdn.example.com/logo.png",
  primaryColor: "#059669",
  secondaryColor: "#475569",
  companyName: "Acme",
  faviconUrl: "https://cdn.example.com/fav.ico",
};

describe("Custom Branding: logo, colors, email templates", () => {
  describe("logo", () => {
    it("mergeBranding applies logoUrl", () => {
      const brand = mergeBranding(branding);
      expect(brand.logoUrl).toBe("https://cdn.example.com/logo.png");
    });

    it("logo appears in password reset email", () => {
      const { html } = renderPasswordResetEmail(
        { resetLink: "https://x.com/r", expiresInMinutes: 15 },
        { branding }
      );
      expect(html).toContain("https://cdn.example.com/logo.png");
    });

    it("logo appears in double-opt-in email", () => {
      const { html } = renderDoubleOptInEmail(
        { confirmationLink: "https://x.com/c", operation: "change email", expiresInMinutes: 15 },
        { branding }
      );
      expect(html).toContain("https://cdn.example.com/logo.png");
    });

    it("logo appears in magic link email", () => {
      const { html } = renderMagicLinkEmail(
        { magicLink: "https://x.com/l", expiresInMinutes: 10 },
        { branding }
      );
      expect(html).toContain("https://cdn.example.com/logo.png");
    });

    it("logo appears in email verification email", () => {
      const { html } = renderEmailVerificationEmail(
        { verificationLink: "https://x.com/v", expiresInMinutes: 10 },
        { branding }
      );
      expect(html).toContain("https://cdn.example.com/logo.png");
    });
  });

  describe("colors", () => {
    it("mergeBranding applies primaryColor and secondaryColor", () => {
      const brand = mergeBranding(branding);
      expect(brand.primaryColor).toBe("#059669");
      expect(brand.secondaryColor).toBe("#475569");
    });

    it("primary color appears in all default email templates", () => {
      const r1 = renderPasswordResetEmail(
        { resetLink: "https://r.com", expiresInMinutes: 5 },
        { branding }
      );
      const r2 = renderDoubleOptInEmail(
        { confirmationLink: "https://c.com", operation: "confirm", expiresInMinutes: 5 },
        { branding }
      );
      const r3 = renderMagicLinkEmail(
        { magicLink: "https://l.com", expiresInMinutes: 5 },
        { branding }
      );
      const r4 = renderEmailVerificationEmail(
        { verificationLink: "https://v.com", expiresInMinutes: 5 },
        { branding }
      );
      expect(r1.html).toContain("#059669");
      expect(r2.html).toContain("#059669");
      expect(r3.html).toContain("#059669");
      expect(r4.html).toContain("#059669");
    });
  });

  describe("email templates", () => {
    it("custom htmlTemplate and textTemplate replace placeholders", () => {
      const { html, text } = renderPasswordResetEmail(
        { resetLink: "https://go.com", expiresInMinutes: 10 },
        {
          branding,
          htmlTemplate: "{{companyName}} {{primaryColor}} {{resetLink}} {{expiresInMinutes}}",
          textTemplate: "{{companyName}} {{resetLink}}",
        }
      );
      expect(html).toContain("Acme");
      expect(html).toContain("#059669");
      expect(html).toContain("https://go.com");
      expect(html).toContain("10");
      expect(text).toContain("Acme");
      expect(text).toContain("https://go.com");
    });

    it("sensitive operation email uses branding when sendEmail provided", async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined);
      await requestSensitiveOperation({
        operation: "change_password",
        userId: "u1",
        email: "u@example.com",
        secret: SECRET,
        buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
        sendEmail,
        branding,
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const payload = sendEmail.mock.calls[0]?.[0];
      expect(payload?.html).toContain("https://cdn.example.com/logo.png");
      expect(payload?.html).toContain("#059669");
    });

    it("password reset email uses branding when sendEmail provided", async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined);
      await requestPasswordReset({
        email: "u@example.com",
        secret: SECRET,
        findUserByEmail: async () => ({ userId: "u1", email: "u@example.com" }),
        buildResetLink: (t) => `https://app.example.com/reset?token=${t}`,
        sendEmail,
        branding,
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const payload = sendEmail.mock.calls[0]?.[0];
      expect(payload?.html).toContain("https://cdn.example.com/logo.png");
      expect(payload?.html).toContain("#059669");
    });
  });

  describe("brandingFromOrganization", () => {
    it("maps tenant/org row to BrandingConfig", () => {
      const config = brandingFromOrganization({
        logo_url: "https://org.com/logo.png",
        primary_color: "#dc2626",
        secondary_color: "#1e293b",
        favicon_url: "https://org.com/fav.ico",
        name: "My Org",
      });
      expect(config).toEqual({
        logoUrl: "https://org.com/logo.png",
        primaryColor: "#dc2626",
        secondaryColor: "#1e293b",
        faviconUrl: "https://org.com/fav.ico",
        companyName: "My Org",
      });
    });
  });

  describe("EMAIL_TEMPLATE_PLACEHOLDERS", () => {
    it("exposes branding placeholders for all template types", () => {
      for (const key of ["passwordReset", "doubleOptIn", "magicLink", "emailVerification"] as const) {
        const placeholders = EMAIL_TEMPLATE_PLACEHOLDERS[key];
        expect(placeholders).toContain("logoUrl");
        expect(placeholders).toContain("primaryColor");
        expect(placeholders).toContain("companyName");
      }
    });
  });
});
