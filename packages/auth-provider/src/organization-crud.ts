export interface Organization {
  id: string;
  name: string;
  slug: string;
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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
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

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
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

export interface ListOrganizationsOptions {
  includeDeleted?: boolean;
}

export interface OrganizationStore {
  create(data: CreateOrganizationInput): Promise<Organization>;
  getById(id: string): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
  list(options?: ListOrganizationsOptions): Promise<Organization[]>;
  update(id: string, data: UpdateOrganizationInput): Promise<Organization>;
  softDelete(id: string): Promise<void>;
}

function slugRegex(): RegExp {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
}

export function validateSlug(slug: string): void {
  if (!slug || slug.length > 255) {
    throw new Error("Slug must be non-empty and at most 255 characters");
  }
  if (!slugRegex().test(slug)) {
    throw new Error("Slug must be lowercase alphanumeric and hyphens only");
  }
}

export async function createOrganization(
  store: OrganizationStore,
  data: CreateOrganizationInput
): Promise<Organization> {
  const slug = data.slug.toLowerCase();
  validateSlug(slug);
  if (!data.name?.trim()) {
    throw new Error("Name is required");
  }
  const existing = await store.getBySlug(slug);
  if (existing && !existing.deletedAt) {
    throw new Error("An organization with this slug already exists");
  }
  return store.create({
    name: data.name.trim(),
    slug,
    logoUrl: data.logoUrl ?? null,
    primaryColor: data.primaryColor ?? null,
    faviconUrl: data.faviconUrl ?? null,
    maxMembers: data.maxMembers ?? null,
    allowedDomains: data.allowedDomains ?? [],
    requireEmailVerification: data.requireEmailVerification ?? true,
    samlEnabled: data.samlEnabled ?? false,
    samlConfig: data.samlConfig ?? null,
    scimEnabled: data.scimEnabled ?? false,
    scimTokenHash: data.scimTokenHash ?? null,
  });
}

export async function getOrganization(
  store: OrganizationStore,
  idOrSlug: string
): Promise<Organization | null> {
  const byId = await store.getById(idOrSlug);
  if (byId) return byId;
  return store.getBySlug(idOrSlug);
}

export async function listOrganizations(
  store: OrganizationStore,
  options?: ListOrganizationsOptions
): Promise<Organization[]> {
  return store.list(options);
}

export async function updateOrganization(
  store: OrganizationStore,
  id: string,
  data: UpdateOrganizationInput
): Promise<Organization> {
  const existing = await store.getById(id);
  if (!existing) {
    throw new Error("Organization not found");
  }
  if (existing.deletedAt) {
    throw new Error("Cannot update a deleted organization");
  }
  let updateData: UpdateOrganizationInput = { ...data };
  if (data.slug !== undefined) {
    const slug = data.slug.toLowerCase();
    validateSlug(slug);
    const bySlug = await store.getBySlug(slug);
    if (bySlug && bySlug.id !== id && !bySlug.deletedAt) {
      throw new Error("An organization with this slug already exists");
    }
    updateData = { ...updateData, slug };
  }
  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name cannot be empty");
  }
  return store.update(id, updateData);
}

export async function deleteOrganization(
  store: OrganizationStore,
  id: string
): Promise<void> {
  const existing = await store.getById(id);
  if (!existing) {
    throw new Error("Organization not found");
  }
  await store.softDelete(id);
}
