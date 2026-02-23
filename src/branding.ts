export interface BrandingConfig {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  companyName?: string;
}

const DEFAULT_PRIMARY = "#2563eb";
const DEFAULT_SECONDARY = "#64748b";

export function mergeBranding(overrides?: BrandingConfig | null): Required<BrandingConfig> {
  return {
    logoUrl: overrides?.logoUrl ?? "",
    primaryColor: overrides?.primaryColor ?? DEFAULT_PRIMARY,
    secondaryColor: overrides?.secondaryColor ?? DEFAULT_SECONDARY,
    companyName: overrides?.companyName ?? "Account",
  };
}
