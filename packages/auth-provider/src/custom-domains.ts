export const AUTH_SUBDOMAIN = "auth";

export function normalizeHost(host: string): string {
  const withoutPort = host.includes(":") ? host.slice(0, host.indexOf(":")) : host;
  return withoutPort.toLowerCase().trim();
}

export function getSuggestedAuthHost(rootDomain: string): string {
  const normalized = normalizeHost(rootDomain).replace(/^\.|\.$/g, "");
  if (!normalized) return "";
  return `${AUTH_SUBDOMAIN}.${normalized}`;
}

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

export function isValidCustomDomain(domain: string): boolean {
  const normalized = normalizeHost(domain);
  if (LOCALHOST.test(normalized)) return false;
  if (!normalized.includes(".")) return false;
  const labels = normalized.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!LABEL.test(label)) return false;
  }
  return true;
}

export type DomainLookup = (normalizedDomain: string) => string | null;

export interface OrganizationWithCustomDomains {
  id: string;
  customDomains: string[];
}

export function createDomainLookup(
  organizations: OrganizationWithCustomDomains[]
): DomainLookup {
  const map = new Map<string, string>();
  for (const org of organizations) {
    for (const domain of org.customDomains) {
      const normalized = normalizeHost(domain);
      if (isValidCustomDomain(normalized) && !map.has(normalized)) {
        map.set(normalized, org.id);
      }
    }
  }
  return (normalizedDomain: string) => map.get(normalizedDomain) ?? null;
}

export function resolveOrganizationByHost(
  host: string,
  lookup: DomainLookup
): string | null {
  const normalized = normalizeHost(host);
  return lookup(normalized);
}

export interface GetAuthBaseUrlOptions {
  protocol?: string;
}

export function getAuthBaseUrl(
  host: string,
  options: GetAuthBaseUrlOptions = {}
): string {
  const normalized = normalizeHost(host);
  const protocol = options.protocol ?? "https";
  const suffix = protocol.endsWith("://") ? "" : "://";
  return `${protocol}${suffix}${normalized}`;
}
