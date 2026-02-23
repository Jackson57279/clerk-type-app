import { mergeBranding, type BrandingConfig } from "./branding.js";

export interface PasswordResetEmailParams {
  resetLink: string;
  expiresInMinutes: number;
}

export interface DoubleOptInEmailParams {
  confirmationLink: string;
  operation: string;
  expiresInMinutes: number;
}

export interface MagicLinkEmailParams {
  magicLink: string;
  expiresInMinutes: number;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

function replaceAll(
  template: string,
  vars: Record<string, string | number>
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
  }
  return out;
}

function defaultHead(brand: ReturnType<typeof mergeBranding>): string {
  const faviconLink =
    brand.faviconUrl !== ""
      ? `<link rel="icon" href="${brand.faviconUrl}" />`
      : "";
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${faviconLink}`;
}

function defaultPasswordResetHtml(brand: ReturnType<typeof mergeBranding>): string {
  const logoBlock =
    brand.logoUrl !== ""
      ? `<img src="${brand.logoUrl}" alt="${brand.companyName}" style="max-width:180px;height:auto;display:block;margin-bottom:24px;" />`
      : "";
  return `<!DOCTYPE html>
<html>
<head>${defaultHead(brand)}</head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#334155;max-width:480px;margin:0 auto;padding:24px;">
  ${logoBlock}
  <h1 style="color:${brand.primaryColor};font-size:1.5rem;margin:0 0 16px;">Reset your password</h1>
  <p style="margin:0 0 16px;">Click the link below to reset your password. This link expires in {{expiresInMinutes}} minutes.</p>
  <p style="margin:0 0 24px;"><a href="{{resetLink}}" style="color:${brand.primaryColor};font-weight:600;">Reset password</a></p>
  <p style="font-size:0.875rem;color:${brand.secondaryColor};">If you didn't request this, you can ignore this email.</p>
</body>
</html>`;
}

function defaultPasswordResetText(): string {
  return `Reset your password\n\nClick the link below (or copy and paste into your browser). This link expires in {{expiresInMinutes}} minutes.\n\n{{resetLink}}\n\nIf you didn't request this, you can ignore this email.`;
}

function defaultDoubleOptInHtml(brand: ReturnType<typeof mergeBranding>): string {
  const logoBlock =
    brand.logoUrl !== ""
      ? `<img src="${brand.logoUrl}" alt="${brand.companyName}" style="max-width:180px;height:auto;display:block;margin-bottom:24px;" />`
      : "";
  return `<!DOCTYPE html>
<html>
<head>${defaultHead(brand)}</head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#334155;max-width:480px;margin:0 auto;padding:24px;">
  ${logoBlock}
  <h1 style="color:${brand.primaryColor};font-size:1.5rem;margin:0 0 16px;">Confirm your request</h1>
  <p style="margin:0 0 16px;">You requested: {{operation}}. Click the link below to confirm. This link expires in {{expiresInMinutes}} minutes.</p>
  <p style="margin:0 0 24px;"><a href="{{confirmationLink}}" style="color:${brand.primaryColor};font-weight:600;">Confirm</a></p>
  <p style="font-size:0.875rem;color:${brand.secondaryColor};">If you didn't request this, you can ignore this email.</p>
</body>
</html>`;
}

function defaultDoubleOptInText(): string {
  return `Confirm your request\n\nYou requested: {{operation}}. Click the link below to confirm. This link expires in {{expiresInMinutes}} minutes.\n\n{{confirmationLink}}\n\nIf you didn't request this, you can ignore this email.`;
}

function defaultMagicLinkHtml(brand: ReturnType<typeof mergeBranding>): string {
  const logoBlock =
    brand.logoUrl !== ""
      ? `<img src="${brand.logoUrl}" alt="${brand.companyName}" style="max-width:180px;height:auto;display:block;margin-bottom:24px;" />`
      : "";
  return `<!DOCTYPE html>
<html>
<head>${defaultHead(brand)}</head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;color:#334155;max-width:480px;margin:0 auto;padding:24px;">
  ${logoBlock}
  <h1 style="color:${brand.primaryColor};font-size:1.5rem;margin:0 0 16px;">Sign in to ${brand.companyName}</h1>
  <p style="margin:0 0 16px;">Click the link below to sign in. This link expires in {{expiresInMinutes}} minutes.</p>
  <p style="margin:0 0 24px;"><a href="{{magicLink}}" style="color:${brand.primaryColor};font-weight:600;">Sign in</a></p>
  <p style="font-size:0.875rem;color:${brand.secondaryColor};">If you didn't request this, you can ignore this email.</p>
</body>
</html>`;
}

function defaultMagicLinkText(): string {
  return `Sign in\n\nClick the link below (or copy and paste into your browser). This link expires in {{expiresInMinutes}} minutes.\n\n{{magicLink}}\n\nIf you didn't request this, you can ignore this email.`;
}

export interface RenderPasswordResetEmailOptions {
  branding?: BrandingConfig | null;
  htmlTemplate?: string;
  textTemplate?: string;
}

export function renderPasswordResetEmail(
  params: PasswordResetEmailParams,
  options: RenderPasswordResetEmailOptions = {}
): RenderedEmail {
  const brand = mergeBranding(options.branding);
  const htmlTemplate =
    options.htmlTemplate ?? defaultPasswordResetHtml(brand);
  const textTemplate = options.textTemplate ?? defaultPasswordResetText();
  const vars = {
    resetLink: params.resetLink,
    expiresInMinutes: params.expiresInMinutes,
    companyName: brand.companyName,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    faviconUrl: brand.faviconUrl,
  };
  return {
    html: replaceAll(htmlTemplate, vars),
    text: replaceAll(textTemplate, vars),
  };
}

export interface RenderDoubleOptInEmailOptions {
  branding?: BrandingConfig | null;
  htmlTemplate?: string;
  textTemplate?: string;
}

export function renderDoubleOptInEmail(
  params: DoubleOptInEmailParams,
  options: RenderDoubleOptInEmailOptions = {}
): RenderedEmail {
  const brand = mergeBranding(options.branding);
  const htmlTemplate =
    options.htmlTemplate ?? defaultDoubleOptInHtml(brand);
  const textTemplate = options.textTemplate ?? defaultDoubleOptInText();
  const vars = {
    confirmationLink: params.confirmationLink,
    operation: params.operation,
    expiresInMinutes: params.expiresInMinutes,
    companyName: brand.companyName,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    faviconUrl: brand.faviconUrl,
  };
  return {
    html: replaceAll(htmlTemplate, vars),
    text: replaceAll(textTemplate, vars),
  };
}

export interface RenderMagicLinkEmailOptions {
  branding?: BrandingConfig | null;
  htmlTemplate?: string;
  textTemplate?: string;
}

export function renderMagicLinkEmail(
  params: MagicLinkEmailParams,
  options: RenderMagicLinkEmailOptions = {}
): RenderedEmail {
  const brand = mergeBranding(options.branding);
  const htmlTemplate =
    options.htmlTemplate ?? defaultMagicLinkHtml(brand);
  const textTemplate = options.textTemplate ?? defaultMagicLinkText();
  const vars = {
    magicLink: params.magicLink,
    expiresInMinutes: params.expiresInMinutes,
    companyName: brand.companyName,
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    faviconUrl: brand.faviconUrl,
  };
  return {
    html: replaceAll(htmlTemplate, vars),
    text: replaceAll(textTemplate, vars),
  };
}
