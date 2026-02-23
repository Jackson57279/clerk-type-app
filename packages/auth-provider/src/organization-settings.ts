import {
  getOrganization,
  updateOrganization,
  type Organization,
  type OrganizationStore,
} from "./organization-crud.js";

export interface OrganizationSettings {
  logoUrl: string | null;
  primaryColor: string | null;
  faviconUrl: string | null;
  maxMembers: number | null;
  allowedDomains: string[];
  requireEmailVerification: boolean;
  samlEnabled: boolean;
  samlConfig: Record<string, unknown> | null;
  scimEnabled: boolean;
  scimTokenHash: string | null;
}

export interface UpdateOrganizationSettingsInput {
  logoUrl?: string | null;
  primaryColor?: string | null;
  faviconUrl?: string | null;
  maxMembers?: number | null;
  allowedDomains?: string[];
  requireEmailVerification?: boolean;
  samlEnabled?: boolean;
  samlConfig?: Record<string, unknown> | null;
  scimEnabled?: boolean;
  scimTokenHash?: string | null;
}

function orgToSettings(org: Organization): OrganizationSettings {
  return {
    logoUrl: org.logoUrl,
    primaryColor: org.primaryColor,
    faviconUrl: org.faviconUrl,
    maxMembers: org.maxMembers,
    allowedDomains: org.allowedDomains,
    requireEmailVerification: org.requireEmailVerification,
    samlEnabled: org.samlEnabled,
    samlConfig: org.samlConfig,
    scimEnabled: org.scimEnabled,
    scimTokenHash: org.scimTokenHash,
  };
}

export async function getOrganizationSettings(
  store: OrganizationStore,
  organizationId: string
): Promise<OrganizationSettings | null> {
  const org = await getOrganization(store, organizationId);
  if (!org || org.deletedAt) return null;
  return orgToSettings(org);
}

export async function updateOrganizationSettings(
  store: OrganizationStore,
  organizationId: string,
  data: UpdateOrganizationSettingsInput
): Promise<OrganizationSettings> {
  const updated = await updateOrganization(store, organizationId, data);
  return orgToSettings(updated);
}
