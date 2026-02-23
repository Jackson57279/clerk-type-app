import { validateSlug } from "./organization-crud.js";

export interface Team {
  id: string;
  organizationId: string;
  parentTeamId: string | null;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTeamInput {
  organizationId: string;
  name: string;
  slug: string;
  parentTeamId?: string | null;
}

export interface UpdateTeamInput {
  name?: string;
  slug?: string;
  parentTeamId?: string | null;
}

export interface ListTeamsOptions {
  includeDeleted?: boolean;
  parentTeamId?: string | null;
}

export interface TeamStore {
  create(data: CreateTeamInput): Promise<Team>;
  getById(id: string): Promise<Team | null>;
  getByOrganizationAndSlug(organizationId: string, slug: string): Promise<Team | null>;
  listByOrganization(organizationId: string, options?: ListTeamsOptions): Promise<Team[]>;
  update(id: string, data: UpdateTeamInput): Promise<Team>;
  softDelete(id: string): Promise<void>;
}

export async function createTeam(
  store: TeamStore,
  data: CreateTeamInput
): Promise<Team> {
  const slug = data.slug.toLowerCase();
  validateSlug(slug);
  if (!data.name?.trim()) {
    throw new Error("Name is required");
  }
  const existing = await store.getByOrganizationAndSlug(data.organizationId, slug);
  if (existing && !existing.deletedAt) {
    throw new Error("A team with this slug already exists in this organization");
  }
  if (data.parentTeamId) {
    const parent = await store.getById(data.parentTeamId);
    if (!parent) {
      throw new Error("Parent team not found");
    }
    if (parent.organizationId !== data.organizationId) {
      throw new Error("Parent team must belong to the same organization");
    }
    if (parent.deletedAt) {
      throw new Error("Cannot use a deleted team as parent");
    }
  }
  return store.create({
    organizationId: data.organizationId,
    name: data.name.trim(),
    slug,
    parentTeamId: data.parentTeamId ?? null,
  });
}

export async function getTeam(
  store: TeamStore,
  idOrSlug: string,
  organizationId?: string
): Promise<Team | null> {
  const byId = await store.getById(idOrSlug);
  if (byId) return byId;
  if (organizationId) {
    return store.getByOrganizationAndSlug(organizationId, idOrSlug);
  }
  return null;
}

export async function listTeams(
  store: TeamStore,
  organizationId: string,
  options?: ListTeamsOptions
): Promise<Team[]> {
  return store.listByOrganization(organizationId, options);
}

export async function updateTeam(
  store: TeamStore,
  id: string,
  data: UpdateTeamInput
): Promise<Team> {
  const existing = await store.getById(id);
  if (!existing) {
    throw new Error("Team not found");
  }
  if (existing.deletedAt) {
    throw new Error("Cannot update a deleted team");
  }
  let updateData: UpdateTeamInput = { ...data };
  if (data.slug !== undefined) {
    const slug = data.slug.toLowerCase();
    validateSlug(slug);
    const bySlug = await store.getByOrganizationAndSlug(existing.organizationId, slug);
    if (bySlug && bySlug.id !== id && !bySlug.deletedAt) {
      throw new Error("A team with this slug already exists in this organization");
    }
    updateData = { ...updateData, slug };
  }
  if (data.name !== undefined && !data.name.trim()) {
    throw new Error("Name cannot be empty");
  }
  if (data.parentTeamId !== undefined && data.parentTeamId !== null) {
    const parent = await store.getById(data.parentTeamId);
    if (!parent) {
      throw new Error("Parent team not found");
    }
    if (parent.organizationId !== existing.organizationId) {
      throw new Error("Parent team must belong to the same organization");
    }
    if (parent.id === id) {
      throw new Error("Team cannot be its own parent");
    }
    if (parent.deletedAt) {
      throw new Error("Cannot use a deleted team as parent");
    }
  }
  return store.update(id, updateData);
}

export async function deleteTeam(store: TeamStore, id: string): Promise<void> {
  const existing = await store.getById(id);
  if (!existing) {
    throw new Error("Team not found");
  }
  await store.softDelete(id);
}
