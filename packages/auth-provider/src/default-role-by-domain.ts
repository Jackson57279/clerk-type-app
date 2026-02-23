import { getEmailDomain } from "./email-domain-restriction.js";
import type { MemberRole } from "./member-approval.js";

export interface DefaultRoleByDomainOptions {
  defaultRole: MemberRole;
  domainDefaultRoles?: Record<string, MemberRole>;
}

function normalizeDomainKey(domain: string): string {
  return domain.toLowerCase().trim();
}

export function getDefaultRoleForEmail(
  email: string,
  options: DefaultRoleByDomainOptions
): MemberRole {
  const domain = getEmailDomain(email);
  const domainDefaultRoles = options.domainDefaultRoles;
  if (!domain || !domainDefaultRoles || Object.keys(domainDefaultRoles).length === 0) {
    return options.defaultRole;
  }
  for (const [key, role] of Object.entries(domainDefaultRoles)) {
    if (normalizeDomainKey(key) === domain) return role;
  }
  return options.defaultRole;
}

export function createDefaultRoleResolver(options: DefaultRoleByDomainOptions) {
  return function resolveDefaultRole(email: string): MemberRole {
    return getDefaultRoleForEmail(email, options);
  };
}
