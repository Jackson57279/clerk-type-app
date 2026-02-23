export interface BrandingConfig {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  companyName?: string;
  faviconUrl?: string;
}

export interface OrganizationBrandingRow {
  logo_url?: string | null;
  primary_color?: string | null;
  favicon_url?: string | null;
  name?: string | null;
}

const DEFAULT_PRIMARY = "#2563eb";
const DEFAULT_SECONDARY = "#64748b";

export function mergeBranding(overrides?: BrandingConfig | null): Required<BrandingConfig> {
  return {
    logoUrl: overrides?.logoUrl ?? "",
    primaryColor: overrides?.primaryColor ?? DEFAULT_PRIMARY,
    secondaryColor: overrides?.secondaryColor ?? DEFAULT_SECONDARY,
    companyName: overrides?.companyName ?? "Account",
    faviconUrl: overrides?.faviconUrl ?? "",
  };
}

export function brandingFromOrganization(
  row: OrganizationBrandingRow | null | undefined
): BrandingConfig | null {
  if (!row) return null;
  const logoUrl = row.logo_url?.trim() || undefined;
  const primaryColor = row.primary_color?.trim() || undefined;
  const faviconUrl = row.favicon_url?.trim() || undefined;
  const companyName = row.name?.trim() || undefined;
  if (!logoUrl && !primaryColor && !faviconUrl && !companyName) return null;
  return {
    ...(logoUrl && { logoUrl }),
    ...(primaryColor && { primaryColor }),
    ...(faviconUrl && { faviconUrl }),
    ...(companyName && { companyName }),
  };
}
