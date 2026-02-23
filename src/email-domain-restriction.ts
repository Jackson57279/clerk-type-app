export const DEFAULT_ALLOWED_EMAIL_DOMAIN = "company.com";

export function getDefaultAllowedDomain(): string {
  const env = process.env.ALLOWED_EMAIL_DOMAIN;
  return (env != null && env.trim() !== "" ? env.trim() : null) ?? DEFAULT_ALLOWED_EMAIL_DOMAIN;
}

export interface EmailDomainRestrictionOptions {
  allowedDomain: string;
}

export interface EmailDomainRestrictionResult {
  allowed: boolean;
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim();
}

export function getEmailDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at === -1 || at === trimmed.length - 1) return null;
  return normalizeDomain(trimmed.slice(at + 1));
}

export function checkEmailDomain(
  email: string,
  options: EmailDomainRestrictionOptions
): EmailDomainRestrictionResult {
  const domain = getEmailDomain(email);
  const allowed = normalizeDomain(options.allowedDomain);
  if (!domain) return { allowed: false };
  return { allowed: domain === allowed };
}

export function createEmailDomainChecker(options: EmailDomainRestrictionOptions) {
  const allowed = normalizeDomain(options.allowedDomain);
  return function isAllowedEmail(email: string): boolean {
    const domain = getEmailDomain(email);
    if (!domain) return false;
    return domain === allowed;
  };
}

export function createDefaultEmailDomainChecker(): (email: string) => boolean {
  return createEmailDomainChecker({ allowedDomain: getDefaultAllowedDomain() });
}
